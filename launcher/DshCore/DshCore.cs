using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace DshDesktopEngine;

/// <summary>日志行类别（UI 自行映射颜色）</summary>
public enum DshLogKind { Default, Dim, Info, Good, Warn, Bad, Accent }

/// <summary>
/// DSH 便携包引擎：路径、环境自检、脚本执行、服务状态、版本、更新、关闭行为。
/// 完全 UI 无关，通过回调通知宿主。逻辑移植自已验证过的 DshHub（含
/// WaitForExit 轮询防挂死、pnpm 链接自修复、store 元数据对齐等修复）。
/// </summary>
public sealed class DshCore
{
    public const int Port = 3099;

    /// <summary>写日志行（UI 线程外调用时请自行 marshal）</summary>
    public Action<string, DshLogKind>? Log { get; set; }

    /// <summary>忙碌状态变化（开始/结束长操作时触发）</summary>
    public Action<bool>? BusyChanged { get; set; }

    /// <summary>运行状态/环境变化（UI 刷新用）</summary>
    public Action? StatusChanged { get; set; }

    /// <summary>版本信息刷新完成</summary>
    public Action? VersionsChanged { get; set; }

    public string Root { get; }

    private bool _busy;
    public bool Busy
    {
        get => _busy;
        private set
        {
            if (_busy == value) return;
            _busy = value;
            BusyChanged?.Invoke(value);
        }
    }

    private bool _environmentReady = true;
    public bool EnvironmentReady => _environmentReady;

    private bool _linksReady;
    public bool LinksReady => _linksReady;
    private bool _repairAttempted;

    // 版本数据（UI 读取）
    public string? CoreLocal { get; private set; }
    public string? CoreLatest { get; private set; }
    public IReadOnlyList<PluginVersionInfo> Plugins { get; private set; } = Array.Empty<PluginVersionInfo>();
    public bool OcrReady { get; private set; }
    public bool Offline { get; private set; }

    public DshCore()
    {
        Root = Path.GetDirectoryName(Environment.ProcessPath)?.TrimEnd('\\')
               ?? AppContext.BaseDirectory.TrimEnd('\\');
    }

    // =====================================================================
    //  Paths
    // =====================================================================

    public string AppDir => Path.Combine(Root, "app-npm");
    public string ProfilesWeb => Path.Combine(Root, "dsh-home", "profiles", "web");
    public string CorePkgJson => Path.Combine(AppDir, "node_modules", "@deepseek-ai", "dsh", "package.json");
    public string CoreBinJs => Path.Combine(AppDir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
    public string PidFile => Path.Combine(Root, "dsh.pid");
    public string LogDir => Path.Combine(Root, "logs");
    public string BackupDir => Path.Combine(Root, "backups");
    public string OcrRuntimeDir => Path.Combine(Root, "dsh-home", "runtimes", "dshdoc-runtime-win32-x64");
    /// <summary>插件追踪清单（单一数据源，与 update-dsh.ps1 共用）</summary>
    public string PluginTrackFile => Path.Combine(Root, "plugin-track.json");
    public string ScriptPath(string name) => Path.Combine(Root, name);
    public string Url => $"http://127.0.0.1:{Port}";

    /// <summary>
    /// Return the authenticated browser entry printed by the currently running
    /// Web process. Newer DSH versions exchange this per-process token for an
    /// HttpOnly cookie before serving the application shell.
    /// </summary>
    public string BrowserUrl
    {
        get
        {
            try
            {
                var pid = ReadRunningPid();
                if (pid is null) return Url;

                using var process = Process.GetProcessById(pid.Value);
                var outputPath = Path.Combine(LogDir, "dsh-web.out.log");
                if (!File.Exists(outputPath)
                    || File.GetLastWriteTimeUtc(outputPath) < process.StartTime.ToUniversalTime().AddSeconds(-2))
                    return Url;

                using var stream = new FileStream(outputPath, FileMode.Open, FileAccess.Read,
                    FileShare.ReadWrite | FileShare.Delete);
                using var reader = new StreamReader(stream, Encoding.UTF8, true);
                var matches = Regex.Matches(reader.ReadToEnd(),
                    @"(?m)^dsh web:\s+(?<url>http://127\.0\.0\.1:3099/\?token=[A-Za-z0-9_-]+)\s*$");
                if (matches.Count == 0) return Url;

                var candidate = matches[^1].Groups["url"].Value;
                return Uri.TryCreate(candidate, UriKind.Absolute, out var uri)
                    && uri.Scheme == Uri.UriSchemeHttp
                    && uri.Host == IPAddress.Loopback.ToString()
                    && uri.Port == Port
                    ? candidate
                    : Url;
            }
            catch
            {
                // An existing browser cookie may still authenticate the plain
                // origin; keep the desktop shell usable if the log is absent.
                return Url;
            }
        }
    }

    // =====================================================================
    //  Status
    // =====================================================================

    public bool PortListening()
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

    public async Task<bool> WaitForPortAsync(bool wantUp, int timeoutMs)
    {
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            if (PortListening() == wantUp) return true;
            await Task.Delay(300);
        }
        return PortListening() == wantUp;
    }

    public int? ReadRunningPid()
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

    public bool IsRunning(out int? pid)
    {
        pid = ReadRunningPid();
        return PortListening();
    }

    // =====================================================================
    //  Logging
    // =====================================================================

    private void Emit(string text, DshLogKind kind) => Log?.Invoke(text, kind);

    // =====================================================================
    //  Running PowerShell engine scripts (start / stop / update / repair)
    // =====================================================================

    public async Task<int> RunPowerShellAsync(string scriptName, string args, string? label)
    {
        var script = ScriptPath(scriptName);
        if (!File.Exists(script))
        {
            Emit($"[错误] 找不到脚本：{script}", DshLogKind.Bad);
            return 999;
        }

        if (!string.IsNullOrEmpty(label))
            Emit($"[操作] {label}", DshLogKind.Accent);

        var psi = new ProcessStartInfo("powershell.exe")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = Root,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        string body = $"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; & '{script.Replace("'", "''")}' {args}";
        psi.Arguments = $"-NoProfile -ExecutionPolicy Bypass -Command \"{body}\"";

        using var proc = new Process { StartInfo = psi };
        proc.OutputDataReceived += (_, e) => { if (e.Data is not null) Emit(e.Data, Colorize(e.Data)); };
        proc.ErrorDataReceived += (_, e) => { if (e.Data is not null) Emit(e.Data, DshLogKind.Default); };

        try
        {
            proc.Start();
        }
        catch (Exception ex)
        {
            Emit($"[错误] 无法启动 PowerShell：{ex.Message}", DshLogKind.Bad);
            return 999;
        }

        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();

        // 轮询进程退出，不等待管道 EOF（常驻后代进程会持有管道句柄导致
        // WaitForExitAsync 永远挂起）。加 15 分钟超时兜底。
        var waitSw = Stopwatch.StartNew();
        while (!proc.WaitForExit(0))
        {
            if (waitSw.Elapsed.TotalMinutes > 15)
            {
                Emit("[错误] 脚本运行超过 15 分钟，已强制结束。", DshLogKind.Bad);
                try { proc.Kill(entireProcessTree: true); } catch { /* ignore */ }
                break;
            }
            await Task.Delay(150);
        }

        int code = proc.HasExited ? proc.ExitCode : 999;
        Emit($"[完成] {scriptName} 退出码 {code}", code == 0 ? DshLogKind.Good : DshLogKind.Warn);
        return code;
    }

    public static DshLogKind Colorize(string line)
    {
        if (line.Contains("[update]", StringComparison.OrdinalIgnoreCase)) return DshLogKind.Info;
        if (line.Contains("错误", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("失败", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("exception", StringComparison.OrdinalIgnoreCase)) return DshLogKind.Bad;
        if (line.Contains("成功", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("完成", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("已停止", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("已最新", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("自检通过", StringComparison.OrdinalIgnoreCase)) return DshLogKind.Good;
        if (line.Contains("提示", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("警告", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("注意", StringComparison.OrdinalIgnoreCase) ||
            line.StartsWith("—")) return DshLogKind.Warn;
        if (line.StartsWith("  ")) return DshLogKind.Dim;
        return DshLogKind.Default;
    }

    // =====================================================================
    //  Environment prep / repair
    // =====================================================================

    public void PrepareEnvironment()
    {
        var problems = new List<string>();

        try
        {
            Directory.CreateDirectory(Path.Combine(Root, "dsh-home"));
            Directory.CreateDirectory(LogDir);
        }
        catch (Exception ex) { problems.Add($"无法创建目录：{ex.Message}"); }

        // .env 模板
        var envFile = Path.Combine(AppDir, ".env");
        if (!File.Exists(envFile))
        {
            var example = Path.Combine(Root, ".env.example");
            if (File.Exists(example))
            {
                try
                {
                    Directory.CreateDirectory(AppDir);
                    File.Copy(example, envFile);
                    Emit($"[提示] 首次运行：已生成 .env 模板 → {envFile}", DshLogKind.Warn);
                    Emit("       请打开该文件填入 DEEPSEEK_API_KEY 后再点「启动服务」。", DshLogKind.Warn);
                }
                catch (Exception ex) { problems.Add($"生成 .env 失败：{ex.Message}"); }
            }
            else
            {
                Emit("[提示] 未找到 .env.example，将不生成 .env。", DshLogKind.Warn);
            }
        }

        var problems2 = new List<string>();
        bool ok = VerifyCriticalFiles(problems2);
        problems.AddRange(problems2);

        _environmentReady = problems.Count == 0;
        if (_environmentReady) Emit("环境检查通过。", DshLogKind.Good);
        else
        {
            foreach (var p in problems) Emit("[错误] 环境问题：" + p, DshLogKind.Bad);
            Emit("环境不完整：请确认完整解压/克隆了便携包目录后重试。", DshLogKind.Bad);
            StatusChanged?.Invoke();
            return;
        }

        // pnpm 链接完整性
        _linksReady = File.Exists(CoreBinJs);
        if (!_linksReady)
        {
            Emit("[提示] 依赖链接未就绪：Git 检出的 pnpm 符号链接可能已失效。", DshLogKind.Warn);
            Emit("       正在自动重建依赖（repair-deps.ps1，首次约 1-3 分钟）...", DshLogKind.Warn);
            if (!_repairAttempted)
            {
                _repairAttempted = true;
                _ = RepairLinksAsync();
            }
        }
    }

    public bool VerifyCriticalFiles(List<string> problems)
    {
        var required = new (string label, string path)[]
        {
            ("启动脚本", ScriptPath("start-dsh.ps1")),
            ("停止脚本", ScriptPath("stop-dsh.ps1")),
            ("更新脚本", ScriptPath("update-dsh.ps1")),
            ("Node 运行时", Path.Combine(Root, "node", "bin", "node.exe")),
            ("应用清单", Path.Combine(AppDir, "package.json")),
        };
        bool ok = true;
        foreach (var (label, path) in required)
        {
            if (!File.Exists(path)) { problems.Add($"{label} 缺失：{path}"); ok = false; }
        }
        return ok;
    }

    public async Task RepairLinksAsync()
    {
        Busy = true;
        try
        {
            await RunPowerShellAsync("repair-deps.ps1", "", "重建依赖");
            _linksReady = File.Exists(CoreBinJs);
            if (_linksReady) Emit("依赖已就绪。", DshLogKind.Good);
            else Emit("依赖仍未就绪：若当前离线，请在有网络的电脑上先完成一次启动，或恢复 store\\ 缓存后重试。", DshLogKind.Warn);
            _ = LoadVersionsAsync();
            StatusChanged?.Invoke();
        }
        catch (Exception ex)
        {
            Emit($"[错误] 自动修复依赖异常：{ex.Message}", DshLogKind.Bad);
        }
        finally
        {
            Busy = false;
        }
    }

    // =====================================================================
    //  Actions
    // =====================================================================

    public async Task StartAsync(bool noOpen = false)
    {
        if (Busy) return;
        Busy = true;
        try
        {
            int code = await RunPowerShellAsync("start-dsh.ps1", noOpen ? "-NoOpen" : "", "启动服务");
            bool up = code == 0 && await WaitForPortAsync(true, 10000);
            Emit(up ? "启动完成，服务已运行。" : "启动未成功，请查看上方日志。", up ? DshLogKind.Good : DshLogKind.Warn);
        }
        finally
        {
            Busy = false;
            StatusChanged?.Invoke();
        }
    }

    public async Task StopAsync()
    {
        if (Busy) return;
        Busy = true;
        try
        {
            int code = await RunPowerShellAsync("stop-dsh.ps1", "", "停止服务");
            bool down = code == 0 && await WaitForPortAsync(false, 6000);
            Emit(down ? "服务已停止。" : "停止操作完成，请查看上方日志。", down ? DshLogKind.Good : DshLogKind.Warn);
        }
        finally
        {
            Busy = false;
            StatusChanged?.Invoke();
        }
    }

    public async Task RestartAsync(bool noOpen = false)
    {
        if (Busy) return;
        Busy = true;
        try
        {
            await RunPowerShellAsync("stop-dsh.ps1", "", "重启：先停止");
            await WaitForPortAsync(false, 6000);
            await RunPowerShellAsync("start-dsh.ps1", noOpen ? "-NoOpen" : "", "重启：再启动");
            bool up = await WaitForPortAsync(true, 12000);
            Emit(up ? "重启完成，服务已运行。" : "重启完成，但未检测到端口监听。", up ? DshLogKind.Good : DshLogKind.Warn);
            if (!up) Emit("警告：重启后未检测到服务，请查看 logs\\dsh-web.err.log。", DshLogKind.Warn);
            StatusChanged?.Invoke();
        }
        finally
        {
            Busy = false;
            StatusChanged?.Invoke();
        }
    }

    public async Task CheckUpdateAsync()
    {
        if (Busy) return;
        if (!_linksReady) Emit("[提示] 核心依赖尚未就绪，检查结果可能不完整。", DshLogKind.Warn);
        Busy = true;
        try
        {
            int code = await RunPowerShellAsync("update-dsh.ps1", "-Check", "检查更新");
            Emit(code == 0 ? "检查完成。" : "检查未能完成，请查看日志。", code == 0 ? DshLogKind.Good : DshLogKind.Warn);
            await LoadVersionsAsync();
        }
        finally
        {
            Busy = false;
        }
    }

    /// <summary>执行升级（-Yes）。注意：会停止服务，宿主应先用确认框征询。</summary>
    public async Task UpdateAsync()
    {
        if (Busy) return;
        Busy = true;
        try
        {
            int code = await RunPowerShellAsync("update-dsh.ps1", "-Yes", "更新 DSH 核心与插件");
            if (code == 0)
            {
                Emit("更新完成。服务当前已停止，点击「启动服务」即可应用新版本。", DshLogKind.Good);
            }
            else
            {
                Emit("更新未完成，请查看日志（可用 rollback-dsh.ps1 回滚）。", DshLogKind.Warn);
            }
            await LoadVersionsAsync();
        }
        finally
        {
            Busy = false;
            StatusChanged?.Invoke();
        }
    }

    /// <summary>退出前停止服务（关闭确认框选“停止并退出”时调用）</summary>
    public async Task StopThenCloseAsync()
    {
        Busy = true;
        try
        {
            await RunPowerShellAsync("stop-dsh.ps1", "", "退出前停止服务");
            await WaitForPortAsync(false, 6000);
        }
        catch (Exception ex) { Emit($"[错误] 退出前停止服务异常：{ex.Message}", DshLogKind.Bad); }
        finally { Busy = false; }
    }

    // =====================================================================
    //  Versions
    // =====================================================================

    public static string? ReadJsonVersion(string pkgJsonPath)
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

    public static async Task<string?> GetNpmLatestAsync(string pkg)
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

    public static int CompareVersions(string a, string b)
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
        string[] preA = pa.Length > 1 ? pa[1].Split('.') : Array.Empty<string>();
        string[] preB = pb.Length > 1 ? pb[1].Split('.') : Array.Empty<string>();
        if (preA.Length == 0 && preB.Length == 0) return 0;
        if (preA.Length == 0) return 1;
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
            if (xn) return -1;
            if (yn) return 1;
            return string.CompareOrdinal(x, y);
        }
        return 0;
    }

    public async Task LoadVersionsAsync()
    {
        CoreLocal = ReadJsonVersion(CorePkgJson) ?? "?";
        OcrReady = Directory.Exists(OcrRuntimeDir);

        var entries = ReadTrackedPlugins();
        var list = new List<PluginVersionInfo>(entries.Count);
        foreach (var (name, label) in entries)
        {
            var local = ReadJsonVersion(Path.Combine(ProfilesWeb, "node_modules", name, "package.json"));
            var latest = await GetNpmLatestAsync(name);
            list.Add(new PluginVersionInfo(name, label, local, latest));
        }
        Plugins = list;

        CoreLatest = await GetNpmLatestAsync("@deepseek-ai/dsh");
        Offline = CoreLatest is null && list.All(p => p.Latest is null);

        VersionsChanged?.Invoke();
    }

    /// <summary>读取插件追踪清单（plugin-track.json）；缺失或损坏时回退内置默认。</summary>
    private List<(string name, string label)> ReadTrackedPlugins()
    {
        try
        {
            if (File.Exists(PluginTrackFile))
            {
                var text = File.ReadAllText(PluginTrackFile, Encoding.UTF8);
                var matches = Regex.Matches(text, "\"name\"\\s*:\\s*\"([^\"]+)\"\\s*,\\s*\"label\"\\s*:\\s*\"([^\"]+)\"");
                if (matches.Count > 0)
                {
                    var result = new List<(string name, string label)>(matches.Count);
                    foreach (Match m in matches)
                        result.Add((m.Groups[1].Value, m.Groups[2].Value));
                    return result;
                }
            }
        }
        catch { /* 回退默认 */ }
        return DefaultTrackedPlugins();
    }

    private static List<(string name, string label)> DefaultTrackedPlugins() => new()
    {
        ("@linxin666/dsh-web-all", "Web UI 全家桶"),
        ("dsh-doc", "dsh-doc 文档/OCR"),
        ("@liustack/modsearch", "modsearch 联网搜索")
    };

    /// <summary>计算一行版本的显示信息：本地→最新、徽章文本。</summary>
    public (string Display, string Badge, DshBadge BadgeKind) ComputeVersionRow(string? local, string? latest)
    {
        if (latest is null)
        {
            return ($"{local ?? "—"}", "离线", DshBadge.Gray);
        }
        var display = $"{local}  →  {latest}";
        if (CompareVersions(latest, local ?? "0") > 0)
            return (display, "发现新版本", DshBadge.Amber);
        return (display, "已最新", DshBadge.Green);
    }

    /// <summary>是否有可用更新（提示 UI 高亮“立即更新”）</summary>
    public bool HasUpdate =>
        !Offline &&
        ((CoreLatest is not null && CompareVersions(CoreLatest, CoreLocal ?? "0") > 0) ||
         Plugins.Any(p => p.Latest is not null && CompareVersions(p.Latest, p.Local ?? "0") > 0));
}

public enum DshBadge { Green, Amber, Gray, Red }

/// <summary>追踪插件的一行版本信息（label / 本地 → 最新 / 徽章状态）</summary>
public sealed class PluginVersionInfo
{
    public string Name { get; }
    public string Label { get; }
    public string? Local { get; }
    public string? Latest { get; }

    public PluginVersionInfo(string name, string label, string? local, string? latest)
    {
        Name = name;
        Label = label;
        Local = local;
        Latest = latest;
    }

    public string Display => Latest is null ? (Local ?? "—") : $"{Local}  →  {Latest}";

    public string BadgeText =>
        Latest is null ? "离线" : (Badge == DshBadge.Amber ? "发现新版本" : "已最新");

    public DshBadge Badge =>
        Latest is null ? DshBadge.Gray :
        (DshCore.CompareVersions(Latest, Local ?? "0") > 0 ? DshBadge.Amber : DshBadge.Green);
}
