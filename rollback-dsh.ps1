param(
    [switch]$List,                       # 只列出可用备份
    [string]$Restore                     # 恢复指定备份（backups\ 下的目录名）
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $root 'app-npm'
$profileDir = Join-Path $root 'dsh-home\profiles\web'
$backupRoot = Join-Path $root 'backups'
$pnpmCmd = Join-Path $root 'tools\pnpm.cmd'
$storeDir = Join-Path $root 'store'

function Write-Step($msg) { Write-Host "[rollback] $msg" }

$backups = @()
if (Test-Path $backupRoot) {
    $backups = Get-ChildItem -Directory $backupRoot | Where-Object { $_.Name -like 'app-*' -or $_.Name -like 'pre-rollback-*' } |
        Sort-Object LastWriteTime -Descending
}

if ($List -or $Restore -eq '') {
    if ($backups.Count -eq 0) {
        Write-Step '没有任何备份。'
        return
    }
    Write-Step '可用备份：'
    $i = 0
    foreach ($b in $backups) {
        $info = Join-Path $b.FullName 'README.txt'
        $desc = if (Test-Path $info) { (Get-Content $info -TotalCount 4) -join ' / ' } else { '' }
        Write-Host ("  [{0}] {1}  {2}" -f $i, $b.Name, $desc)
        $i++
    }
    Write-Step '用法：rollback-dsh.ps1 -Restore <备份目录名>'
    return
}

$target = Get-ChildItem -Directory $backupRoot -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq $Restore } | Select-Object -First 1
if ($null -eq $target) {
    Write-Step "找不到备份：$Restore（用 -List 查看）"
    exit 1
}

# 特殊备份：rc.5 源码版（升级前的原始 app + 旧启动脚本）
if (Test-Path (Join-Path $target.FullName '_root-scripts')) {
    $stop = Join-Path $root 'stop-dsh.ps1'
    if (Test-Path $stop) { & $stop | Out-Null }
    $scripts = Join-Path $target.FullName '_root-scripts'
    foreach ($f in @('dsh.cmd', 'start-dsh.bat', 'start-dsh.ps1', 'start-dsh.ps1.bak', 'stop-dsh.bat', 'stop-dsh.ps1', 'stop-dsh.ps1.bak', '.env.example')) {
        $src = Join-Path $scripts $f
        if (Test-Path $src) { Copy-Item $src (Join-Path $root $f) -Force }
    }
    Write-Step "已恢复 rc.5 源码版启动脚本（$($target.Name)）。"
    Write-Step "旧的源码版 app\ 目录仍在原地，直接运行 start-dsh.bat 即可回到 rc.5。"
    Write-Step '提示：app-npm（新版核心）未被删除；想再切回新版时重新运行迁移脚本即可。'
    return
}

if (-not (Test-Path (Join-Path $target.FullName 'app-npm'))) {
    Write-Step "备份 $Restore 不是可自动恢复的格式（缺少 app-npm 子目录）。"
    exit 1
}

# 回滚前先保留当前状态，使回滚本身可逆
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$preDir = Join-Path $backupRoot ("pre-rollback-{0}" -f $stamp)
New-Item -ItemType Directory -Force -Path (Join-Path $preDir 'app-npm') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $preDir 'profiles-web') | Out-Null
foreach ($f in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.env')) {
    $src = Join-Path $app $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $preDir 'app-npm') -Force }
}
foreach ($f in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'cordis.yml')) {
    $src = Join-Path $profileDir $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $preDir 'profiles-web') -Force }
}
Set-Content (Join-Path $preDir 'README.txt') "Pre-rollback state saved $stamp" -Encoding UTF8
Write-Step "已保存当前状态到 $preDir（回滚可逆）"

# 停止服务
$stop = Join-Path $root 'stop-dsh.ps1'
if (Test-Path $stop) { & $stop | Out-Null }

# 恢复 app-npm 配置
foreach ($f in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.env')) {
    $src = Join-Path (Join-Path $target.FullName 'app-npm') $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $app $f) -Force }
}
# 恢复 profiles\web 配置
foreach ($f in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'cordis.yml')) {
    $src = Join-Path (Join-Path $target.FullName 'profiles-web') $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $profileDir $f) -Force }
}

Write-Step '从离线 store 重建核心依赖……'
$oldPath = $env:PATH
$env:PATH = (Join-Path $root 'node\bin') + ';' + $oldPath
try {
    Push-Location $app
    & $pnpmCmd install --offline --frozen-lockfile --store-dir $storeDir
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Write-Step "核心依赖重建失败（$code）。"; exit 1 }
} finally {
    $env:PATH = $oldPath
}

Write-Step '从离线 store 重建插件依赖……'
$oldPath = $env:PATH
$env:PATH = (Join-Path $root 'node\bin') + ';' + $oldPath
try {
    Push-Location $profileDir
    & $pnpmCmd install --offline --frozen-lockfile --store-dir $storeDir
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Write-Step "插件依赖重建失败（$code）。"; exit 1 }
} finally {
    $env:PATH = $oldPath
}

Write-Step "回滚完成：$($target.Name)。现在重新运行 start-dsh.bat 即可。"
Write-Step '提示：你的聊天记录与设置（dsh-home）从未被修改。'
