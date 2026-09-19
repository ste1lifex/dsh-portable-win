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
try {
    Copy-Item $built $dest -Force
} catch {
    throw "无法覆盖 $dest —— 请先关闭正在运行的 DshDesktop.exe 再重试。$($_.Exception.Message)"
}

Write-Host "[build] 完成: $dest" -ForegroundColor Green
Get-Item $dest | Select-Object FullName, Length, LastWriteTime | Format-List
