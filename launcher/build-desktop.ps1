# ===========================================================================
#  DshDesktop 构建脚本 —— 桌面版（内嵌 WebView2 的 DSH 界面）
#  自包含单文件（内置 .NET 运行时，目标电脑免安装）。
#  用法:  powershell -ExecutionPolicy Bypass -File build-desktop.ps1
# ===========================================================================
$ErrorActionPreference = 'Stop'

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkgRoot = Split-Path -Parent $here          # ...\dsh
$app     = Join-Path $here 'DshDesktop\DshDesktop.csproj'
$publish = Join-Path $here 'publish-desktop'

# ---------------------------------------------------------------------------
# 定位可用的 .NET SDK：PATH -> 本机用户级安装 -> 包内 dotnet\ -> 系统安装
# （只装了运行时而没有 SDK 的机器上，`dotnet` 命令存在但 --list-sdks 为空，
#   所以这里不能只看命令是否存在，必须真的列出 SDK。）
# ---------------------------------------------------------------------------
function Resolve-DotnetSdk {
    $candidates = @()
    $cmd = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
    $candidates += (Join-Path $env:LOCALAPPDATA 'Microsoft\dotnet\dotnet.exe')
    $candidates += (Join-Path $pkgRoot 'dotnet\dotnet.exe')
    $candidates += (Join-Path $here 'dotnet\dotnet.exe')
    $candidates += 'C:\Program Files\dotnet\dotnet.exe'
    foreach ($c in ($candidates | Select-Object -Unique)) {
        if (-not $c -or -not (Test-Path $c)) { continue }
        try {
            $sdks = & $c --list-sdks 2>$null
            if ($LASTEXITCODE -eq 0 -and $sdks) { return $c }
        } catch { }
    }
    return $null
}

$dotnet = Resolve-DotnetSdk
if (-not $dotnet) {
    throw "找不到 .NET 9 SDK。请先安装 .NET 9 SDK，或把便携版 SDK 放到 $pkgRoot\dotnet\ 后重试。"
}
Write-Host "[build] 使用 SDK: $dotnet" -ForegroundColor DarkGray

$env:DOTNET_ROOT = Split-Path -Parent $dotnet
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'

Write-Host "[build] 发布 DshDesktop.exe (win-x64, 自包含单文件) ..." -ForegroundColor Cyan
if (Test-Path $publish) { Remove-Item $publish -Recurse -Force }
& $dotnet publish $app -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -o $publish | Out-Null
if ($LASTEXITCODE -ne 0) { throw "DshDesktop 发布失败" }

$built = Join-Path $publish 'DshDesktop.exe'
$dest  = Join-Path $pkgRoot 'DshDesktop.exe'

# 正在运行的桌面版会占住自己的映像文件，直接覆盖会报共享冲突。Windows 仍允许
# 在同一卷内“重命名”正在运行的映像，所以退路是：把在用 exe 改名留存，再把新
# 构建放到原名。正在运行的窗口继续跑旧映像，关掉重开即生效，改名的那份可回滚。
try {
    Copy-Item $built $dest -Force -ErrorAction Stop
    Write-Host "[build] 已更新 DshDesktop.exe（桌面版未在运行）。" -ForegroundColor Green
}
catch {
    $retired = "$dest.old-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    try {
        Move-Item -LiteralPath $dest -Destination $retired -ErrorAction Stop
        Copy-Item $built $dest -Force -ErrorAction Stop
        Write-Host "[build] 桌面版正在运行：旧映像已改名保留为 $(Split-Path $retired -Leaf)，新版本已就位。" -ForegroundColor Yellow
        Write-Host "        关闭并重新打开桌面版后生效；确认无误后可删除那个 .old-* 文件。" -ForegroundColor Yellow
    }
    catch {
        # 复制失败时把改名操作还原，别让根目录缺 exe。
        if ((Test-Path -LiteralPath $retired) -and -not (Test-Path -LiteralPath $dest)) {
            Move-Item -LiteralPath $retired -Destination $dest -ErrorAction SilentlyContinue
        }
        throw "无法覆盖 $dest —— 请先关闭正在运行的 DshDesktop.exe 再重试。$($_.Exception.Message)"
    }
}

Write-Host "[build] 完成: $dest" -ForegroundColor Green
Get-Item $dest | Select-Object FullName, Length, LastWriteTime | Format-List
