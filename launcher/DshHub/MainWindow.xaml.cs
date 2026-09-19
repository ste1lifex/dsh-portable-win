using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

namespace DshHub;

public sealed class LogLine
{
    public string Text { get; }
    public Brush Brush { get; }
    public LogLine(string text, Brush brush) { Text = text; Brush = brush; }
}

public partial class MainWindow : Window
{
    private const int Port = 3099;

    private static readonly Brush BDefault = Freeze(0xC9D1DF);
    private static readonly Brush BDim = Freeze(0x6B7484);
    private static readonly Brush BInfo = Freeze(0x7DD3FC);
    private static readonly Brush BGood = Freeze(0x34D399);
    private static readonly Brush BWarn = Freeze(0xFBBF24);
    private static readonly Brush BBad = Freeze(0xF87171);
    private static readonly Brush BAccent = Freeze(0x4D6BFE);

    // badge palettes
    private static readonly Brush BadgeGreenBg = Freeze(0x0E2B22);
    private static readonly Brush BadgeGreenFg = Freeze(0x34D399);
    private static readonly Brush BadgeAmberBg = Freeze(0x2E2510);
    private static readonly Brush BadgeAmberFg = Freeze(0xFBBF24);
    private static readonly Brush BadgeGrayBg = Freeze(0x1C212B);
    private static readonly Brush BadgeGrayFg = Freeze(0x8A94A6);
    private static readonly Brush BadgeRedBg = Freeze(0x33151B);
    private static readonly Brush BadgeRedFg = Freeze(0xF87171);

    private static Brush Freeze(int rgb)
    {
        var b2 = new SolidColorBrush(Color.FromRgb(
            (byte)((rgb >> 16) & 0xFF),
            (byte)((rgb >> 8) & 0xFF),
            (byte)(rgb & 0xFF)));
        b2.Freeze();
        return b2;
    }

    private readonly string _root;
    private readonly DispatcherTimer _statusTimer;
    private bool _busy;
    private bool _linksReady;
    private bool _repairAttempted;
    private string? _coreLocal;
    private string? _webUiLocal;
    private string? _docLocal;

    public MainWindow()
    {
        InitializeComponent();
        // 用 exe 所在目录作为包根目录。单文件发布时 AppContext.BaseDirectory
        // 在不同 .NET 版本下行为有差异，Environment.ProcessPath 始终指向 exe 本体。
        _root = Path.GetDirectoryName(Environment.ProcessPath)?.TrimEnd('\\')
                ?? AppContext.BaseDirectory.TrimEnd('\\');

        var ver = Assembly.GetExecutingAssembly().GetName().Version;
        TitleVersionText.Text = "控制台 v" + (ver == null ? "1.0.0" : ver.ToString(3));

        _statusTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
        _statusTimer.Tick += (_, _) => RefreshStatus();

        Loaded += (_, _) =>
        {
            ClampWindowIntoWorkArea();
            LogLine("— DeepSeek Harness 控制台已启动 —", BDim);
            LogLine($"安装目录：{_root}", BDefault);
            PrepareEnvironment();
            RefreshStatus();
            _statusTimer.Start();
            _ = LoadVersionsAsync();
        };

        Closed += (_, _) => _statusTimer.Stop();
    }

    // =====================================================================
    //  首次启动环境自检/准备
    //  便携包刚克隆/解压到新电脑时，dsh-home、logs 可能尚未生成，app-npm\.env
    //  可能缺失，node_modules 的 pnpm 链接可能是坏文件。这里在启动阶段就
    //  补齐目录、生成 .env 模板，并校验关键文件，环境不全时给出明确提示。
    // =====================================================================

    private bool _environmentReady = true;

    private void PrepareEnvironment()
    {
        var problems = new List<string>();

        // 1) 基础目录
        try
        {
            Directory.CreateDirectory(Path.Combine(_root, "dsh-home"));
            Directory.CreateDirectory(LogDir);
        }
        catch (Exception ex)
        {
            problems.Add($"无法创建目录：{ex.Message}");
        }

        // 2) app-npm\.env 缺失时从模板生成
        var envFile = Path.Combine(AppDir, ".env");
        if (!File.Exists(envFile))
        {
            var example = Path.Combine(_root, ".env.example");
            if (File.Exists(example))
            {
                try
                {
                    Directory.CreateDirectory(AppDir);
                    File.Copy(example, envFile);
                    LogLine($"[提示] 首次运行：已生成 .env 模板 → {envFile}", BWarn);
                    LogLine("       请打开该文件填入 DEEPSEEK_API_KEY 后再点「启动服务」。", BWarn);
                    SetFooter("首次运行：请先在 app-npm\\.env 填入 API Key");
                }
                catch (Exception ex)
                {
                    problems.Add($"生成 .env 失败：{ex.Message}");
                }
            }
            else
            {
                LogLine("[提示] 未找到 .env.example，将不生成 .env（首次运行需手动准备）。", BWarn);
            }
        }

        // 3) 校验关键文件
        var problems2 = new List<string>();
        bool ok = VerifyCriticalFiles(problems2);
        foreach (var p in problems2)
            problems.Add(p);

        _environmentReady = problems.Count == 0;
        if (_environmentReady)
        {
            LogLine("环境检查通过。", BGood);
        }
        else
        {
            foreach (var p in problems)
                LogLine("[错误] 环境问题：" + p, BBad);
            LogLine("环境不完整：请确认完整解压/克隆了便携包目录后重试。", BBad);
            SetFooter("环境不完整，见运行日志");
            StatusDot.Fill = BBad;
            StatusText.Text = "环境异常";
            StatusDetail.Text = "缺少关键文件，详见运行日志";
            return;
        }

        // 4) pnpm 链接完整性：Git 检出的符号链接可能是坏文件，需要重建依赖
        _linksReady = File.Exists(CoreBinJs);
        if (!_linksReady)
        {
            LogLine("[提示] 依赖链接未就绪：Git 检出的 pnpm 符号链接可能已失效。", BWarn);
            LogLine("       正在自动重建依赖（repair-deps.ps1，首次约 1-3 分钟）...", BWarn);
            SetFooter("首次运行：正在重建依赖...");
            if (!_repairAttempted)
            {
                _repairAttempted = true;
                _ = RepairLinksAsync();
            }
        }
    }

    // 自动修复依赖链接（不启动服务；与 start-dsh.ps1 首次修复逻辑一致）
    private async Task RepairLinksAsync()
    {
        SetBusy(true);
        try
        {
            await RunPowerShellAsync("repair-deps.ps1", "", "重建依赖");
            _linksReady = File.Exists(CoreBinJs);
            if (_linksReady)
            {
                LogLine("依赖已就绪。", BGood);
                SetFooter("依赖就绪，可点击「启动服务」");
            }
            else
            {
                LogLine("依赖仍未就绪：若当前离线，请在有网络的电脑上先完成一次启动，或恢复 store\\ 缓存后重试。", BWarn);
                SetFooter("依赖修复未完成，见运行日志");
            }
            _ = LoadVersionsAsync();
            RefreshStatus();
        }
        catch (Exception ex)
        {
            LogLine($"[错误] 自动修复依赖异常：{ex.Message}", BBad);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private bool VerifyCriticalFiles(List<string> problems)
    {
        var required = new (string label, string path)[]
        {
            ("启动脚本", ScriptPath("start-dsh.ps1")),
            ("停止脚本", ScriptPath("stop-dsh.ps1")),
            ("更新脚本", ScriptPath("update-dsh.ps1")),
            ("Node 运行时", Path.Combine(_root, "node", "bin", "node.exe")),
            ("应用清单", Path.Combine(AppDir, "package.json")),
        };
        bool ok = true;
        foreach (var (label, path) in required)
        {
            if (!File.Exists(path))
            {
                problems.Add($"{label} 缺失：{path}");
                ok = false;
            }
        }
        return ok;
    }

    // =====================================================================
    //  确保标题栏（最小化/关闭按钮）落在屏幕可见区内
    //  多显示器/远程桌面下 WindowStartupLocation=CenterScreen 可能把窗口顶出
    //  屏幕上方，导致标题栏按钮不可见不可点。启动时钳位到所在显示器工作区。
    // =====================================================================

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    private void ClampWindowIntoWorkArea()
    {
        try
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            if (hwnd == IntPtr.Zero) return;
            var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
            if (!GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref mi)) return; // 2 = DEFAULTTONEAREST

            var wa = mi.rcWork;
            int x = (int)Left, y = (int)Top;
            int width = (int)Width, height = (int)Height;
            int minX = wa.Left, minY = wa.Top;
            int maxX = wa.Right - Math.Min(80, width);
            int maxY = wa.Bottom - Math.Min(80, height);
            if (maxX < minX || maxY < minY) return;

            int nx = Math.Clamp(x, minX, maxX);
            int ny = Math.Clamp(y, minY, maxY);
            if (nx != x) Left = nx;
            if (ny != y) Top = ny;
        }
        catch { /* ignore */ }
    }

    // =====================================================================
    //  Paths / context
    // =====================================================================

    private string AppDir => Path.Combine(_root, "app-npm");
    private string ProfilesWeb => Path.Combine(_root, "dsh-home", "profiles", "web");
    private string CorePkgJson => Path.Combine(AppDir, "node_modules", "@deepseek-ai", "dsh", "package.json");
    private string CoreBinJs => Path.Combine(AppDir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
    private string PidFile => Path.Combine(_root, "dsh.pid");
    private string LogDir => Path.Combine(_root, "logs");
    private string BackupDir => Path.Combine(_root, "backups");
    private string OcrRuntimeDir => Path.Combine(_root, "dsh-home", "runtimes", "dshdoc-runtime-win32-x64");

    private string ScriptPath(string name) => Path.Combine(_root, name);

    // =====================================================================
    //  Status
    // =====================================================================

    private bool PortListening()
    {
        try
        {
            using var tcp = new TcpClient();
            var t = tcp.ConnectAsync(IPAddress.Loopback, Port);
            if (t.Wait(700) && tcp.Connected) return true;
        }
        catch { /* not listening */ }
        return false;
    }

    private async Task<bool> WaitForPortAsync(bool wantUp, int timeoutMs)
    {
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            if (PortListening() == wantUp) return true;
            await Task.Delay(300);
        }
        return PortListening() == wantUp;
    }

    private int? ReadRunningPid()
    {
        try
        {
            if (File.Exists(PidFile))
            {
                var raw = File.ReadAllText(PidFile).Trim();
                if (int.TryParse(raw, out var p))
                {
                    var proc = Process.GetProcessById(p);
                    if (proc is not null && proc.ProcessName.Equals("node", StringComparison.OrdinalIgnoreCase))
                        return p;
                }
            }
        }
        catch { /* process gone / access denied */ }
        return null;
    }

    private bool IsRunning(out int? pid)
    {
        pid = ReadRunningPid();
        return PortListening();
    }

    private void RefreshStatus()
    {
        // 环境未就绪时保持“环境异常”提示；若用户修复了文件则自动恢复。
        if (!_environmentReady)
        {
            _environmentReady = VerifyCriticalFiles(new List<string>());
            if (!_environmentReady) return;
            LogLine("环境检查通过。", BGood);
        }

        bool running = IsRunning(out var pid);
        StatusDot.Fill = running ? BGood : BAccent;
        StatusText.Text = running ? "运行中" : "未运行";
        StatusDetail.Text = running
            ? $"http://127.0.0.1:{Port}  ·  PID {pid?.ToString() ?? "?"}"
            : $"http://127.0.0.1:{Port}  ·  点击「启动服务」开始";
        BtnOpenUi.IsEnabled = running;
    }

    private void SetBannerBusy(string text, string detail)
    {
        StatusDot.Fill = BWarn;
        StatusText.Text = text;
        StatusDetail.Text = detail;
    }

    private void Status_Click(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        if (_busy) return;
        RefreshStatus();
        LogLine($"[操作] 手动刷新状态：{(PortListening() ? "运行中" : "未运行")}", BDefault);
    }

    // =====================================================================
    //  Logging
    // =====================================================================

    private void DispatchLog(string line)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.BeginInvoke(() => AddLog(line));
            return;
        }
        AddLog(line);
    }

    private void AddLog(string line)
    {
        LogList.Items.Add(new LogLine(string.IsNullOrEmpty(line) ? " " : line, Colorize(line)));
        while (LogList.Items.Count > 4000)
            LogList.Items.RemoveAt(0);
        LogCountText.Text = $"{LogList.Items.Count} 行";
        LogScroll.ScrollToEnd();
    }

    private static Brush Colorize(string line)
    {
        if (line.Contains("[update]", StringComparison.OrdinalIgnoreCase)) return BInfo;
        if (line.Contains("错误", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("失败", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("exception", StringComparison.OrdinalIgnoreCase)) return BBad;
        if (line.Contains("成功", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("完成", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("已停止", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("已最新", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("自检通过", StringComparison.OrdinalIgnoreCase)) return BGood;
        if (line.Contains("提示", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("警告", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("注意", StringComparison.OrdinalIgnoreCase) ||
            line.StartsWith("—")) return BWarn;
        if (line.StartsWith("  ")) return BDim;
        return BDefault;
    }

    private void SetFooter(string text)
        => FooterText.Text = text;

    private void ClearLog_Click(object sender, RoutedEventArgs e)
    {
        LogList.Items.Clear();
        LogCountText.Text = "";
    }

    // =====================================================================
    //  Running PowerShell engine scripts (start / stop / update)
    // =====================================================================

    private async Task<int> RunPowerShellAsync(string scriptName, string args, string? label)
    {
        var script = ScriptPath(scriptName);
        if (!File.Exists(script))
        {
            LogLine($"[错误] 找不到脚本：{script}", BBad);
            return 999;
        }

        if (!string.IsNullOrEmpty(label))
            LogLine($"[操作] {label}", BAccent);

        var psi = new ProcessStartInfo("powershell.exe")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = _root,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        string body = $"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; & '{script.Replace("'", "''")}' {args}";
        psi.Arguments = $"-NoProfile -ExecutionPolicy Bypass -Command \"{body}\"";

        using var proc = new Process { StartInfo = psi };
        proc.OutputDataReceived += (_, e) => { if (e.Data is not null) DispatchLog(e.Data); };
        proc.ErrorDataReceived += (_, e) => { if (e.Data is not null) DispatchLog(e.Data); };

        try
        {
            proc.Start();
        }
        catch (Exception ex)
        {
            DispatchLog($"[错误] 无法启动 PowerShell：{ex.Message}");
            return 999;
        }

        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();

        // 等待进程退出。注意：不能用 WaitForExitAsync()/WaitForExit()——
        // 当脚本通过 Start-Process 启动常驻后代（如 node 服务）时，后代会
        // 继承输出管道句柄，管道永远到不了 EOF，WaitForExitAsync 会一直挂起
        // （表现为“启动后按钮全灰、鼠标转圈”）。这里改为轮询进程退出状态，
        // 进程一退出即返回，不等待管道 EOF；异步输出读取继续在后台投递日志。
        var waitSw = Stopwatch.StartNew();
        while (!proc.WaitForExit(0))
        {
            if (waitSw.Elapsed.TotalMinutes > 15)
            {
                DispatchLog("[错误] 脚本运行超过 15 分钟，已强制结束。");
                try { proc.Kill(entireProcessTree: true); } catch { /* ignore */ }
                break;
            }
            await Task.Delay(150);
        }

        int code = proc.HasExited ? proc.ExitCode : 999;
        LogLine($"[完成] {scriptName} 退出码 {code}", code == 0 ? BGood : BWarn);
        return code;
    }

    private void LogLine(string text, Brush brush)
    {
        if (!Dispatcher.CheckAccess()) { Dispatcher.BeginInvoke(() => AddLogRaw(text, brush)); return; }
        AddLogRaw(text, brush);
    }

    private void AddLogRaw(string text, Brush brush)
    {
        LogList.Items.Add(new LogLine(text, brush));
        while (LogList.Items.Count > 4000) LogList.Items.RemoveAt(0);
        LogCountText.Text = $"{LogList.Items.Count} 行";
        LogScroll.ScrollToEnd();
    }

    // =====================================================================
    //  Busy gating
    // =====================================================================

    private void SetBusy(bool busy)
    {
        _busy = busy;
        BtnStart.IsEnabled = !busy;
        BtnStop.IsEnabled = !busy;
        BtnRestart.IsEnabled = !busy;
        BtnUpdate.IsEnabled = !busy;
        BtnCheckUpdate.IsEnabled = !busy;
        Cursor = busy ? System.Windows.Input.Cursors.Wait : System.Windows.Input.Cursors.Arrow;
    }

    // =====================================================================
    //  Close behavior: ask whether to stop the service on exit
    // =====================================================================

    private bool _allowClose;
    private bool _closePromptOpen;

    protected override void OnClosing(CancelEventArgs e)
    {
        if (_allowClose)
        {
            base.OnClosing(e);
            return;
        }

        bool running = IsRunning(out _);
        if (!running)
        {
            base.OnClosing(e);
            return;
        }

        e.Cancel = true;
        // 重入保护：窗口可能同时收到多个关闭请求（如排队中的 WM_CLOSE /
        // 快速双击），此时已在弹窗等待，直接忽略即可。
        if (_closePromptOpen) return;
        // 正在“停止并退出”流程中：忽略后续关闭请求，避免再次弹窗打断停止。
        if (_stoppingForExit) return;

        _closePromptOpen = true;
        try
        {
            var choice = AskDialog.Show(this, "关闭控制台",
                "DeepSeek Harness 服务正在运行。\n关闭控制台时是否同时停止服务？\n\n选择「仅退出」后服务会继续在后台运行，\n可稍后用本控制台或 stop-dsh.bat 停止。",
                ("停止并退出", AskResult.Yes, true),
                ("仅退出", AskResult.No, false),
                ("取消", AskResult.Cancel, false));

            if (choice == AskResult.Yes)
            {
                SetFooter("正在停止服务…");
                SetBannerBusy("正在停止…", $"http://127.0.0.1:{Port}");
                _ = StopThenCloseAsync();
            }
            else if (choice == AskResult.No)
            {
                _allowClose = true;
                // 延迟到下一调度节拍关闭，避免在 OnClosing 栈内再次 Close 触发
                // VerifyNotClosing。
                _ = Dispatcher.BeginInvoke(Close);
            }
        }
        catch (Exception ex)
        {
            // 极端重入/竞态下，模态循环可能抛出 VerifyNotClosing 之类的异常；
            // 捕获后保留窗口，绝不因此崩溃。
            LogLine($"[错误] 关闭确认框异常：{ex.Message}", BBad);
        }
        finally
        {
            _closePromptOpen = false;
        }
    }

    private bool _stoppingForExit;

    private async Task StopThenCloseAsync()
    {
        _stoppingForExit = true;
        SetBusy(true);
        try
        {
            await RunPowerShellAsync("stop-dsh.ps1", "", "退出前停止服务");
            await WaitForPortAsync(false, 6000);
        }
        catch (Exception ex)
        {
            LogLine($"[错误] 退出前停止服务异常：{ex.Message}", BBad);
        }
        finally
        {
            SetBusy(false);
        }
        _allowClose = true;
        _ = Dispatcher.BeginInvoke(Close);
    }

    // =====================================================================
    //  Actions
    // =====================================================================

    private async void Start_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;
        SetBusy(true);
        SetFooter("正在启动服务…");
        SetBannerBusy("正在启动…", $"http://127.0.0.1:{Port}");
        try
        {
            int code = await RunPowerShellAsync("start-dsh.ps1", "", "启动服务");
            bool up = code == 0 && await WaitForPortAsync(true, 10000);
            SetFooter(up ? "启动完成，服务已运行" : "启动未成功，请查看上方日志");
            if (!up) LogLine("警告：未检测到服务监听，请查看 logs\\dsh-web.err.log。", BWarn);
        }
        finally
        {
            SetBusy(false);
            RefreshStatus();
        }
    }

    private async void Stop_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;
        SetBusy(true);
        SetFooter("正在停止服务…");
        SetBannerBusy("正在停止…", $"http://127.0.0.1:{Port}");
        try
        {
            int code = await RunPowerShellAsync("stop-dsh.ps1", "", "停止服务");
            bool down = code == 0 && await WaitForPortAsync(false, 6000);
            SetFooter(down ? "服务已停止" : "停止操作完成，请查看上方日志");
        }
        finally
        {
            SetBusy(false);
            RefreshStatus();
        }
    }

    private async void Restart_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;
        SetBusy(true);
        SetFooter("正在重启服务…");
        SetBannerBusy("正在重启…", $"http://127.0.0.1:{Port}");
        try
        {
            await RunPowerShellAsync("stop-dsh.ps1", "", "重启：先停止");
            // 等旧进程完全释放端口，避免 start 脚本误判「已在运行」而直接退出
            await WaitForPortAsync(false, 6000);
            await RunPowerShellAsync("start-dsh.ps1", "", "重启：再启动");
            bool up = await WaitForPortAsync(true, 12000);
            SetFooter(up ? "重启完成，服务已运行" : "重启完成，但未检测到端口监听");
            if (!up) LogLine("警告：重启后未检测到服务，请查看 logs\\dsh-web.err.log。", BWarn);
            RefreshStatus();
            // 再延迟复查一次，防止监听出现得稍晚
            _ = Task.Delay(1500).ContinueWith(_ => Dispatcher.Invoke(RefreshStatus));
        }
        finally
        {
            SetBusy(false);
            RefreshStatus();
        }
    }

    private async void CheckUpdate_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;
        if (!_linksReady)
        {
            LogLine("[提示] 核心依赖尚未就绪，检查结果可能不完整（正在后台重建依赖）。", BWarn);
        }
        SetBusy(true);
        SetFooter("正在检查更新…");
        try
        {
            int code = await RunPowerShellAsync("update-dsh.ps1", "-Check", "检查更新");
            SetFooter(code == 0 ? "检查完成" : "检查未能完成，请查看日志");
            await LoadVersionsAsync();
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async void Update_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;

        bool running = IsRunning(out _);
        string msg = running
            ? "更新前会先停止当前服务（自动备份 → 升级 → 自检），\n完成后需要手动重新启动服务。\n\n确定现在开始更新吗？"
            : "将自动备份当前版本并升级到最新版（含自检）。\n\n确定现在开始更新吗？";

        var choice = AskDialog.Show(this, "立即更新", msg,
            ("开始更新", AskResult.Yes, true),
            ("取消", AskResult.Cancel, false));
        if (choice != AskResult.Yes) return;

        SetBusy(true);
        SetFooter("正在更新…（可能需要几分钟，请勿关闭）");
        try
        {
            int code = await RunPowerShellAsync("update-dsh.ps1", "-Yes", "更新 DSH 核心与插件");
            if (code == 0)
            {
                SetFooter("更新完成，请点击「启动服务」以应用新版本");
                LogLine("更新完成。服务当前已停止，点击「启动服务」即可应用新版本。", BGood);
            }
            else
            {
                SetFooter("更新未完成，请查看日志（可用 rollback-dsh.ps1 回滚）");
            }
            await LoadVersionsAsync();
        }
        finally
        {
            SetBusy(false);
            RefreshStatus();
        }
    }

    // =====================================================================
    //  Versions
    // =====================================================================

    private static string? ReadJsonVersion(string pkgJsonPath)
    {
        try
        {
            if (!File.Exists(pkgJsonPath)) return null;
            var text = File.ReadAllText(pkgJsonPath, Encoding.UTF8);
            var m = Regex.Match(text, "\"version\"\\s*:\\s*\"([^\"]+)\"");
            return m.Success ? m.Groups[1].Value : null;
        }
        catch { return null; }
    }

    private static async Task<string?> GetNpmLatestAsync(string pkg)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
            var url = "https://registry.npmjs.org/" + pkg.Replace("/", "%2f") + "/latest";
            var json = await http.GetStringAsync(url);
            var m = Regex.Match(json, "\"version\"\\s*:\\s*\"([^\"]+)\"");
            return m.Success ? m.Groups[1].Value : null;
        }
        catch { return null; }
    }

    private static int CompareVersions(string a, string b)
    {
        var pa = a.Split('-');
        var pb = b.Split('-');
        int[] ma = pa[0].Split('.').Select(s => int.TryParse(s, out var n) ? n : 0).ToArray();
        int[] mb = pb[0].Split('.').Select(s => int.TryParse(s, out var n) ? n : 0).ToArray();
        int n = Math.Max(ma.Length, mb.Length);
        for (int i = 0; i < n; i++)
        {
            int x = i < ma.Length ? ma[i] : 0;
            int y = i < mb.Length ? mb[i] : 0;
            if (x != y) return x.CompareTo(y);
        }
        // pre-release identifiers: 1.0.0 > 1.0.0-rc.2 > 1.0.0-rc.1
        string[] preA = pa.Length > 1 ? pa[1].Split('.') : Array.Empty<string>();
        string[] preB = pb.Length > 1 ? pb[1].Split('.') : Array.Empty<string>();
        if (preA.Length == 0 && preB.Length == 0) return 0;
        if (preA.Length == 0) return 1;  // no pre-release is newer
        if (preB.Length == 0) return -1;
        int m = Math.Max(preA.Length, preB.Length);
        for (int i = 0; i < m; i++)
        {
            string x = i < preA.Length ? preA[i] : "";
            string y = i < preB.Length ? preB[i] : "";
            if (x == y) continue;
            bool xn = int.TryParse(x, out var xi);
            bool yn = int.TryParse(y, out var yi);
            if (xn && yn) return xi.CompareTo(yi);
            if (xn) return -1;  // numeric identifiers have lower precedence
            if (yn) return 1;
            return string.CompareOrdinal(x, y);
        }
        return 0;
    }

    private async Task LoadVersionsAsync()
    {
        _coreLocal = ReadJsonVersion(CorePkgJson) ?? "?";
        _webUiLocal = ReadJsonVersion(Path.Combine(ProfilesWeb, "node_modules", "@linxin666", "dsh-web-all", "package.json")) ?? "?";
        _docLocal = ReadJsonVersion(Path.Combine(ProfilesWeb, "node_modules", "dsh-doc", "package.json")) ?? "?";
        bool ocrOk = Directory.Exists(OcrRuntimeDir);

        // local rows first
        RowCoreVer.Text = _coreLocal;
        RowWebUiVer.Text = _webUiLocal;
        RowDocVer.Text = _docLocal;
        RowOcrText.Text = ocrOk ? "本地 OCR 运行时就绪" : "缺失（更新后可按提示重新下载）";
        SetBadge(RowOcrBadge, RowOcrBadgeText, ocrOk ? "就绪" : "缺失",
            ocrOk ? BadgeGreenFg : BadgeAmberFg, ocrOk ? BadgeGreenBg : BadgeAmberBg);

        // latest from npm (background)
        var coreLatest = await GetNpmLatestAsync("@deepseek-ai/dsh");
        var webUiLatest = await GetNpmLatestAsync("@linxin666/dsh-web-all");
        var docLatest = await GetNpmLatestAsync("dsh-doc");

        if (!Dispatcher.CheckAccess())
        {
            _ = Dispatcher.BeginInvoke(() => ApplyLatest(coreLatest, webUiLatest, docLatest));
        }
        else
        {
            ApplyLatest(coreLatest, webUiLatest, docLatest);
        }
    }

    private void ApplyLatest(string? coreLatest, string? webUiLatest, string? docLatest)
    {
        bool offline = coreLatest is null && webUiLatest is null && docLatest is null;

        ApplyRow(RowCoreVer, RowCoreBadge, RowCoreBadgeText, _coreLocal, coreLatest);
        ApplyRow(RowWebUiVer, RowWebUiBadge, RowWebUiBadgeText, _webUiLocal, webUiLatest);
        ApplyRow(RowDocVer, RowDocBadge, RowDocBadgeText, _docLocal, docLatest);

        if (offline)
        {
            UpdateHint.Text = "· 离线，未检查到最新版本";
        }
        else
        {
            bool any = (coreLatest is not null && CompareVersions(coreLatest, _coreLocal ?? "0") > 0)
                    || (webUiLatest is not null && CompareVersions(webUiLatest, _webUiLocal ?? "0") > 0)
                    || (docLatest is not null && CompareVersions(docLatest, _docLocal ?? "0") > 0);
            UpdateHint.Text = any ? "· 发现可用的更新" : "· 已是最新版本";
            BtnUpdate.Opacity = any ? 1.0 : 0.75;
        }
    }

    private static void ApplyRow(TextBlock ver, Border badge, TextBlock badgeText, string? local, string? latest)
    {
        if (latest is null)
        {
            ver.Text = local ?? "—";
            SetBadge(badge, badgeText, "离线", BadgeGrayFg, BadgeGrayBg);
            return;
        }
        ver.Text = $"{local}  →  {latest}";
        if (CompareVersions(latest, local ?? "0") > 0)
            SetBadge(badge, badgeText, "发现新版本", BadgeAmberFg, BadgeAmberBg);
        else
            SetBadge(badge, badgeText, "已最新", BadgeGreenFg, BadgeGreenBg);
    }

    private static void SetBadge(Border border, TextBlock text, string label, Brush fg, Brush bg)
    {
        text.Text = label;
        text.Foreground = fg;
        border.Background = bg;
    }

    // =====================================================================
    //  Navigation
    // =====================================================================

    private void OpenUi_Click(object sender, RoutedEventArgs e)
    {
        OpenUrl($"http://127.0.0.1:{Port}");
    }

    private void OpenLogs_Click(object sender, RoutedEventArgs e)
    {
        Directory.CreateDirectory(LogDir);
        OpenFolder(LogDir);
    }

    private void OpenBackups_Click(object sender, RoutedEventArgs e)
    {
        Directory.CreateDirectory(BackupDir);
        OpenFolder(BackupDir);
    }

    private void OpenFolder_Click(object sender, RoutedEventArgs e)
    {
        OpenFolder(_root);
    }

    private static void OpenUrl(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch { }
    }

    private static void OpenFolder(string path)
    {
        try
        {
            Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
        }
        catch { }
    }

    private void Minimize_Click(object sender, RoutedEventArgs e)
        => WindowState = WindowState.Minimized;

    private void Close_Click(object sender, RoutedEventArgs e)
        => Close();

    // 标题栏在客户端区（CaptionHeight=0），手动实现拖动
    private void TitleBar_MouseLeftButtonDown(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        if (e.ButtonState == System.Windows.Input.MouseButtonState.Pressed && e.ClickCount == 1)
        {
            try { DragMove(); } catch { /* ignore */ }
        }
    }
}
