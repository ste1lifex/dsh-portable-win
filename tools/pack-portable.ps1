<#
  ===========================================================================
   组装「完整便携包」：仓库骨架 + 运行时载荷 → dist\DSH-portable-win-x64\ 与 .zip

   载荷来源（本机目录，缺什么就跳过什么）：
     node\                        必填：tools\fetch-node.ps1 生成，或从现成包复制
     store\                       可选：pnpm 离线缓存（有 → 首启离线重建依赖）
     vendor\                      可选：离线安装器 / pnpm 无法重建的原生产物
     dsh-home\runtimes\           可选：dsh-latex 的 Tectonic 引擎与 TeX 资源缓存
                                        （dsh-pdf-reader 无捆绑运行时，用系统 Python 3 + pymupdf）
     DshDesktop.exe               可选：launcher\build-desktop.ps1 产物

   用法（默认就是单包发布：store\ 一并入包，用户只下一次、只解一次）:
     powershell -ExecutionPolicy Bypass -File tools\pack-portable.ps1
     powershell -ExecutionPolicy Bypass -File tools\pack-portable.ps1 -NoZip
     powershell -ExecutionPolicy Bypass -File tools\pack-portable.ps1 -OutDir D:\tmp

   可选、特殊场景（单包将来逼近 2 GiB / U 盘分卷 / 内网分块传输）：
   -StoreAsSeparateAsset 把 store\ 从主包排除、单独压成第二个资产，
   这种模式下两个包必须解压到同一层才能合并：
     powershell -ExecutionPolicy Bypass -File tools\pack-portable.ps1 -StoreAsSeparateAsset
  ===========================================================================
#>
[CmdletBinding()]
param(
    [string]$OutDir,
    [string]$Name = 'DSH-portable-win-x64',
    [string]$PayloadFrom,
    [switch]$NoZip,
    [switch]$StoreAsSeparateAsset
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# robocopy 的退出码 1 表示「有文件被复制」，在 PowerShell 7.3+ 会被当成失败，这里显式关掉
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

# ---- ZIP 写入所需的程序集 ----------------------------------------------------
# 只按名字加载 System.IO.Compression.FileSystem。ZipArchiveMode / CompressionLevel
# 位于 System.IO.Compression，而该程序集要等"执行到它的成员"时才被 CLR 加载；
# 在函数体里直接写类型字面量会报
#   Unable to find type [System.IO.Compression.ZipArchiveMode]
# （实测用 [Reflection.Assembly]::Load 显式加载反而会让 ZipFile 解析失败，故不采用。）
# Write-TreeZip 因此把 'Create' / 'Optimal' 写成字符串，由 PowerShell 按方法签名
# 绑定到对应枚举；语义与显式枚举一致，且不依赖程序集加载顺序。
Add-Type -AssemblyName System.IO.Compression.FileSystem

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
if (-not $OutDir) { $OutDir = Join-Path $root 'dist' }
$target = Join-Path $OutDir $Name
if (-not $PayloadFrom) { $PayloadFrom = $root }

function Step($m) { Write-Host "[pack] $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "[pack] $m" -ForegroundColor Red; exit 1 }

# 载荷查找：仓库根目录优先（例如 tools\fetch-node.ps1 生成的 node\、新编译的
# DshDesktop.exe），其次 -PayloadFrom 指定的目录（例如上一次的发布构建目录）
function Payload($rel) {
    foreach ($base in @($root, $PayloadFrom)) {
        $p = Join-Path $base $rel
        if ($p -and (Test-Path $p)) { return $p }
    }
    return $null
}

# ---- 0) 自检 ---------------------------------------------------------------
$nodeSrc = Payload 'node'
if (-not $nodeSrc) {
    Fail "缺少 node\ —— 先跑 tools\fetch-node.ps1，或用 -PayloadFrom <目录> 指定已有载荷。"
}
if (-not (Test-Path (Join-Path $nodeSrc 'bin\node.exe'))) {
    Fail "载荷里的 node\ 结构不对（应有 bin\node.exe）：$nodeSrc"
}

$storeSrc = Payload 'store'
$vendorSrc = Payload 'vendor'
$runtimesSrc = Payload 'dsh-home\runtimes'
$exeSrc = Payload 'DshDesktop.exe'

Step "载荷来源：$PayloadFrom"
Step ("载荷：node=必带({0})  store={1}  vendor={2}  runtimes={3}  DshDesktop.exe={4}" -f `
        $nodeSrc, `
        $(if ($storeSrc) { '有' } else { '无' }), `
        $(if ($vendorSrc) { '有' } else { '无' }), `
        $(if ($runtimesSrc) { '有' } else { '无' }), `
        $(if ($exeSrc) { '有' } else { '无' }))
if (-not $storeSrc) { Step '提示：没有 store\ → 目标机首启将联网按锁文件重建依赖（功能不变，只是需要网络）' }

# ---- 1) 复制骨架 -----------------------------------------------------------
Step "准备输出目录 $target ..."
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
New-Item -ItemType Directory -Force -Path $target | Out-Null

# 仓库骨架：排除 .git / dist / 以及大载荷（下面单独按需复制）。
# `.dsh-runtime` 按名字排除：那是各插件 fetch 脚本留下的下载暂存目录
# （例如 plugins\dsh-latex\.dsh-runtime\downloads\tectonic-*.zip，约 20MB），
# 引擎本体已经在 dsh-home\runtimes\ 里，这份副本没有分发价值。
$excludeDirs = @('.git', 'dist', 'logs', 'backups', 'shot', 'node', 'store', 'vendor') | ForEach-Object { Join-Path $root $_ }
# node_modules 一律不入包（第 3 步会硬性剔除，这里直接不复制：省掉约 660 MB 无谓 IO）。
# 目标机首启用 store\ 离线重建，发布包本来就不需要它们。
$excludeDirs += (@('app-npm\node_modules', 'dsh-home\profiles\node_modules', 'dsh-home\profiles\web\node_modules') | ForEach-Object { Join-Path $root $_ })
# /XJ：不跟随 junction / 符号链接（下面 CopyTree 里有同类说明）。
robocopy $root $target /E /XJ /NFL /NDL /NJH /NJS /R:1 /W:1 `
    /XD $excludeDirs (Join-Path $root 'dsh-home\runtimes') '.dsh-runtime' `
    /XF (Join-Path $root 'DshDesktop.exe') (Join-Path $root 'dsh.pid') | Out-Null

# ---- 2) 复制载荷 -----------------------------------------------------------
function CopyTree($src, $rel) {
    if (-not $src -or -not (Test-Path $src)) { return }
    $dst = Join-Path $target $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Step "复制 $rel  ← $src"
    # /XJ：不跟随 junction / 符号链接。pnpm 会把 store\v11\projects\<hash> 做成指向
    # app-npm / profiles\web 的 junction；跟随它会把本机 app-npm\.env（含真实密钥）
    # 连同 node_modules 一起复制进发布包（打包前的密钥扫描会因此中止）。
    # 那些 junction 在目标机上也本来就悬空，必须排除。
    robocopy $src $dst /E /XJ /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
}

CopyTree $nodeSrc 'node'
# store\ 已在上面的骨架排除列表里，始终由 CopyTree 单独复制；只有 -StoreAsSeparateAsset
# （可选、特殊场景）时才不进主包，改由第二个资产 <Name>-store.zip 提供。
if (-not $StoreAsSeparateAsset) { CopyTree $storeSrc 'store' }
CopyTree $vendorSrc 'vendor'
CopyTree $runtimesSrc 'dsh-home\runtimes'
if ($exeSrc) {
    Copy-Item $exeSrc (Join-Path $target 'DshDesktop.exe') -Force
    Step "复制 DshDesktop.exe  ← $exeSrc"
}

# ---- 3) 剔除本机数据与密钥（双保险）----------------------------------------
Step '剔除本机数据与密钥 ...'
$purge = @(
    'app-npm\.env',
    'dsh-home\.credentials.yaml',
    'dsh-home\.anonymous-user-id',
    'dsh-home\pet.json',
    'dsh-home\skin-center-active.json',
    'dsh-home\settings.yaml.imported',
    'dsh-home\dsh-web-settings-legacy-import.json',
    'dsh-home\profiles\web\.dsh-module-fallback',
    'dsh-home\profiles\web\cordis.patch.yml.bak-plugin-manager'
)
$purgeDirs = @(
    'logs', 'backups',
    'dsh-home\sessions', 'dsh-home\storages', 'dsh-home\attachments', 'dsh-home\webview2-data',
    'dsh-home\skin-center', 'dsh-home\skins', 'dsh-home\task-board', 'dsh-home\dsh-usage',
    'dsh-home\dsh-session-archive', 'dsh-home\llm-deepseek', 'dsh-home\.repair-backups',
    'dsh-home\speech-to-text',
    'dsh-home\cache',
    'plugins\dsh-latex\.dsh-runtime',
    'app-npm\node_modules', 'dsh-home\profiles\web\node_modules', 'dsh-home\profiles\node_modules'
)
foreach ($p in $purge) { Remove-Item (Join-Path $target $p) -Force -ErrorAction SilentlyContinue }
foreach ($d in $purgeDirs) { Remove-Item (Join-Path $target $d) -Recurse -Force -ErrorAction SilentlyContinue }
Remove-Item (Join-Path $target 'dsh.pid') -Force -ErrorAction SilentlyContinue

# ---- 4) 打包前扫描：绝不能带出密钥 -----------------------------------------
Step '扫描密钥 ...'
$suspects = Get-ChildItem $target -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in @('.env', '.credentials.yaml') -or $_.Name -like '*.env' }
if ($suspects) {
    $suspects | ForEach-Object { Write-Host "   !! $($_.FullName)" -ForegroundColor Red }
    Fail '输出目录里仍存在 .env / 凭证文件，已中止。请检查剔除规则。'
}
$leak = Get-ChildItem $target -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @('.yaml', '.yml', '.json', '.env', '.txt', '.ps1', '.cmd', '.bat') } |
    Select-String -Pattern 'sk-[A-Za-z0-9]{20,}' -List -ErrorAction SilentlyContinue
if ($leak) {
    $leak | ForEach-Object { Write-Host "   !! $($_.Path): $($_.Line.Trim().Substring(0,[Math]::Min(60,$_.Line.Trim().Length)))" -ForegroundColor Red }
    Fail '输出目录里疑似存在 API Key，已中止。'
}
Step '未发现密钥。'

# ---- 5) 统计 + 打包 --------------------------------------------------------
$files = Get-ChildItem $target -Recurse -File -Force
$sizeMB = ($files | Measure-Object Length -Sum).Sum / 1MB
Step ("输出：{0} 个文件，{1:N1} MB" -f $files.Count, $sizeMB)

# 手写 zip 条目，不用 [ZipFile]::CreateFromDirectory：.NET Framework 的
# CreateFromDirectory 用 '\' 作条目分隔符，这不符合 ZIP 规范（ISO/IEC 21320-1
# 要求 '/'）。Windows 资源管理器 / 7-Zip / bsdtar 会容忍它，但 Python zipfile、
# Node 的 yauzl 等会把整条 `a\b\c` 当成一个文件名。
# 这里统一用 '/'，并且显式写目录条目（含空目录），保证任何解压器都能还原出与
# staging 树完全一致的目录结构；条目名带 "<Name>/" 顶层前缀（与旧的
# includeBaseDirectory=$true 行为一致），拆包时两个资产才能解压到同一层合并。
function Write-TreeZip {
    param(
        [Parameter(Mandatory = $true)][string]$SourceDir,
        [Parameter(Mandatory = $true)][string]$ZipPath,
        [Parameter(Mandatory = $true)][string]$EntryPrefix
    )

    $sourceRoot = (Resolve-Path -LiteralPath $SourceDir).Path.TrimEnd('\')
    $prefix = $EntryPrefix.TrimEnd('/') + '/'
    $archive = [System.IO.Compression.ZipFile]::Open($ZipPath, 'Create')
    try {
        # 顶层目录条目
        $rootEntry = $archive.CreateEntry($prefix, 'Optimal')
        $rootEntry.LastWriteTime = (Get-Item -LiteralPath $sourceRoot).LastWriteTime

        # 目录条目：按 FullName 排序可保证父目录条目先于子目录条目
        foreach ($dir in Get-ChildItem -LiteralPath $sourceRoot -Recurse -Directory -Force | Sort-Object FullName) {
            $rel = $dir.FullName.Substring($sourceRoot.Length + 1).Replace('\', '/')
            $entry = $archive.CreateEntry($prefix + $rel + '/', 'Optimal')
            $entry.LastWriteTime = $dir.LastWriteTime
        }

        foreach ($file in Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Force) {
            $rel = $file.FullName.Substring($sourceRoot.Length + 1).Replace('\', '/')
            $entry = $archive.CreateEntry($prefix + $rel, 'Optimal')
            $entry.LastWriteTime = $file.LastWriteTime
            $out = $entry.Open()
            try {
                $in = [IO.File]::OpenRead($file.FullName)
                try { $in.CopyTo($out) } finally { $in.Dispose() }
            } finally { $out.Dispose() }
        }
    } finally {
        $archive.Dispose()
    }
}

if (-not $NoZip) {
    $zip = Join-Path $OutDir "$Name.zip"
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Step "压缩 → $zip ..."
    Write-TreeZip -SourceDir $target -ZipPath $zip -EntryPrefix "$Name/"
    $zipMB = (Get-Item $zip).Length / 1MB
    Step ("zip：{0:N1} MB" -f $zipMB)
    Write-Host ("[pack] SHA256 {0} = {1}" -f (Split-Path $zip -Leaf), (Get-FileHash $zip -Algorithm SHA256).Hash)

    if ($StoreAsSeparateAsset -and $storeSrc) {
        # 离线缓存单独成包（可选、特殊场景）：单包将来逼近 2 GiB 时改用这个模式。
        # 关键点：主包 zip 的顶层目录是 <Name>/，所以 store 包的每个条目也要带上
        # 同样的 "<Name>/store/..." 前缀，两个资产解压到同一层才会合并进同一个文件夹。
        $storeZip = Join-Path $OutDir "$Name-store.zip"
        Remove-Item $storeZip -Force -ErrorAction SilentlyContinue
        Step "压缩离线缓存 → $storeZip ..."
        Write-TreeZip -SourceDir $storeSrc -ZipPath $storeZip -EntryPrefix "$Name/store/"
        Step ("store zip：{0:N1} MB" -f ((Get-Item $storeZip).Length / 1MB))
        Write-Host ("[pack] SHA256 {0} = {1}" -f (Split-Path $storeZip -Leaf), (Get-FileHash $storeZip -Algorithm SHA256).Hash)
        Step '发布这两个资产：解压到同一层，两者合并进同一个 <Name>\ 文件夹后首启即可纯离线重建依赖。'
    } else {
        Step "完成。上传到 GitHub Release 即可（建议同时附上 WebView2 安装器）。"
    }
} else {
    Step "完成（-NoZip，未打包）。"
}
