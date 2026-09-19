# ===========================================================================
#  migrate-web-all.ps1 — 把 web profile 的插件全家桶从废弃的
#  @linxin666/dsh-web-ui-all 迁移到新仓库 @linxin666/dsh-web-all
#
#  为什么必须“服务停止后”运行：
#    pnpm 重写 node_modules 需要删除/重命名原生模块（ssh2 / lightningcss /
#    node-pty / cloudflared 等），这些被运行中的 dsh web 进程锁定，Windows 上
#    无法改写——这正是此前在运行中执行 remove/add 卡死、install 报 EPERM 的原因。
#
#  用法（在任意终端，从本文件所在目录执行）：
#    powershell -ExecutionPolicy Bypass -File migrate-web-all.ps1         # 迁移到 dsh-web-all
#    powershell -ExecutionPolicy Bypass -File migrate-web-all.ps1 -RepairOnly  # 只修复回 0.3.5，不迁移
#
#  脚本会：停止服务 → 恢复 lockfile → 迁移 → 校验 bundle 栈。
#  完成后请自行启动：start-dsh.ps1（或 start-dsh.bat / DshDesktop / DshHub）。
# ===========================================================================
param([switch]$RepairOnly)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$web  = Join-Path $root 'dsh-home\profiles\web'
$bak  = Join-Path $root 'dsh-home\.repair-backups\pre-migrate-web-all-20260826-225909'
$store = Join-Path $root 'store'

# ---- 0) 环境 ----
$env:PATH = "$root\tools;$root\node\bin;$env:PATH"
$env:DSH_HOME = Join-Path $root 'dsh-home'

# ---- 1) 停止服务（身份校验安全；已停止则为 no-op） ----
Write-Host '[migrate] 停止 DSH 服务...' -ForegroundColor Cyan
& (Join-Path $root 'stop-dsh.ps1')
Start-Sleep -Milliseconds 800
if (Get-NetTCPConnection -LocalPort 3099 -State Listen -ErrorAction SilentlyContinue) {
    throw '服务未能停止（端口 3099 仍被占用），请先手动关闭后重试。'
}

# ---- 2) 恢复 lockfile 到已知良好状态（若被之前的失败操作改动） ----
if (Test-Path (Join-Path $bak 'pnpm-lock.yaml')) {
    $cur = (Get-FileHash (Join-Path $web 'pnpm-lock.yaml') -Algorithm SHA256).Hash
    $bk  = (Get-FileHash (Join-Path $bak 'pnpm-lock.yaml') -Algorithm SHA256).Hash
    if ($cur -ne $bk) {
        Copy-Item (Join-Path $bak 'pnpm-lock.yaml') (Join-Path $web 'pnpm-lock.yaml') -Force
        Write-Host '[migrate] 已恢复 pnpm-lock.yaml 到已知良好状态' -ForegroundColor Yellow
    }
}

# ---- 3) 执行迁移 / 修复 ----
if ($RepairOnly) {
    Write-Host '[migrate] 仅修复：按 lockfile 重建 node_modules（保持 0.3.5）...' -ForegroundColor Cyan
    & (Join-Path $root 'dsh.cmd') plugin --profile web install --frozen-lockfile --store-dir $store
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install 失败' }
}
else {
    Write-Host '[migrate] 移除旧包 @linxin666/dsh-web-ui-all ...' -ForegroundColor Cyan
    & (Join-Path $root 'dsh.cmd') plugin --profile web remove @linxin666/dsh-web-ui-all --store-dir $store
    if ($LASTEXITCODE -ne 0) { throw '移除旧包失败' }

    Write-Host '[migrate] 安装新包 @linxin666/dsh-web-all ...' -ForegroundColor Cyan
    & (Join-Path $root 'dsh.cmd') plugin --profile web add @linxin666/dsh-web-all --store-dir $store
    if ($LASTEXITCODE -ne 0) { throw '安装新包失败' }
}

# ---- 4) 校验 bundle 栈 ----
$pj = Get-Content (Join-Path $web 'package.json') -Raw | ConvertFrom-Json
Write-Host '--- dsh.profile.bundles ---' -ForegroundColor Cyan
$pj.dsh.profile.bundles | ForEach-Object { Write-Host "  $_" }
$ok = if ($RepairOnly) { $true } else { $pj.dependencies.'@linxin666/dsh-web-all' -and -not $pj.dependencies.'@linxin666/dsh-web-ui-all' }
if ($ok) {
    Write-Host '[完成] 迁移成功。现在可以启动 DSH：start-dsh.ps1（或 start-dsh.bat / DshDesktop）' -ForegroundColor Green
}
else {
    Write-Host '[警告] 校验未通过，请检查上方 bundle 栈与 dependencies' -ForegroundColor Red
}
