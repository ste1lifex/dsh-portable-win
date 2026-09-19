<#
  ===========================================================================
   组装「完整便携包」：仓库骨架 + 运行时载荷 → dist\DSH-portable-win-x64\ 与 .zip

   载荷来源（本机目录，缺什么就跳过什么）：
     node\                        必填：tools\fetch-node.ps1 生成，或从现成包复制
     store\                       可选：pnpm 离线缓存（有 → 首启离线重建依赖）
     vendor\                      可选：离线安装器 / pnpm 无法重建的原生产物
     dsh-home\runtimes\           可选：dsh-doc 的 CPython + Tesseract（OCR）
     DshDesktop.exe               可选：launcher\build-desktop.ps1 产物

   用法:
     powershell -ExecutionPolicy Bypass -File tools\pack-portable.ps1
     powershell -ExecutionPolicy Bypass -File tools\pack-portable.ps1 -NoZip
     powershell -ExecutionPolicy Bypass -File tools\pack-portable.ps1 -OutDir D:\tmp
  ===========================================================================
#>
[CmdletBinding()]
param(
    [string]$OutDir,
    [string]$Name = 'DSH-portable-win-x64',
    [switch]$NoZip
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# robocopy 的退出码 1 表示「有文件被复制」，在 PowerShell 7.3+ 会被当成失败，这里显式关掉
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
if (-not $OutDir) { $OutDir = Join-Path $root 'dist' }
$target = Join-Path $OutDir $Name

function Step($m) { Write-Host "[pack] $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "[pack] $m" -ForegroundColor Red; exit 1 }

# ---- 0) 自检 ---------------------------------------------------------------
$nodeExe = Join-Path $root 'node\bin\node.exe'
if (-not (Test-Path $nodeExe)) {
    Fail "缺少 node\bin\node.exe —— 先跑 tools\fetch-node.ps1，或把现成包的 node\ 放进仓库根目录。"
}

$hasStore = Test-Path (Join-Path $root 'store')
$hasVendor = Test-Path (Join-Path $root 'vendor')
$hasRuntimes = Test-Path (Join-Path $root 'dsh-home\runtimes')
$hasExe = Test-Path (Join-Path $root 'DshDesktop.exe')

Step ("载荷：node=必带  store={0}  vendor={1}  runtimes={2}  DshDesktop.exe={3}" -f `
        $(if ($hasStore) { '有' } else { '无' }), `
        $(if ($hasVendor) { '有' } else { '无' }), `
        $(if ($hasRuntimes) { '有' } else { '无' }), `
        $(if ($hasExe) { '有' } else { '无' }))
if (-not $hasStore) { Step '提示：没有 store\ → 目标机首启将联网按锁文件重建依赖（功能不变，只是需要网络）' }

# ---- 1) 复制骨架 -----------------------------------------------------------
Step "准备输出目录 $target ..."
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
New-Item -ItemType Directory -Force -Path $target | Out-Null

# 仓库骨架：排除 .git / dist / 以及大载荷（下面单独按需复制）
$excludeDirs = @('.git', 'dist', 'logs', 'backups', 'shot')
robocopy $root $target /E /NFL /NDL /NJH /NJS /R:1 /W:1 `
    /XD (Join-Path $root 'node') (Join-Path $root 'store') (Join-Path $root 'vendor') `
        (Join-Path $root 'dsh-home\runtimes') `
        ($excludeDirs | ForEach-Object { Join-Path $root $_ }) `
    /XF (Join-Path $root 'DshDesktop.exe') (Join-Path $root 'dsh.pid') | Out-Null

# ---- 2) 复制载荷 -----------------------------------------------------------
function CopyTree($rel) {
    $src = Join-Path $root $rel
    if (-not (Test-Path $src)) { return }
    $dst = Join-Path $target $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Step "复制 $rel ..."
    robocopy $src $dst /E /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
}

CopyTree 'node'
if ($hasStore) { CopyTree 'store' }
if ($hasVendor) { CopyTree 'vendor' }
if ($hasRuntimes) { CopyTree 'dsh-home\runtimes' }
if ($hasExe) { Copy-Item (Join-Path $root 'DshDesktop.exe') (Join-Path $target 'DshDesktop.exe') -Force }

# ---- 3) 剔除本机数据与密钥（双保险）----------------------------------------
Step '剔除本机数据与密钥 ...'
$purge = @(
    'app-npm\.env',
    'dsh-home\.credentials.yaml',
    'dsh-home\.anonymous-user-id',
    'dsh-home\pet.json',
    'dsh-home\profiles\web\.dsh-module-fallback',
    'dsh-home\profiles\web\cordis.patch.yml.bak-plugin-manager'
)
$purgeDirs = @(
    'logs', 'backups',
    'dsh-home\sessions', 'dsh-home\storages', 'dsh-home\attachments', 'dsh-home\webview2-data',
    'dsh-home\skin-center', 'dsh-home\skins', 'dsh-home\task-board', 'dsh-home\dsh-usage',
    'dsh-home\dsh-session-archive', 'dsh-home\llm-deepseek', 'dsh-home\.repair-backups',
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

if (-not $NoZip) {
    $zip = Join-Path $OutDir "$Name.zip"
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Step "压缩 → $zip ..."
    # 用 .NET 的 ZipFile（不依赖 tar/7z），压缩级别 Optimal
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $target, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $true)
    $zipMB = (Get-Item $zip).Length / 1MB
    Step ("zip：{0:N1} MB" -f $zipMB)
    Step "完成。上传到 GitHub Release 即可（建议同时附上 store\ 的说明与 WebView2 安装器）。"
} else {
    Step "完成（-NoZip，未打包）。"
}
