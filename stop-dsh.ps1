param(
    # 默认端口 3099：本实例常驻 3099，主开发目录的 GUI 常驻 3080。
    # 就算这里误传成 3080，下面有身份校验，也不会杀到主 GUI。
    [int]$Port = 3099
)

$ErrorActionPreference = 'SilentlyContinue'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $root 'dsh.pid'
$killed = @()

# ---- 身份校验：只允许结束"命令行里带本实例路径"的进程 ----
# 两个实例都叫 node.exe，但命令行分别指向各自目录：
#   本实例: ...\deepseek-harness-local\node\bin\node.exe ... --port 3099
#   主 GUI: ...\deepseek-harness\node\bin\node.exe      ... --port 3080
# 用"根路径 + 尾部反斜杠"作标记，二者互不匹配，从机制上杜绝跨杀。
$marker = [regex]::Escape($root.TrimEnd('\') + '\')

function Test-IsThisInstance([int]$procId) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    return ($null -ne $p) -and ($p.CommandLine -match $marker)
}

# 1) 按 PID 文件停止（先校验确实是本实例；陈旧 PID 被系统复用也不会误杀）
if (Test-Path $pidFile) {
    $oldPid = (Get-Content $pidFile -Raw).Trim()
    if ($oldPid -match '^\d+$') {
        if (Test-IsThisInstance ([int]$oldPid)) {
            & taskkill /PID $oldPid /T /F 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $killed += $oldPid }
        }
    }
    Remove-Item $pidFile -Force
}

# 2) 兜底：按端口停止（同样校验身份，跨实例端口也杀不到对方）
$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
    if (Test-IsThisInstance ([int]$c.OwningProcess)) {
        & taskkill /PID $c.OwningProcess /T /F 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $killed += $c.OwningProcess }
    }
}

if ($killed.Count -gt 0) {
    Write-Host "已停止 DeepSeek Harness（PID: $($killed -join ', ')）。" -ForegroundColor Green
} else {
    Write-Host "未发现正在运行的 DeepSeek Harness（端口 $Port）。" -ForegroundColor Yellow
}
