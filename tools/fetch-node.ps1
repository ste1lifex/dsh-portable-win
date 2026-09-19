<#
  ===========================================================================
   取运行时最小集合：官方 Node（win-x64 便携版）+ pnpm  →  本仓库 node\

   为什么需要它：仓库只放骨架，`node\` 属于大体积载荷（不在 git 里）。
   跑一次本脚本即可让 start-dsh.bat 直接工作（依赖按锁文件联网重建）。

   用法:
     powershell -ExecutionPolicy Bypass -File tools\fetch-node.ps1
     powershell -ExecutionPolicy Bypass -File tools\fetch-node.ps1 -NodeVersion v24.19.0 -PnpmVersion 11.19.0
     powershell -ExecutionPolicy Bypass -File tools\fetch-node.ps1 -Force     # 重下
  ===========================================================================
#>
[CmdletBinding()]
param(
    [string]$NodeVersion = 'v24.19.0',
    [string]$PnpmVersion = '11.19.0',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # 加快 Invoke-WebRequest

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$nodeDir = Join-Path $root 'node'
$binDir = Join-Path $nodeDir 'bin'
$nodeExe = Join-Path $binDir 'node.exe'
$pnpmDir = Join-Path $nodeDir 'node_modules\pnpm'
$pnpmCli = Join-Path $pnpmDir 'bin\pnpm.mjs'

function Step($m) { Write-Host "[fetch-node] $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "[fetch-node] $m" -ForegroundColor Red; exit 1 }

if ((Test-Path $nodeExe) -and (Test-Path $pnpmCli) -and -not $Force) {
    Step "已存在：$nodeExe"
    Step "已存在：$pnpmCli"
    Step "如需重下请加 -Force。"
    & $nodeExe --version
    exit 0
}

# ---- 1) Node ---------------------------------------------------------------
$zipName = "node-$NodeVersion-win-x64.zip"
$url = "https://nodejs.org/dist/$NodeVersion/$zipName"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-fetch-" + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$zipPath = Join-Path $tmp $zipName

Step "下载 Node $NodeVersion ..."
Step "  $url"
try {
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -TimeoutSec 900
} catch {
    Fail "Node 下载失败：$($_.Exception.Message)`n  可手动下载后解压，把 node.exe 放到 $binDir\ ，npm 目录放到 $nodeDir\node_modules\npm\ 再重跑本脚本。"
}

Step "解压 ..."
Expand-Archive -LiteralPath $zipPath -DestinationPath $tmp -Force
$extract = Join-Path $tmp "node-$NodeVersion-win-x64"
if (-not (Test-Path (Join-Path $extract 'node.exe'))) { Fail "解压后找不到 node.exe（$extract）" }

New-Item -ItemType Directory -Force -Path $binDir | Out-Null
Copy-Item (Join-Path $extract 'node.exe') $nodeExe -Force
& $nodeExe --version | ForEach-Object { Step "node: $_" }

# ---- 2) pnpm（用刚下载的 Node 自带 npm 安装，避免自己解 tar） ----------------
New-Item -ItemType Directory -Force -Path (Join-Path $nodeDir 'node_modules') | Out-Null
$npmSrc = Join-Path $extract 'node_modules\npm'
if (Test-Path $npmSrc) {
    Step "安装 pnpm $PnpmVersion ..."
    $npmDest = Join-Path $nodeDir 'node_modules\npm'
    Remove-Item $npmDest -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item $npmSrc $npmDest -Recurse -Force
    try {
        & $nodeExe (Join-Path $npmDest 'bin\npm-cli.js') install -g "pnpm@$PnpmVersion" `
            --prefix $nodeDir --no-audit --no-fund --loglevel=error
        if ($LASTEXITCODE -ne 0) { throw "npm 退出码 $LASTEXITCODE" }
    } finally {
        Remove-Item $npmDest -Recurse -Force -ErrorAction SilentlyContinue
    }
} else {
    Fail "下载到的 Node 里没有 npm，无法安装 pnpm；请手动把 pnpm 解压到 $pnpmDir"
}

if (-not (Test-Path $pnpmCli)) { Fail "pnpm 安装后仍找不到 $pnpmCli" }

# ---- 3) 收尾 ---------------------------------------------------------------
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
# npm 全局安装会在 node\ 下留一堆壳（pnpm.cmd / pnpm.ps1 / pn / pnpx / npx …）；
# 我们只用 tools\pnpm.cmd 去调 node_modules\pnpm\bin\pnpm.mjs，其余清掉保持干净
foreach ($junk in @('npx', 'npx.cmd', 'npx.ps1', 'npm', 'npm.cmd', 'npm.ps1',
                    'corepack', 'corepack.cmd', 'corepack.ps1', 'install_tools.bat',
                    'pn', 'pn.cmd', 'pn.ps1', 'pnpm', 'pnpm.cmd', 'pnpm.ps1',
                    'pnpx', 'pnpx.cmd', 'pnpx.ps1', 'pnx', 'pnx.cmd', 'pnx.ps1')) {
    Remove-Item (Join-Path $nodeDir $junk) -Force -ErrorAction SilentlyContinue
}
Step "完成："
Get-ChildItem $nodeDir -Force | ForEach-Object { Write-Host "   $($_.Name)" }
Step "下一步： start-dsh.bat   （仓库根目录 tools\pnpm.cmd 会自动用到这里的 node 与 pnpm）"
