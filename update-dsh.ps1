param(
    [switch]$Check,        # 只检查并报告，不做任何修改
    [switch]$Yes,          # 跳过确认提示，直接升级
    [switch]$AutoPrompt    # 启动时钩子：有新版才提示；离线时静默跳过
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $root 'app-npm'
$corePkgJson = Join-Path $app 'node_modules\@deepseek-ai\dsh\package.json'
$profileDir = Join-Path $root 'dsh-home\profiles\web'
# 参与自动升级的插件清单：单一数据源 plugin-track.json（与 DshDesktop
# 版本信息面板共用）。新增插件只需在该 JSON 里加一行，更新与版本显示同步；
# 清单缺失/损坏时回退内置默认列表，保证新机器 clone 后能自主更新。
#
# ===========================================================================
# 给后续 agent / 维护者（装插件前必读，踩过的坑）
# ===========================================================================
# 1) 装插件是**两步**，`dsh plugin` 只做第一步：
#      dsh plugin --profile web add <包名>
#    它只会改 profile —— package.json 的 dependencies 与 dsh.profile.bundles、
#    pnpm-lock.yaml、node_modules —— **不会**登记 plugin-track.json。
#    必须在 plugin-track.json 的 plugins 数组里补一行：
#      { "name": "<npm 包名>", "label": "<中文短名>" },
#    漏掉的症状是"插件能用，但像是没装"：本脚本的版本报告与自动升级都看不到
#    它，DshDesktop 的「版本信息面板」里也不显示它的版本。
#    改完用只读方式自检（-Check 只检查并报告，不做任何修改）：
#      .\update-dsh.ps1 -Check
#    报告里应出现 `插件 <label>：本地 x.y.z / 最新 x.y.z` 一行；同时确认它
#    没有把任何清单文件改掉（可用 Get-FileHash 前后对比）。
#
# 2) 新增/升级插件后，务必确认它**真的加载了**，别只看 profile 里的依赖。
#    插件自带的 cordis.patch.yml 未必适配当前 DSH 版本，而 MCP 类条目通常带
#    failOnStartupError: false —— 启动失败会被静默吞掉，DSH 照常起来，只是
#    工具凭空消失。判断方法：看 logs\dsh-web.err.log 有没有新增堆栈，
#    以及运行时是否真的多出了对应条目/工具。
#    实例（DSH 0.1.5-rc.1）：Loader 把 !!js 表达式里的 baseUrl 锚在
#    **profile 根目录**（见 @deepseek-ai/dsh/lib/profile-boot-*.js），而不是
#    补丁文件所在目录。用 new URL('<相对路径>', baseUrl) 定位自带资源的插件
#    会解析到不存在的路径，stdio server 反复 MODULE_NOT_FOUND。
#    修法：在 profile 的 cordis.patch.yml 里按 id 覆盖该条目的 config，
#    把路径改锚到 profile 根；注意补丁语义是整体赋值（target[key] = value），
#    不做深合并，所以 config 的每个键都要写全。
#
# 3) 本文件是 UTF-8 **带 BOM** 的，改完必须确认 BOM 还在。Windows PowerShell 5.1
#    在没有 BOM 时会按 ANSI/GBK 读中文：字符串里的引号被吞掉、整个脚本语法
#    报错，而且报错行号会散布在离你改动很远的地方（看着像别处坏了）。
#    有些编辑工具/写回方式会把 BOM 丢掉，改完请自查前 3 字节应为 EF BB BF：
#      $b=[IO.File]::ReadAllBytes($f); '{0:X2} {1:X2} {2:X2}' -f $b[0],$b[1],$b[2]
#    丢了就补回来：
#      $b=[IO.File]::ReadAllBytes($f); $o=New-Object byte[] ($b.Length+3); `
#      [Array]::Copy([byte[]](0xEF,0xBB,0xBF),0,$o,0,3); `
#      [Array]::Copy($b,0,$o,3,$b.Length); [IO.File]::WriteAllBytes($f,$o)
# ===========================================================================
$pluginTrackFile = Join-Path $root 'plugin-track.json'
function Get-TrackedPlugins {
    if (Test-Path -LiteralPath $pluginTrackFile -PathType Leaf) {
        try {
            $track = Get-Content -LiteralPath $pluginTrackFile -Raw -Encoding UTF8 | ConvertFrom-Json
            $list = @($track.plugins | ForEach-Object { @{ name = [string]$_.name; label = [string]$_.label } })
            if ($list.Count -gt 0) { return $list }
        } catch {
            Write-Host "[update] 提示：plugin-track.json 读取失败，使用内置默认清单。"
        }
    }
    return @(
        @{ name = '@linxin666/dsh-web-all'; label = 'Web UI 全家桶' },
        @{ name = 'dsh-doc';                  label = 'dsh-doc 本地文档/OCR' },
        @{ name = 'dsh-free-search';          label = 'Free Search 联网搜索' }
    )
}
$pluginPkgs = Get-TrackedPlugins
$docRuntimeDir = Join-Path $root 'dsh-home\runtimes\dshdoc-runtime-win32-x64'
$pnpmCmd = Join-Path $root 'tools\pnpm.cmd'
$storeDir = Join-Path $root 'store'
$logDir = Join-Path $root 'logs'
$backupRoot = Join-Path $root 'backups'

function Write-Step($msg) { Write-Host "[update] $msg" }

function Get-JsonVersion($path, $fallback) {
    if (Test-Path $path) {
        try {
            $j = Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($j.version) { return [string]$j.version }
        } catch { }
    }
    return $fallback
}

function Get-NpmLatest($pkg) {
    # 快速查询 npm registry；失败返回 $null（离线时静默跳过）
    try {
        $encoded = $pkg -replace '/', '%2f'
        $r = Invoke-RestMethod "https://registry.npmjs.org/$encoded/latest" -TimeoutSec 10
        return [string]$r.version
    } catch {
        return $null
    }
}

function Get-VersionParts($v) {
    $main = $v; $pre = @()
    if ($v -match '^(.*?)-(.*)$') { $main = $matches[1]; $pre = $matches[2] -split '\.' }
    return @{ main = ($main -split '\.' | ForEach-Object { [int]$_ }); pre = $pre }
}

function Compare-DshVersion($a, $b) {
    $pa = Get-VersionParts $a; $pb = Get-VersionParts $b
    for ($i = 0; $i -lt [Math]::Max($pa.main.Count, $pb.main.Count); $i++) {
        $x = if ($i -lt $pa.main.Count) { $pa.main[$i] } else { 0 }
        $y = if ($i -lt $pb.main.Count) { $pb.main[$i] } else { 0 }
        if ($x -ne $y) { return $x.CompareTo($y) }
    }
    if ($pa.pre.Count -eq 0 -and $pb.pre.Count -eq 0) { return 0 }
    if ($pa.pre.Count -eq 0) { return 1 }
    if ($pb.pre.Count -eq 0) { return -1 }
    $n = [Math]::Max($pa.pre.Count, $pb.pre.Count)
    for ($i = 0; $i -lt $n; $i++) {
        $x = if ($i -lt $pa.pre.Count) { $pa.pre[$i] } else { '' }
        $y = if ($i -lt $pb.pre.Count) { $pb.pre[$i] } else { '' }
        if ($x -eq $y) { continue }
        $xn = $x -as [int]; $yn = $y -as [int]
        if ($null -ne $xn -and $null -ne $yn) { return $xn.CompareTo($yn) }
        if ($null -ne $xn) { return -1 }
        if ($null -ne $yn) { return 1 }
        return $x.CompareTo($y)
    }
    return 0
}

function Test-DshVersionRange($version, $range) {
    if ([string]::IsNullOrWhiteSpace($range) -or $range.Trim() -eq '*') { return $true }

    # Current DSH plugin manifests use simple whitespace-separated semver
    # comparators such as ">=0.1.2-alpha.1". Reject unknown syntax rather
    # than allowing a potentially incompatible automatic upgrade.
    if ($range -match '\|\||[~^*xX]') { return $false }
    $comparators = @($range.Trim() -split '\s+' | Where-Object { $_ })
    foreach ($comparator in $comparators) {
        if ($comparator -notmatch '^(>=|<=|>|<|=)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$') {
            return $false
        }
        $operator = if ($matches[1]) { $matches[1] } else { '=' }
        $required = $matches[2]
        $cmp = Compare-DshVersion $version $required
        $satisfied = switch ($operator) {
            '>=' { $cmp -ge 0 }
            '<=' { $cmp -le 0 }
            '>'  { $cmp -gt 0 }
            '<'  { $cmp -lt 0 }
            '='  { $cmp -eq 0 }
        }
        if (-not $satisfied) { return $false }
    }
    return $true
}

function Backup-Snapshot($label) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $dir = Join-Path $backupRoot ("app-{0}-{1}" -f $label, $stamp)
    New-Item -ItemType Directory -Force -Path (Join-Path $dir 'app-npm') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $dir 'profiles-web') | Out-Null
    foreach ($f in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.env')) {
        $src = Join-Path $app $f
        if (Test-Path $src) { Copy-Item $src (Join-Path $dir 'app-npm') -Force }
    }
    foreach ($f in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'cordis.yml')) {
        $src = Join-Path $profileDir $f
        if (Test-Path $src) { Copy-Item $src (Join-Path $dir 'profiles-web') -Force }
    }
    $pluginLines = foreach ($kv in $script:pluginVersions.GetEnumerator()) {
        "  $($kv.Key): $($kv.Value)"
    }
    Set-Content (Join-Path $dir 'README.txt') @"
Auto-update backup created $stamp
Core:    $($script:currentCore)
Plugins:
$($pluginLines -join "`n")
Restore with: rollback-dsh.ps1 -Restore "$(Split-Path $dir -Leaf)"
"@ -Encoding UTF8
    Write-Step "备份完成：$dir"
    return $dir
}

function Invoke-Pnpm($workDir, $argsList, $withNodePath) {
    $oldPath = $env:PATH
    if ($withNodePath) {
        $env:PATH = (Join-Path $root 'node\bin') + ';' + $oldPath
    }
    Push-Location $workDir
    try {
        # 捕获 pnpm 输出并转给宿主显示；绝不让它泄漏出函数，
        # 否则这些输出会混进返回值，导致 $code 变成数组、退出码误判。
        & $pnpmCmd @argsList 2>&1 | ForEach-Object { Write-Host $_ }
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
        $env:PATH = $oldPath
    }
    return $code
}

function Stop-RunningHarness {
    $stop = Join-Path $root 'stop-dsh.ps1'
    if (Test-Path $stop) {
        Write-Step '检测到服务可能正在运行，先停止……'
        & $stop | Out-Null
    }
}

function Get-NpmLatestManifest($pkg) {
    # Third-party plugins declare DSH core compatibility under
    # dsh.engines.dsh. pnpm does not enforce this custom field.
    try {
        $encoded = $pkg -replace '/', '%2f'
        return Invoke-RestMethod "https://registry.npmjs.org/$encoded/latest" -TimeoutSec 10
    } catch {
        return $null
    }
}

function Wait-TaskBoardLockReady {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutMilliseconds = 5000
    )

    $lockFile = Join-Path $root 'dsh-home\task-board\ledger-v2.lock'
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    while ([DateTime]::UtcNow -lt $deadline -and -not $Process.HasExited) {
        if (-not (Test-Path -LiteralPath $lockFile -PathType Leaf)) {
            Start-Sleep -Milliseconds 100
            continue
        }
        try {
            $owner = Get-Content -LiteralPath $lockFile -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($owner.pid -eq $Process.Id -and $owner.token) { return }
        }
        catch {
            # The plugin creates the lock before writing its JSON owner record.
            # Keep waiting so the verification process is not killed in that gap.
        }
        Start-Sleep -Milliseconds 100
    }
}

function Repair-TaskBoardLockAfterVerify {
    param([int]$VerifyProcessId)

    $lockFile = Join-Path $root 'dsh-home\task-board\ledger-v2.lock'
    if (-not (Test-Path -LiteralPath $lockFile -PathType Leaf)) { return }
    if (Get-Process -Id $VerifyProcessId -ErrorAction SilentlyContinue) { return }

    try {
        Get-Content -LiteralPath $lockFile -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null
        # A readable stale lock is intentionally left for the plugin's normal
        # PID/start-time recovery path. Never touch another process's lock.
        return
    }
    catch {
        # The verify process is already gone. An unreadable lock created by it
        # cannot identify a live owner and would make every later boot fail.
        $backup = "$lockFile.stale-verify-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        Move-Item -LiteralPath $lockFile -Destination $backup
        Write-Step "已隔离启动自检留下的无效任务看板锁：$backup"
    }
}

function Verify-Boot {
    Write-Step '升级后启动自检……'
    $nodeExe = Join-Path $root 'node\bin\node.exe'
    $port = 3099
    $out = Join-Path $logDir 'verify-boot.out.log'
    $err = Join-Path $logDir 'verify-boot.err.log'
    $env:DSH_HOME = Join-Path $root 'dsh-home'
    $proc = Start-Process -FilePath $nodeExe `
        -ArgumentList @('node_modules\@deepseek-ai\dsh\lib\bin.js', 'web', '--port', "$port", '--no-open') `
        -WorkingDirectory $app -RedirectStandardOutput $out -RedirectStandardError $err `
        -WindowStyle Hidden -PassThru
    $ok = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 1
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { $ok = $true; break }
        if ($proc.HasExited) { break }
    }
    if (-not $proc.HasExited) {
        # Listening can become true while task-board is between creating its
        # lock file and writing the owner JSON. Killing in that small window
        # leaves a zero-byte lock which blocks the next real startup.
        Wait-TaskBoardLockReady -Process $proc
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        $proc.WaitForExit(5000) | Out-Null
        Repair-TaskBoardLockAfterVerify -VerifyProcessId $proc.Id
    }
    if ($ok) { Write-Step '自检通过：新版本可正常启动。' }
    else {
        Write-Step '警告：新版本启动自检未通过，请查看 logs\verify-boot.err.log，必要时回滚。'
    }
    return $ok
}

# ---------------------------------------------------------------------------

if (-not (Test-Path $corePkgJson)) {
    Write-Step "未找到 npm 安装版核心（$corePkgJson）。请确认已迁移到 app-npm。"
    exit 2
}

$script:currentCore = Get-JsonVersion $corePkgJson 'unknown'
$script:pluginVersions = @{}
foreach ($p in $pluginPkgs) {
    $pkgJson = Join-Path $profileDir ("node_modules\{0}\package.json" -f $p.name)
    $script:pluginVersions[$p.name] = Get-JsonVersion $pkgJson 'unknown'
}
$script:currentPlugin = $script:pluginVersions['@linxin666/dsh-web-all']

$latestCore = Get-NpmLatest '@deepseek-ai/dsh'
$latestPlugins = @{}
$latestPluginManifests = @{}
$haveNetwork = $null -ne $latestCore
foreach ($p in $pluginPkgs) {
    $manifest = Get-NpmLatestManifest $p.name
    $latestPluginManifests[$p.name] = $manifest
    $latestPlugins[$p.name] = if ($null -ne $manifest) { [string]$manifest.version } else { $null }
    if ($null -eq $manifest) { $haveNetwork = $false }
}

if (-not $haveNetwork) {
    if ($AutoPrompt) { exit 0 }   # 启动时离线：静默跳过
    Write-Step '无法连接 npm registry（可能离线），跳过检查。'
    exit 2
}

$coreNew = (Compare-DshVersion $latestCore $script:currentCore) -gt 0
$targetCore = if ($coreNew) { $latestCore } else { $script:currentCore }
$pluginNews = @{}
$pluginCompatibility = @{}
foreach ($p in $pluginPkgs) {
    $manifest = $latestPluginManifests[$p.name]
    $requiredCore = if ($null -ne $manifest.dsh -and $null -ne $manifest.dsh.engines) {
        [string]$manifest.dsh.engines.dsh
    } else { '' }
    $compatible = Test-DshVersionRange $targetCore $requiredCore
    $pluginCompatibility[$p.name] = @{ compatible = $compatible; requiredCore = $requiredCore }
    $pluginNews[$p.name] = $compatible -and ((Compare-DshVersion $latestPlugins[$p.name] $script:pluginVersions[$p.name]) -gt 0)
}
$anyPluginNew = ($pluginNews.Values | Where-Object { $_ }).Count -gt 0
$anyIncompatiblePluginNew = @($pluginPkgs | Where-Object {
    -not $pluginCompatibility[$_.name].compatible -and
    (Compare-DshVersion $latestPlugins[$_.name] $script:pluginVersions[$_.name]) -gt 0
}).Count -gt 0

Write-Step ("核心：本地 {0} / 最新 {1} {2}" -f $script:currentCore, $latestCore, $(if ($coreNew) { '← 有新版本' } else { '(已最新)' }))
foreach ($p in $pluginPkgs) {
    $compat = $pluginCompatibility[$p.name]
    $marker = if (-not $compat.compatible) {
        "← 跳过：要求 DSH $($compat.requiredCore)，本次核心为 $targetCore"
    } elseif ($pluginNews[$p.name]) { '← 有新版本' } else { '(已最新)' }
    Write-Step ("插件 {0}：本地 {1} / 最新 {2} {3}" -f $p.label, $script:pluginVersions[$p.name], $latestPlugins[$p.name], $marker)
}
Write-Step ("dsh-doc 本地 OCR 运行时：{0}" -f $(if (Test-Path $docRuntimeDir) { '就绪' } else { '缺失（可重新下载）' }))

if ($Check) {
    Write-Step '检查模式：未做任何修改。'
    exit 0
}

if (-not $coreNew -and -not $anyPluginNew) {
    if ($anyIncompatiblePluginNew) {
        Write-Step '当前核心兼容范围内已是最新；不兼容的插件版本已跳过。'
    } else {
        Write-Step '已是最新，无需升级。'
    }
    exit 0
}

if (-not $Yes -and -not $AutoPrompt) {
    $answer = Read-Host "发现新版本，是否现在升级？(Y/N)"
    if ($answer -notmatch '^[Yy]') {
        Write-Step '已取消升级。'
        exit 1
    }
}

# 升级前自动备份
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$backupDir = Backup-Snapshot $script:currentCore

Stop-RunningHarness

$failed = $false
$dsh = Join-Path $root 'dsh.cmd'
$oldPath = $env:PATH
$env:PATH = (Join-Path $root 'node\bin') + ';' + (Join-Path $root 'tools') + ';' + $oldPath
try {
    if ($coreNew) {
        Write-Step "升级核心 $($script:currentCore) → $latestCore ……"
        $code = Invoke-Pnpm $app @('add', "@deepseek-ai/dsh@$latestCore", '--store-dir', $storeDir) $true
        if ($code -ne 0) { Write-Step "核心升级失败（pnpm 退出码 $code）。"; $failed = $true }
    }

    if (-not $failed) {
        # 对齐插件目录的 pnpm store：便携包被搬动/复制后，profiles\web 的
        # .modules.yaml 可能还记录旧盘符/旧路径的 store，导致 pnpm 报
        # ERR_PNPM_UNEXPECTED_STORE、拒绝升级插件。先检测，不一致就重建对齐。
        $modulesYaml = Join-Path $profileDir 'node_modules\.modules.yaml'
        $wantStore   = $storeDir.TrimEnd('\') -replace '\\', '/'
        $needAlign   = $true
        if (Test-Path $modulesYaml) {
            $m = [regex]::Match((Get-Content $modulesYaml -Raw), '"storeDir"\s*:\s*"([^"]+)"')
            if ($m.Success) {
                $cur = $m.Groups[1].Value -replace '\\', '/' -replace '/v\d+$', ''
                $needAlign = ($cur -ne $wantStore)
            }
        }
        if ($needAlign) {
            # 只修 store 元数据，不重装：便携包被搬动/复制后 node_modules 本身是
            # 完整真实文件，只是 .modules.yaml 记录的 store 路径是旧盘符/旧路径。
            # 全量 pnpm install 要重建几百个包、且便携 store 缺插件包时会大量下载
            # 容易挂死；改成仅把 storeDir/virtualStoreDir 修正到便携 store，随后
            # 插件 add 只需下载新版本增量。
            Write-Step '插件目录 pnpm store 与便携 store 不一致，仅修正 store 元数据……'
            try {
                $yaml = [System.IO.File]::ReadAllText($modulesYaml, [System.Text.Encoding]::UTF8)
                $yamlStore   = ($storeDir + '\v11').Replace('\', '\\')
                $yamlVirtual = (Join-Path $profileDir 'node_modules\.pnpm').Replace('\', '\\')
                $yaml = [regex]::Replace($yaml, '"storeDir":\s*"[^"]*"', ('"storeDir": "' + $yamlStore + '"'))
                $yaml = [regex]::Replace($yaml, '"virtualStoreDir":\s*"[^"]*"', ('"virtualStoreDir": "' + $yamlVirtual + '"'))
                [System.IO.File]::WriteAllText($modulesYaml, $yaml, (New-Object System.Text.UTF8Encoding($false)))
                Write-Step '插件目录 store 元数据已对齐便携 store。'
            }
            catch {
                Write-Step "插件目录 store 元数据修正失败：$($_.Exception.Message)"
                $failed = $true
            }
        }

        if (-not $failed) {
            foreach ($p in $pluginPkgs) {
                if (-not $pluginNews[$p.name]) { continue }
                Write-Step "升级插件 $($p.label) $($script:pluginVersions[$p.name]) → $($latestPlugins[$p.name]) ……"
                # dsh plugin 内部的 pnpm 有时装完不退出（子进程持有输出管道），
                # 直接 & 调用会被永久阻塞。改为输出重定向到文件 + 超时控制：
                # 5 分钟未结束就强制结束进程树，再按“版本是否真更新”判定成败。
                $addOut = Join-Path $logDir 'plugin-add.out.log'
                $addErr = Join-Path $logDir 'plugin-add.err.log'
                Remove-Item $addOut, $addErr -Force -ErrorAction SilentlyContinue
                $pluginCmd = "$dsh plugin --profile web add $($p.name)@$($latestPlugins[$p.name]) --store-dir $($storeDir -replace '\\','/')"
                $pluginProc = Start-Process -FilePath 'cmd.exe' `
                    -ArgumentList @('/c', $pluginCmd) `
                    -WorkingDirectory $root -RedirectStandardOutput $addOut -RedirectStandardError $addErr `
                    -WindowStyle Hidden -PassThru
                if (-not $pluginProc.WaitForExit(300000)) {
                    Write-Step '插件命令 5 分钟未退出，强制结束进程树并检查结果……'
                    & taskkill /PID $pluginProc.Id /T /F 2>$null | Out-Null
                }
                if (Test-Path $addOut) { Get-Content $addOut -Tail 25 | ForEach-Object { Write-Step $_ } }
                if (Test-Path $addErr) { Get-Content $addErr -Tail 8 | ForEach-Object { Write-Step "[err] $_" } }
                $newVer = Get-JsonVersion (Join-Path $profileDir "node_modules\$($p.name)\package.json") 'unknown'
                if ($newVer -eq $latestPlugins[$p.name]) {
                    Write-Step "插件 $($p.label) 已更新到 $newVer。"
                }
                else {
                    Write-Step "插件 $($p.label) 升级未完成（当前 $newVer / 期望 $($latestPlugins[$p.name])）。"
                    $failed = $true
                    break
                }
            }
        }
    }
} finally {
    $env:PATH = $oldPath
}

if ($failed) {
    Write-Step '升级过程中出现问题。可用 rollback-dsh.ps1 -Restore 回滚到升级前版本。'
    exit 1
}

Write-Step '升级完成。'
if (-not (Test-Path $docRuntimeDir)) {
    Write-Step '提示：dsh-doc 的本地 OCR 运行时不存在，请重新下载：'
    Write-Step "  node dsh-home\profiles\web\node_modules\dsh-doc\scripts\fetch-runtime-win32-x64.mjs dsh-home\runtimes\dshdoc-runtime-win32-x64"
}
if (-not $AutoPrompt) {
    $verify = Verify-Boot
    if (-not $verify) {
        Write-Step '建议回滚：rollback-dsh.ps1 -Restore (最近一个备份名)'
    }
}
Write-Step '提示：当前正在运行的旧进程请重启后生效；升级前的备份在 backups\ 目录。'
exit 0
