param(
    # 默认端口 3099：主开发目录的 GUI 常驻 3080，local 包避开它，
    # 两个实例可以同时运行。如需临时换端口: start-dsh.ps1 -Port 1234
    [int]$Port = 3099,
    # 内嵌桌面界面（DshDesktop）用：不自动打开外部浏览器
    [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Always use the bundled harness home (dsh-home) so profiles, plugins, sessions,
# and credentials travel with the portable package. Never touch ~/.dsh.
$bundledHome = Join-Path $root 'dsh-home'
New-Item -ItemType Directory -Force -Path $bundledHome | Out-Null
$env:DSH_HOME = $bundledHome
# $env:DEEPSEEK_BASE_URL="https://api.scnet.cn/api/llm/v1"

$app = Join-Path $root 'app-npm'
$nodeExe = Join-Path $root 'node\bin\node.exe'
$pnpmCmd = Join-Path $root 'tools\pnpm.cmd'
$storeDir = Join-Path $root 'store'
$pidFile = Join-Path $root 'dsh.pid'
$logDir = Join-Path $root 'logs'
$bin = Join-Path $app 'node_modules\@deepseek-ai\dsh\lib\bin.js'
$webProfileDir = Join-Path $bundledHome 'profiles\web'
$startupFallbackPatch = Join-Path $logDir 'startup-fallback.patch.yml'

function Get-MissingProfileDependencies {
    param([string]$ProfileDir)

    $manifestPath = Join-Path $ProfileDir 'package.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "缺少 Web Profile 清单：$manifestPath"
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $missing = @()
    foreach ($property in $manifest.dependencies.PSObject.Properties) {
        $packageJson = Join-Path $ProfileDir ("node_modules\{0}\package.json" -f $property.Name)
        if (-not (Test-Path -LiteralPath $packageJson -PathType Leaf)) {
            $missing += $property.Name
        }
    }
    return @($missing)
}

function Repair-ProfileLinkDependencies {
    param([string]$ProfileDir)

    $manifestPath = Join-Path $ProfileDir 'package.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($property in $manifest.dependencies.PSObject.Properties) {
        $specifier = [string]$property.Value
        if (-not $specifier.StartsWith('link:')) { continue }

        $packageDir = Join-Path $ProfileDir ("node_modules\{0}" -f $property.Name)
        if (Test-Path -LiteralPath (Join-Path $packageDir 'package.json') -PathType Leaf) { continue }

        $relativeTarget = $specifier.Substring('link:'.Length).Replace('/', [IO.Path]::DirectorySeparatorChar)
        $targetDir = [IO.Path]::GetFullPath((Join-Path $ProfileDir $relativeTarget))
        if (-not (Test-Path -LiteralPath (Join-Path $targetDir 'package.json') -PathType Leaf)) { continue }

        $packageParent = Split-Path -Parent $packageDir
        New-Item -ItemType Directory -Force -Path $packageParent | Out-Null
        if (Test-Path -LiteralPath $packageDir) {
            Move-Item -LiteralPath $packageDir -Destination "$packageDir.invalid-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        }
        New-Item -ItemType Junction -Path $packageDir -Target $targetDir | Out-Null
        Write-Host "已重建本地插件链接：$($property.Name)" -ForegroundColor Green
    }
}

function Repair-WebProfileDependencies {
    param([string]$ProfileDir)

    Repair-ProfileLinkDependencies $ProfileDir
    $missing = @(Get-MissingProfileDependencies $ProfileDir)
    if ($missing.Count -eq 0) { return }

    Write-Host ("Web Profile 插件依赖缺失：{0}" -f ($missing -join ', ')) -ForegroundColor Yellow
    Write-Host "正在从锁文件恢复全部插件依赖..." -ForegroundColor Cyan
    $oldCI = $env:CI
    $env:CI = 'true'
    Push-Location $ProfileDir
    try {
        $webInstall = 1
        if (Test-Path -LiteralPath $storeDir -PathType Container) {
            & $pnpmCmd install --offline --force --ignore-scripts --frozen-lockfile --store-dir $storeDir
            $webInstall = $LASTEXITCODE
            if ($webInstall -ne 0) {
                Write-Host "[提示] 内置缓存不完整，将联网补齐缺失依赖..." -ForegroundColor Yellow
            }
        }
        if ($webInstall -ne 0) {
            # 联网安装允许 pnpm-workspace.yaml 中明确放行的原生模块构建。
            & $pnpmCmd install --force --frozen-lockfile --store-dir $storeDir
            $webInstall = $LASTEXITCODE
        }
    }
    finally {
        Pop-Location
        $env:CI = $oldCI
    }

    Repair-ProfileLinkDependencies $ProfileDir
    $stillMissing = @(Get-MissingProfileDependencies $ProfileDir)
    if ($webInstall -ne 0 -or $stillMissing.Count -gt 0) {
        $detail = if ($stillMissing.Count -gt 0) { $stillMissing -join ', ' } else { "pnpm 退出码 $webInstall" }
        throw "Web Profile 插件依赖恢复失败：$detail。请检查网络或 store 离线缓存后重试。"
    }
    Write-Host "Web Profile 插件依赖恢复完成。" -ForegroundColor Green
}

function Initialize-DshDocRuntime {
    param([string]$ProfileDir)

    $dshDocDir = Join-Path $ProfileDir 'node_modules\dsh-doc'
    $dshDocManifest = Join-Path $dshDocDir 'package.json'
    if (-not (Test-Path -LiteralPath $dshDocManifest -PathType Leaf)) { return $null }

    $runtimeDir = Join-Path $bundledHome 'runtimes\dshdoc-runtime-win32-x64'
    $pythonExe = Join-Path $runtimeDir 'python\python.exe'
    $verifyScript = Join-Path $dshDocDir 'scripts\verify-runtime-win32-x64.mjs'
    $fetchScript = Join-Path $dshDocDir 'scripts\fetch-runtime-win32-x64.mjs'

    $runtimeValid = $false
    if ((Test-Path -LiteralPath $pythonExe -PathType Leaf) -and
        (Test-Path -LiteralPath $verifyScript -PathType Leaf)) {
        # Windows PowerShell turns a native program's stderr into an error
        # record.  With the script-wide ErrorActionPreference=Stop, an
        # expected verification failure would abort startup here before the
        # invalid runtime can be quarantined and repaired below.
        $oldErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & $nodeExe $verifyScript $runtimeDir *> $null
            $runtimeValid = ($LASTEXITCODE -eq 0)
        }
        finally {
            $ErrorActionPreference = $oldErrorActionPreference
        }
    }
    if ($runtimeValid) { return $null }

    if (Test-Path -LiteralPath $runtimeDir) {
        $invalidDir = "$runtimeDir.invalid-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        Move-Item -LiteralPath $runtimeDir -Destination $invalidDir
        Write-Host "[提示] 已隔离校验失败的 dsh-doc 运行时：$invalidDir" -ForegroundColor Yellow
    }

    $downloadDisabled = $env:DSH_SKIP_RUNTIME_DOWNLOAD -eq '1'
    if (-not $downloadDisabled -and (Test-Path -LiteralPath $fetchScript -PathType Leaf)) {
        Write-Host "dsh-doc 本地运行时缺失，正在自动下载并校验..." -ForegroundColor Cyan
        & $nodeExe $fetchScript $runtimeDir 2>&1 | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $pythonExe -PathType Leaf)) {
            Write-Host "dsh-doc 本地运行时恢复完成。" -ForegroundColor Green
            return $null
        }
    }

    # dsh-doc is optional. A missing external runtime must not prevent the
    # desktop shell and every unrelated plugin from starting.
    Set-Content -LiteralPath $startupFallbackPatch -Encoding UTF8 -Value @(
        '# Generated by start-dsh.ps1; safe to delete.',
        '- id: dsh-doc',
        '  disabled: true'
    )
    Write-Host "[警告] dsh-doc 运行时恢复失败，本次启动将临时禁用文档/OCR 插件。" -ForegroundColor Yellow
    Write-Host "       修复网络后重启，脚本会自动重试；其他插件和对话不受影响。" -ForegroundColor Yellow
    return $startupFallbackPatch
}

function Test-LocalTcpPort {
    param([int]$TcpPort)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect('127.0.0.1', $TcpPort, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

if (-not (Test-Path $nodeExe)) {
    $nodeExe = 'node'
    Write-Host "[提示] 未找到随包 Node，尝试使用系统 node。" -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Remove-Item -LiteralPath $startupFallbackPatch -Force -ErrorAction SilentlyContinue

# ---- 首次运行/链接损坏：重建 pnpm 依赖 ----
# pnpm 的 node_modules 包含符号链接。Git for Windows 在 core.symlinks=false 时会把
# 它们检出成普通文件，所以必须检查真实入口，不能只检查上级目录。
if (-not (Test-Path -LiteralPath $bin -PathType Leaf)) {
    if (-not (Test-Path -LiteralPath $pnpmCmd -PathType Leaf)) {
        Write-Host "[错误] 缺少 pnpm（$pnpmCmd），无法初始化。" -ForegroundColor Red
        exit 1
    }

    Write-Host "首次运行或 Git 链接需要修复：正在重建依赖..." -ForegroundColor Cyan
    $oldCI = $env:CI
    $env:CI = 'true'
    Push-Location $app
    try {
        $installExit = 1
        if (Test-Path -LiteralPath $storeDir -PathType Container) {
            & $pnpmCmd install --offline --ignore-scripts --frozen-lockfile --store-dir $storeDir
            $installExit = $LASTEXITCODE
            if ($installExit -ne 0) {
                Write-Host "[提示] 内置缓存不完整，将联网补齐缺失依赖..." -ForegroundColor Yellow
            }
        }
        if ($installExit -ne 0) {
            & $pnpmCmd install --ignore-scripts --frozen-lockfile --store-dir $storeDir
            $installExit = $LASTEXITCODE
        }
    }
    finally {
        Pop-Location
        $env:CI = $oldCI
    }
    if ($installExit -ne 0 -or -not (Test-Path -LiteralPath $bin -PathType Leaf)) {
        Write-Host "[错误] 依赖安装失败（退出码 $installExit）。" -ForegroundColor Red
        exit 1
    }
    Write-Host "依赖安装完成。" -ForegroundColor Green
}

# profiles/web/node_modules 不入库。按 package.json 检查每个直接插件依赖，
# 缺失时从锁文件统一恢复；恢复不完整则在启动核心前给出明确错误。
try {
    Repair-WebProfileDependencies $webProfileDir
} catch {
    Write-Host "[错误] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 插件包之外的额外运行时由各插件单独自检。dsh-doc 的 Python/OCR
# 运行时丢失时自动下载并校验；离线恢复失败则仅对本次启动禁用 dsh-doc。
$optionalStartupPatch = Initialize-DshDocRuntime $webProfileDir

# 旧便携包把 profiles/node_modules 作为真实目录提交到 Git，但新版 DSH 要求
# 自己管理该目录下的 Junction。首次启动时保留一份可恢复备份并让 DSH 重建。
$profilesModules = Join-Path $bundledHome 'profiles\node_modules'
if (Test-Path -LiteralPath $profilesModules) {
    $profilesModulesItem = Get-Item -LiteralPath $profilesModules -Force
    $managedDsh = Join-Path $profilesModules '@deepseek-ai\dsh'
    if ((Test-Path -LiteralPath $managedDsh) -and
        -not ((Get-Item -LiteralPath $managedDsh -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        $repairRoot = Join-Path $bundledHome '.repair-backups'
        New-Item -ItemType Directory -Force -Path $repairRoot | Out-Null
        $repairTarget = Join-Path $repairRoot ("profiles-node_modules-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        Move-Item -LiteralPath $profilesModules -Destination $repairTarget
        Write-Host "[提示] 已备份 Git 检出的旧依赖目录：$repairTarget" -ForegroundColor Yellow
    }
}

if (-not (Test-Path $bin)) {
    Write-Host "[错误] 找不到 $bin，请确认目录结构完整。" -ForegroundColor Red
    exit 1
}

# ---- 生成 .env（如不存在），并读取里面的变量传给子进程 ----
$envFile = Join-Path $app '.env'
if (-not (Test-Path $envFile)) {
    $example = Join-Path $root '.env.example'
    if (Test-Path $example) {
        Copy-Item $example $envFile
        Write-Host "[提示] 已生成 .env 模板：$envFile" -ForegroundColor Yellow
        Write-Host "       请打开该文件填入 DEEPSEEK_API_KEY 后重新启动。" -ForegroundColor Yellow
    }
}

if (Test-Path $envFile) {
    Get-Content $envFile | Where-Object {
        $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' -and $_ -notmatch '^\s*#'
    } | ForEach-Object {
        $kv = $_ -split '=', 2
        $name = $kv[0].Trim()
        $value = $kv[1].Trim().Trim('"').Trim("'")
        if ($value) {
            Set-Item -Path "Env:$name" -Value $value -ErrorAction SilentlyContinue
        }
    }
}

# ---- 禁用自动更新检查 ----
# rc.8 起核心禁止在 .env 中声明任何 DSH_* 变量（属于“仅启动环境可设置”），
# 因此这里由启动脚本以进程环境变量方式设置并随子进程继承；
# 需要手动升级时仍可运行: update-dsh.ps1 -Check / -Yes
$env:DSH_NO_UPDATE_CHECK = '1'

# ---- 端口占用检查：已在运行就直接开浏览器 ----
if (Test-LocalTcpPort $Port) {
    Write-Host "DeepSeek Harness 已在运行：http://127.0.0.1:$Port" -ForegroundColor Green
    if (-not $NoOpen) { Start-Process "http://127.0.0.1:$Port" }
    exit 0
}

# ---- 启动前检查更新（离线自动跳过；设置 DSH_NO_UPDATE_CHECK=1 可关闭）----
if ($env:DSH_NO_UPDATE_CHECK -ne '1') {
    $updater = Join-Path $root 'update-dsh.ps1'
    if (Test-Path $updater) {
        & $updater -AutoPrompt
    }
}

# ---- 清理失效的 PID 文件 ----
if (Test-Path $pidFile) {
    $oldPid = (Get-Content $pidFile -Raw).Trim()
    if ($oldPid) {
        $proc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
        if (-not $proc) {
            Remove-Item $pidFile -Force
        }
    }
}

# ---- 后台启动服务 ----
$stdout = Join-Path $logDir 'dsh-web.out.log'
$stderr = Join-Path $logDir 'dsh-web.err.log'

# 让核心打开带有本次进程认证 token 的 URL。升级到开启 Web 认证的核心后，
# 包装脚本自行打开裸地址会直接收到 401。
$nodeArgs = @($bin, 'web')
if ($optionalStartupPatch) {
    $nodeArgs += @('--patch', $optionalStartupPatch)
}
$nodeArgs += @('--port', "$Port")
if ($NoOpen) { $nodeArgs += '--no-open' }
Write-Host "正在启动 DeepSeek Harness（端口 $Port）..."
$proc = Start-Process -FilePath $nodeExe `
    -ArgumentList $nodeArgs `
    -WorkingDirectory $app `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -WindowStyle Hidden `
    -PassThru

Set-Content -Path $pidFile -Value $proc.Id

# ---- 等待端口就绪（最多 90 秒）----
$ready = $false
for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    if (Test-LocalTcpPort $Port) {
        $ready = $true
        break
    }
    if ($proc.HasExited) {
        break
    }
}

if ($ready) {
    Write-Host "启动成功：http://127.0.0.1:$Port" -ForegroundColor Green
    Write-Host "关闭服务请运行 stop-dsh.bat（或手动结束进程 PID $($proc.Id)）。"
    Write-Host "日志：$logDir"
} else {
    Write-Host "[错误] 服务启动失败，日志最后 20 行：" -ForegroundColor Red
    if (Test-Path $stdout) { Get-Content $stdout -Tail 20 }
    if (Test-Path $stderr) { Get-Content $stderr -Tail 20 }
    exit 1
}
