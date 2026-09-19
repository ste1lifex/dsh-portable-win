# ===========================================================================
#  DshHub 构建脚本
#  重新生成鲸鱼图标并把 GUI 控制台发布为单文件 DshHub.exe（需 .NET 9）。
#  用法:  powershell -ExecutionPolicy Bypass -File build-hub.ps1
# ===========================================================================
$ErrorActionPreference = 'Stop'

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkgRoot = Split-Path -Parent $here          # ...\dsh
$iconGen = Join-Path $here 'IconGen\IconGen.csproj'
$app     = Join-Path $here 'DshHub\DshHub.csproj'
$publish = Join-Path $here 'publish'

Write-Host "[build] 包根目录: $pkgRoot" -ForegroundColor Cyan

# 1) 生成鲸鱼图标 (DshHub.ico / whale PNG) 到 DshHub 项目目录
Write-Host "[build] 构建 IconGen ..." -ForegroundColor Cyan
dotnet build $iconGen -c Release -v q --nologo | Out-Null
if ($LASTEXITCODE -ne 0) { throw "IconGen 构建失败" }

$iconGenExe = Join-Path $here 'IconGen\bin\Release\net9.0-windows\IconGen.exe'
Write-Host "[build] 生成图标 ..." -ForegroundColor Cyan
& $iconGenExe (Join-Path $here 'DshHub\DshHub.ico') `
              (Join-Path $here 'DshHub\whale-256.png') `
              (Join-Path $here 'DshHub\whale-48.png')
if ($LASTEXITCODE -ne 0) { throw "图标生成失败" }

# 2) 发布单文件 DshHub.exe（自包含 win-x64，内置 .NET 运行时，目标电脑免安装）
#    这样局域网内其他电脑 git pull 后双击即可运行，无需单独安装 .NET。
Write-Host "[build] 发布 DshHub.exe (win-x64, 自包含单文件) ..." -ForegroundColor Cyan
if (Test-Path $publish) { Remove-Item $publish -Recurse -Force }
dotnet publish $app -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -o $publish | Out-Null
if ($LASTEXITCODE -ne 0) { throw "DshHub 发布失败" }

$built = Join-Path $publish 'DshHub.exe'
$dest  = Join-Path $pkgRoot 'DshHub.exe'
Copy-Item $built $dest -Force

Write-Host "[build] 完成: $dest" -ForegroundColor Green
Get-Item $dest | Select-Object FullName, Length, LastWriteTime | Format-List
