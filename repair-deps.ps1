# ===========================================================================
#  repair-deps.ps1 —— 只重建 pnpm 依赖链接，不启动服务
#  Git for Windows (core.symlinks=false) 会把 node_modules 里的符号链接检出成
#  普通文件，导致 @deepseek-ai\dsh 等入口失效。本脚本与 start-dsh.ps1 中的
#  首次修复逻辑一致，供 DshHub 控制台首次启动时自动调用。
#  用法:  powershell -ExecutionPolicy Bypass -File repair-deps.ps1
# ===========================================================================
param()
$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$app     = Join-Path $root 'app-npm'
$bin     = Join-Path $app 'node_modules\@deepseek-ai\dsh\lib\bin.js'
$pnpmCmd = Join-Path $root 'tools\pnpm.cmd'
$storeDir= Join-Path $root 'store'

function Write-Step($msg) { Write-Host "[repair] $msg" }

if (Test-Path -LiteralPath $bin -PathType Leaf) {
    Write-Step '依赖链接已就绪，无需修复。'
    exit 0
}

if (-not (Test-Path -LiteralPath $pnpmCmd -PathType Leaf)) {
    Write-Step "[错误] 缺少 pnpm（$pnpmCmd），无法修复依赖。" 
    exit 1
}

Write-Step '检测到 pnpm 链接失效，开始重建依赖（首次约 1-3 分钟）...'
$oldCI   = $env:CI
$oldPath = $env:PATH
$env:CI  = 'true'
$env:PATH = (Join-Path $root 'node\bin') + ';' + (Join-Path $root 'tools') + ';' + $oldPath

Push-Location $app
try {
    $code = 1
    if (Test-Path -LiteralPath $storeDir -PathType Container) {
        Write-Step '优先使用内置缓存（store\）...'
        & $pnpmCmd install --offline --ignore-scripts --frozen-lockfile --store-dir $storeDir
        $code = $LASTEXITCODE
        if ($code -ne 0) { Write-Step '内置缓存不完整，将联网补齐缺失依赖...' }
    }
    if ($code -ne 0) {
        & $pnpmCmd install --ignore-scripts --frozen-lockfile --store-dir $storeDir
        $code = $LASTEXITCODE
    }
}
finally {
    Pop-Location
    $env:CI   = $oldCI
    $env:PATH = $oldPath
}

if ($code -ne 0 -or -not (Test-Path -LiteralPath $bin -PathType Leaf)) {
    Write-Step "[错误] 依赖修复失败（退出码 $code）。"
    Write-Step '       若当前离线，请在有网络的电脑上先完成一次启动，或恢复 store\ 缓存。'
    exit 1
}

Write-Step '依赖修复完成，核心入口已就绪。'
exit 0
