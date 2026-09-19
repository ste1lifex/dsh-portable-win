using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using DshDesktopEngine;
using Microsoft.Web.WebView2.Core;

namespace DshDesktop;

/// <summary>一条日志。颜色不缓存，按当前主题从共享画刷取（切主题时已渲染的行也会一起更新）。</summary>
public sealed class DsLogLine
{
    public string Text { get; }
    public DshLogKind Kind { get; }

    public DsLogLine(string text, DshLogKind kind) { Text = text; Kind = kind; }

    /// <summary>主日志配色（跟随界面主题）。</summary>
    public Brush Brush => DsTheme.LogBrush(Kind);

    /// <summary>启动遮罩里的迷你日志：遮罩始终是墨黑底，用固定深色配色。</summary>
    public Brush BootBrush => DsTheme.BootLogBrush(Kind);
}

public partial class MainWindow : Window
{
    private readonly DshCore _core;
    private readonly DispatcherTimer _statusTimer;
    private bool _allowClose;
    private bool _closePromptOpen;
    private bool _stoppingForExit;
    private bool _webViewReady;
    private int _navigationRequest;
    // 外部链接去重：NewWindowRequested 与 NavigationStarting 可能对同一链接各触发一次，
    // 用短时间窗内同 URL 只开一次，避免弹两个相同标签页。
    private readonly HashSet<string> _openedExternally = new(StringComparer.OrdinalIgnoreCase);
    private DateTime _openedExternalWindow = DateTime.MinValue;

    // ENDFIELD boot-plate loader (rail progress + sweep/fade finish)
    private readonly DispatcherTimer _loaderTimer;
    private readonly DispatcherTimer _finishTimer;
    private readonly DispatcherTimer _balanceTimer;
    private bool _balanceBusy;
    private DateTime _loaderStartUtc;
    private DateTime _finishStartUtc;
    private bool _loaderRunning;
    private bool _finishing;
    private const double LoaderDurationMs = 2600;

    // 徽标只保存资源键：切主题时靠资源引用自动换色（XAML 里的画刷会被冻结，不能就地改色）
    private static (string fg, string bg) BadgeGreen => ("BadgeGreenFg", "BadgeGreenBg");
    private static (string fg, string bg) BadgeAmber => ("BadgeAmberFg", "BadgeAmberBg");
    private static (string fg, string bg) BadgeGray => ("BadgeNeutralFg", "BadgeNeutralBg");

    /// <summary>主日志已写入的行数（行数多了会从头丢弃，这个只用于显示）。</summary>
    private int _logLineCount;

    /// <summary>加载遮罩里的迷你实时日志</summary>
    public ObservableCollection<DsLogLine> LoadingLogLines { get; } = new();

    public MainWindow()
    {
        InitializeComponent();

        _core = new DshCore();
        _core.Log = (text, kind) => DispatchLog(text, kind);
        _core.BusyChanged = busy => Dispatcher.BeginInvoke(() => SetBusyUi(busy));
        _core.StatusChanged = () => Dispatcher.BeginInvoke(RefreshStatusUi);
        _core.VersionsChanged = () => Dispatcher.BeginInvoke(ApplyVersionsUi);

        var ver = typeof(MainWindow).Assembly.GetName().Version;
        // 版本号不再放顶栏（和网页品牌挤在一起很碎），收到「版本信息」面板里
        RowShellVer.Text = "桌面版 v" + (ver == null ? "1.0.0" : ver.ToString(3));

        // 主题：先用 Windows 深浅色落地（页面还没加载），WebView 起来后由页面回传的真实主题接管
        DsTheme.Apply(DsTheme.Forced() ?? (DsTheme.OsAppsLight() ? DsThemeKind.Light : DsThemeKind.Dark));
        DsTheme.Changed += OnThemeChanged;
        ApplyWindowIcon();

        _statusTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
        _statusTimer.Tick += (_, _) => RefreshStatusUi();

        _loaderTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(33) };
        _loaderTimer.Tick += (_, _) => LoaderTick_Advance();
        _finishTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(30) };
        _finishTimer.Tick += (_, _) => FinishTick();

        // 日志：主日志是 RichTextBox（可拖选复制），迷你日志走绑定
        DataContext = this;
        SizeChanged += (_, e) => ApplyCompactLayout(e.NewSize.Width);

        // 官方余额：启动查一次 → 平时每 5 分钟一次 → 切回窗口若已过期 60 秒则立刻补一次
        // （查询失败时自动降到 1 分钟重试，成功后回到 5 分钟）
        _balanceTimer = new DispatcherTimer { Interval = BalanceIntervalOk };
        _balanceTimer.Tick += (_, _) => _ = RefreshBalanceAsync();
        Activated += (_, _) =>
        {
            if (!_balanceBusy && DateTime.UtcNow - _balanceLastAttemptUtc > BalanceStaleAfter)
                _ = RefreshBalanceAsync();
        };

        Loaded += async (_, _) =>
        {
            ClampWindowIntoWorkArea();
            ApplyCompactLayout(ActualWidth);
            LogLine("— DeepSeek Harness 桌面版已启动 —", DshLogKind.Dim);
            LogLine($"安装目录：{_core.Root}", DshLogKind.Default);
            _core.PrepareEnvironment();
            RefreshStatusUi();
            _statusTimer.Start();
            _balanceTimer.Start();
            _ = _core.LoadVersionsAsync();
            _ = RefreshBalanceAsync();
            await EnsureServerAndLoadAsync();
        };

        Closed += (_, _) =>
        {
            _statusTimer.Stop();
            _balanceTimer.Stop();
            DsTheme.Changed -= OnThemeChanged;
        };
    }

    // =====================================================================
    //  DeepSeek 官方余额（底栏右下角）
    // =====================================================================

    /// <summary>正常刷新间隔（余额随时在变，但不值得打太勤）。</summary>
    private static readonly TimeSpan BalanceIntervalOk = TimeSpan.FromMinutes(5);

    /// <summary>查询失败后的重试间隔（网络抖动 / 401 时别干等 5 分钟）。</summary>
    private static readonly TimeSpan BalanceIntervalRetry = TimeSpan.FromMinutes(1);

    /// <summary>切回窗口时，距上次查询超过这个时间就顺手补一次。</summary>
    private static readonly TimeSpan BalanceStaleAfter = TimeSpan.FromSeconds(60);

    private DateTime _balanceLastAttemptUtc = DateTime.MinValue;

    private void Balance_Click(object sender, RoutedEventArgs e) => _ = RefreshBalanceAsync();

    private async Task RefreshBalanceAsync()
    {
        if (_balanceBusy) return;
        _balanceBusy = true;
        _balanceLastAttemptUtc = DateTime.UtcNow;
        try
        {
            var key = DeepSeekBalance.ReadApiKey(_core.Root);
            if (string.IsNullOrEmpty(key))
            {
                // 没配密钥：不是临时故障，按正常节奏重查即可（用户补上 .env 后最多 5 分钟内生效）
                _balanceTimer.Interval = BalanceIntervalOk;
                SetBalance("—", "TextDim",
                    "DeepSeek 官方余额不可用\n未找到 DEEPSEEK_API_KEY（app-npm\\.env）");
                return;
            }

            var (info, error) = await DeepSeekBalance.QueryAsync(key, CancellationToken.None);
            if (info is null)
            {
                _balanceTimer.Interval = BalanceIntervalRetry;
                SetBalance("—", "TextDim", $"DeepSeek 官方余额不可用\n{error}\n点击重试");
                LogLine($"[余额] 查询失败：{error}", DshLogKind.Dim);
                return;
            }

            _balanceTimer.Interval = BalanceIntervalOk;
            bool low = !info.Available || info.Total < 10m;
            var tip = $"DeepSeek 官方账户余额\n{info.Breakdown}\n"
                      + (info.Available ? "" : "余额不足，API 调用会被拒绝\n")
                      + $"更新于 {DateTime.Now:HH:mm:ss} · 每 5 分钟自动刷新，点击立即刷新";
            SetBalance(info.Display, low ? "AmberBrush" : "TextSecondary", tip);
        }
        catch (Exception ex)
        {
            _balanceTimer.Interval = BalanceIntervalRetry;
            SetBalance("—", "TextDim", $"DeepSeek 官方余额不可用\n{ex.Message}\n点击重试");
        }
        finally
        {
            _balanceBusy = false;
        }
    }

    private void SetBalance(string text, string brushKey, string tooltip)
    {
        BalanceText.Text = text;
        BalanceChip.SetResourceReference(Control.ForegroundProperty, brushKey);
        BalanceChip.ToolTip = new TextBlock { Text = tooltip, TextWrapping = TextWrapping.Wrap, MaxWidth = 320 };
    }

    // =====================================================================
    //  Logging
    // =====================================================================

    private void DispatchLog(string text, DshLogKind kind)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.BeginInvoke(() => AddLog(text, kind));
            return;
        }
        AddLog(text, kind);
    }

    private void AddLog(string text, DshLogKind kind)
    {
        var line = new DsLogLine(string.IsNullOrEmpty(text) ? " " : text, kind);

        // 主日志：追加到 RichTextBox（RichTextBox 自带选择/复制，块数到顶后从头裁掉）
        try
        {
            var paragraph = new System.Windows.Documents.Paragraph(
                new System.Windows.Documents.Run(line.Text) { Foreground = line.Brush })
            {
                Margin = new Thickness(0, 0, 0, 3),
            };
            LogDoc.Blocks.Add(paragraph);
            while (LogDoc.Blocks.Count > 3000) LogDoc.Blocks.Remove(LogDoc.Blocks.FirstBlock);
        }
        catch { /* 日志渲染失败绝不能影响主流程 */ }

        _logLineCount++;
        LogCountText.Text = $"{_logLineCount} 行";
        // 正在拖选时不抢滚动位置，否则选到一半会被拽到底部
        if (LogPanel.Visibility == Visibility.Visible && LogBox.Selection.IsEmpty) LogBox.ScrollToEnd();

        if (!string.IsNullOrWhiteSpace(text))
            FooterText.Text = text.Length > 160 ? text[..160] : text;

        // 加载遮罩可见时，同步到迷你日志（遮罩是墨黑底，用固定深色配色）
        if (LoadingOverlay.Visibility == Visibility.Visible)
        {
            LoadingLogLines.Add(line);
            while (LoadingLogLines.Count > 8) LoadingLogLines.RemoveAt(0);
            LoadingLogScroll?.ScrollToEnd();
        }
    }

    private void LogLine(string text, DshLogKind kind)
    {
        if (!Dispatcher.CheckAccess()) { Dispatcher.BeginInvoke(() => AddLog(text, kind)); return; }
        AddLog(text, kind);
    }

    // =====================================================================
    //  UI state
    // =====================================================================

    private void SetBusyUi(bool busy)
    {
        BtnStart.IsEnabled = !busy;
        BtnStop.IsEnabled = !busy;
        BtnRestart.IsEnabled = !busy;
        BtnUpdate.IsEnabled = !busy;
        BtnCheckUpdate.IsEnabled = !busy;
        Cursor = busy ? System.Windows.Input.Cursors.Wait : System.Windows.Input.Cursors.Arrow;
    }

    private void RefreshStatusUi()
    {
        // 页面还没回传主题时，按系统深浅色刷新（切主题后任务栏/Alt+Tab 图标自动换）
        if (!_pageThemeValid) RefreshThemeFromOs();

        bool running = _core.IsRunning(out var pid);
        // 资源引用：切主题后状态点颜色自动跟着换
        StatusDot.SetResourceReference(System.Windows.Shapes.Shape.FillProperty, running ? "GreenBrush" : "AccentBrush");
        StatusText.Text = running ? "运行中" : "未运行";
        StatusDetailText.Text = running
            ? $"http://127.0.0.1:{DshCore.Port} · PID {pid?.ToString() ?? "?"}"
            : $"http://127.0.0.1:{DshCore.Port}";
        BtnOpenExternal.IsEnabled = running;
    }

    // =====================================================================
    //  主题：外壳跟随内嵌 DSH 界面（WebUI）的深浅色
    // =====================================================================

    private static ImageSource? _iconDark;
    private static ImageSource? _iconLight;

    /// <summary>页面是否已经回传过主题（回传后以页面为准，注册表只做兜底）。</summary>
    private bool _pageThemeValid;

    /// <summary>DSH_DESKTOP_DEBUG_THEME=1 时把页面回传的主题/令牌写进日志（排查用）。</summary>
    private readonly bool _debugTheme =
        !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("DSH_DESKTOP_DEBUG_THEME"));

    private static ImageSource LoadPackIcon(string name)
    {
        var img = new System.Windows.Media.Imaging.BitmapImage();
        img.BeginInit();
        img.UriSource = new Uri($"pack://application:,,,/{name}", UriKind.Absolute);
        img.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;
        img.EndInit();
        img.Freeze();
        return img;
    }

    private void OnThemeChanged(DsThemeKind kind) => ApplyWindowIcon();

    /// <summary>
    /// 窗口/任务栏图标用系统（任务栏）主题判定：
    /// 图标贴在任务栏上，跟随 SystemUsesLightTheme 才不会“深色图撞浅色栏”。
    /// 深色用原图（黑底），浅色用把黑底换成白底的那版（IconGen --character 生成）。
    /// </summary>
    private void ApplyWindowIcon()
    {
        try
        {
            _iconDark ??= LoadPackIcon("icon-dark-256.png");
            _iconLight ??= LoadPackIcon("icon-light-256.png");
            Icon = DsTheme.OsSystemLight() ? _iconLight : _iconDark;
        }
        catch
        {
            // 读取失败时保持默认（XAML 里声明的 icon-dark-256.png）
        }
    }

    /// <summary>按 Windows 深浅色应用主题（页面加载前的兜底，也是页面不可用时的来源）。</summary>
    private void RefreshThemeFromOs()
    {
        DsTheme.Apply(DsTheme.Forced() ?? (DsTheme.OsAppsLight() ? DsThemeKind.Light : DsThemeKind.Dark));
        ApplyWindowIcon();
    }

    /// <summary>
    /// 应用页面回传的主题：<paramref name="dark"/> 来自 body[data-ds-dark-theme]，
    /// tokens 是页面上的实时设计令牌（含皮肤），命中即用于外壳，做到与 WebUI 逐像素一致。
    /// </summary>
    private void ApplyPageTheme(bool dark, Dictionary<string, Color> tokens)
    {
        if (_debugTheme)
        {
            var dump = tokens.Count == 0
                ? "（页面未提供设计令牌）"
                : string.Join(" ", tokens.Select(kv => $"{kv.Key}={kv.Value}"));
            LogLine($"[主题·调试] 页面回传 dark={dark} {dump}", DshLogKind.Dim);
        }

        if (DsTheme.Forced() is not null) return; // 调试覆盖优先
        bool first = !_pageThemeValid;
        bool kindChanged = DsTheme.Current != (dark ? DsThemeKind.Dark : DsThemeKind.Light);
        _pageThemeValid = true;

        if (DsTheme.Apply(dark ? DsThemeKind.Dark : DsThemeKind.Light, tokens))
        {
            ApplyWindowIcon();
            if (first || kindChanged)
                LogLine($"[主题] 外壳已跟随界面：{(dark ? "深色" : "浅色")}", DshLogKind.Dim);
        }
    }

    private void ApplyVersionsUi()
    {
        ApplyRow(RowCoreVer, RowCoreBadge, RowCoreBadgeText, _core.CoreLocal, _core.CoreLatest);

        PluginRows.Children.Clear();
        foreach (var p in _core.Plugins)
            AppendPluginRow(p);

        if (_core.OcrReady)
        {
            RowOcrText.Text = "本地 OCR 运行时就绪";
            SetBadge(RowOcrBadge, RowOcrBadgeText, "就绪", BadgeGreen);
        }
        else
        {
            RowOcrText.Text = "缺失（更新后可按提示重新下载）";
            SetBadge(RowOcrBadge, RowOcrBadgeText, "缺失", BadgeAmber);
        }

        BtnUpdateText.Text = _core.HasUpdate ? "立即更新（有新版本）" : "立即更新";
        BtnUpdate.Opacity = _core.HasUpdate ? 1.0 : 0.7;
        if (_compact == true) BtnUpdate.ToolTip = BtnUpdateText.Text;
    }

    /// <summary>按 plugin-track.json 追踪清单动态生成一行插件版本。</summary>
    private void AppendPluginRow(PluginVersionInfo p)
    {
        var row = new Grid { Height = 24 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(110) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var metaStyle = TryFindResource("MetaText") as Style;
        var label = new TextBlock { Text = p.Label, VerticalAlignment = VerticalAlignment.Center, Style = metaStyle };
        var ver = new TextBlock { Text = p.Display, VerticalAlignment = VerticalAlignment.Center, Style = metaStyle };
        var badge = new Border
        {
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(8, 2, 8, 2),
            VerticalAlignment = VerticalAlignment.Center
        };
        var badgeText = new TextBlock { FontSize = 10.5, FontWeight = FontWeights.SemiBold };
        badge.SetResourceReference(Border.BackgroundProperty, BadgeGray.bg);
        badgeText.SetResourceReference(TextBlock.ForegroundProperty, BadgeGray.fg);

        Grid.SetColumn(label, 0);
        Grid.SetColumn(ver, 1);
        Grid.SetColumn(badge, 2);
        row.Children.Add(label);
        row.Children.Add(ver);
        badge.Child = badgeText;
        row.Children.Add(badge);

        switch (p.Badge)
        {
            case DshBadge.Green: SetBadge(badge, badgeText, "已最新", BadgeGreen); break;
            case DshBadge.Amber: SetBadge(badge, badgeText, "发现新版本", BadgeAmber); break;
            default: SetBadge(badge, badgeText, "离线", BadgeGray); break;
        }

        PluginRows.Children.Add(row);
    }

    private static void ApplyRow(TextBlock ver, Border badge, TextBlock badgeText, string? local, string? latest)
    {
        if (latest is null)
        {
            ver.Text = local ?? "—";
            SetBadge(badge, badgeText, "离线", BadgeGray);
            return;
        }
        ver.Text = $"{local}  →  {latest}";
        if (DshCore.CompareVersions(latest, local ?? "0") > 0)
            SetBadge(badge, badgeText, "发现新版本", BadgeAmber);
        else
            SetBadge(badge, badgeText, "已最新", BadgeGreen);
    }

    private static void SetBadge(Border border, TextBlock text, string label, (string fg, string bg) palette)
    {
        text.Text = label;
        // 用资源引用而不是直接赋画刷：切主题时颜色会自动跟着换
        text.SetResourceReference(TextBlock.ForegroundProperty, palette.fg);
        border.SetResourceReference(Border.BackgroundProperty, palette.bg);
    }

    // =====================================================================
    //  Loading overlay + WebView2
    // =====================================================================

    private void ShowLoading(string text, string detail = "")
    {
        if (!Dispatcher.CheckAccess()) { Dispatcher.BeginInvoke(() => ShowLoading(text, detail)); return; }
        LoadingText.Text = text;
        LoadingDetail.Text = detail;
        // 只盖遮罩，不隐藏 WebView：WebView2 在隐藏状态下初始化会渲染成黑屏
        LoadingOverlay.Visibility = Visibility.Visible;
        // 迷你日志保留最近几行（LoadingLogLines 由 AddLog 持续补充，这里不重复塞）
        while (LoadingLogLines.Count > 6) LoadingLogLines.RemoveAt(0);
        StartLoader();
    }

    private void HideLoading()
    {
        if (!Dispatcher.CheckAccess()) { Dispatcher.BeginInvoke(() => HideLoading()); return; }
        LoadingOverlay.Visibility = Visibility.Collapsed;
        StopLoader();
    }

    // =====================================================================
    //  ENDFIELD boot-plate loader (rail progress + sweep/fade finish)
    // =====================================================================

    private void StartLoader()
    {
        if (_loaderRunning) return;
        _loaderRunning = true;
        _loaderStartUtc = DateTime.UtcNow;
        if (LoaderFill is not null) LoaderFill.Height = 0;
        if (LoaderWipe is not null) { LoaderWipe.Opacity = 0; LoaderWipe.Width = 10; }
        if (LoaderPct is not null) LoaderPct.Text = "0%";
        if (LoaderStatus is not null) LoaderStatus.Text = "Connecting...";
        if (LoaderMeter is not null) LoaderMeter.Margin = new Thickness(26, 0, 0, 0);
        LoadingOverlay.Opacity = 1;
        _loaderTimer.Start();
    }

    private void StopLoader()
    {
        _loaderTimer.Stop();
        _loaderRunning = false;
    }

    private void LoaderTick_Advance()
    {
        if (LoadingOverlay.Visibility != Visibility.Visible) { StopLoader(); return; }
        double h = Math.Max(1, LoadingOverlay.ActualHeight);
        double elapsed = (DateTime.UtcNow - _loaderStartUtc).TotalMilliseconds;
        double t = Math.Min(1, elapsed / LoaderDurationMs);
        double eased = 1 - Math.Pow(1 - t, 3); // easeOutCubic
        int value = (int)Math.Round(eased * 100);
        if (LoaderFill is not null) LoaderFill.Height = eased * h;
        if (LoaderPct is not null) LoaderPct.Text = value + "%";
        if (LoaderStatus is not null)
            LoaderStatus.Text = value < 45 ? "Connecting..." : (value < 99 ? "Updating..." : "Ready");
        if (LoaderMeter is not null)
        {
            double mh = Math.Max(40, LoaderMeter.ActualHeight);
            double fillTop = (1 - eased) * h; // 进度条上沿（自下而上）
            double top = Math.Max(0, Math.Min(fillTop - mh - 10, h - mh - 64));
            LoaderMeter.Margin = new Thickness(26, top, 0, 0);
        }
    }

    /// <summary>导航成功：跳到 100%，定格后整体淡出（不扫屏），交给 Web 端启动屏接力。</summary>
    private void FinishLoading()
    {
        if (_finishing) return;
        StopLoader();
        if (LoadingOverlay.Visibility != Visibility.Visible) return;
        double h = Math.Max(1, LoadingOverlay.ActualHeight);
        if (LoaderFill is not null) LoaderFill.Height = h;
        if (LoaderPct is not null) LoaderPct.Text = "100%";
        if (LoaderStatus is not null) LoaderStatus.Text = "Ready";
        if (LoaderWipe is not null) { LoaderWipe.Opacity = 0; LoaderWipe.Width = 10; }
        _finishing = true;
        _finishStartUtc = DateTime.UtcNow;
        _finishTimer.Start();
    }

    private void FinishTick()
    {
        double elapsed = (DateTime.UtcNow - _finishStartUtc).TotalMilliseconds;
        const double HoldMs = 220;
        const double FadeMs = 380;
        if (elapsed < HoldMs) return; // 100% 定格一拍
        double f = Math.Min(1, (elapsed - HoldMs) / FadeMs);
        LoadingOverlay.Opacity = Math.Max(0, 1 - f);
        if (elapsed >= HoldMs + FadeMs)
        {
            _finishTimer.Stop();
            _finishing = false;
            HideLoading();
        }
    }

    private async Task EnsureServerAndLoadAsync()
    {
        try
        {
            if (!_core.EnvironmentReady)
            {
                ShowLoading("环境不完整", "缺少关键文件，详见日志");
                return;
            }

            bool running = _core.IsRunning(out _);
            if (!running)
            {
                ShowLoading("正在启动 DeepSeek Harness...", "首次启动会自动修复依赖，请稍候");
                await _core.StartAsync(noOpen: true);
                await _core.WaitForPortAsync(true, 12000);
            }
            else
            {
                // 服务已在运行：同样播启动屏，保证每次打开桌面版都有加载界面
                // （WebView 就绪并导航完成后由 FinishLoading 扫屏/淡出让位）
                ShowLoading("正在连接工作台...", "正在加载 DSH 界面");
            }

            if (!_core.IsRunning(out _))
            {
                ShowLoading("服务未就绪", "启动未成功，请点「日志」查看详情");
                return;
            }

            await InitWebViewAsync();
            if (_webViewReady) NavigateToApp();
        }
        catch (Exception ex)
        {
            ShowLoading("启动失败：" + ex.Message, "");
        }
    }

    private async Task InitWebViewAsync()
    {
        if (_webViewReady) return;

        // 检测系统 WebView2 运行时
        string? runtimeVersion = null;
        try { runtimeVersion = CoreWebView2Environment.GetAvailableBrowserVersionString(); }
        catch { runtimeVersion = null; }

        var userData = Path.Combine(_core.Root, "dsh-home", "webview2-data");

        if (runtimeVersion is null)
        {
            await HandleMissingRuntimeAsync();
            return;
        }

        try
        {
            // 强制软件渲染：实测本机/部分显卡驱动下 WebView2 的 GPU 合成会
            // 显示白屏/黑屏（页面已加载但内容不显示）。聊天类界面软件渲染
            // 足够流畅，且能保证任何环境都不黑屏。
            var opts = new CoreWebView2EnvironmentOptions
            {
                AdditionalBrowserArguments = "--disable-gpu --disable-gpu-compositing",
            };
            var env = await CoreWebView2Environment.CreateAsync(null, userData, opts);
            await WebView.EnsureCoreWebView2Async(env);
            ApplyWebColorScheme();
            await ConfigureWebViewAsync();
            _webViewReady = true;
        }
        catch (Exception ex)
        {
            ShowLoading("WebView2 初始化失败：" + ex.Message, "");
        }
    }

    /// <summary>
    /// 明确设定内嵌页面的配色方案：默认 Auto（跟随 Windows），
    /// DSH_DESKTOP_THEME 覆盖时按覆盖值按死。
    /// 必须每次都显式写入 —— PreferredColorScheme 会存进 WebView2 用户数据目录，
    /// 只写不还原的话，一次强制浅色就会永久留在配置里。
    /// </summary>
    private void ApplyWebColorScheme()
    {
        if (WebView.CoreWebView2 is null) return;
        try
        {
            WebView.CoreWebView2.Profile.PreferredColorScheme = DsTheme.Forced() switch
            {
                DsThemeKind.Light => CoreWebView2PreferredColorScheme.Light,
                DsThemeKind.Dark => CoreWebView2PreferredColorScheme.Dark,
                _ => CoreWebView2PreferredColorScheme.Auto,
            };
        }
        catch { /* 旧版本运行时可能不支持，忽略 */ }
    }

    private async Task ConfigureWebViewAsync()
    {
        if (WebView.CoreWebView2 is null) return;
        WebView.CoreWebView2.Settings.AreDevToolsEnabled = false;
        WebView.CoreWebView2.Settings.IsStatusBarEnabled = false;
        WebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;

        // 页面回传主题（深浅 + 实时设计令牌）→ 外壳配色/图标跟随
        WebView.CoreWebView2.WebMessageReceived += (_, e) =>
        {
            try
            {
                var json = e.TryGetWebMessageAsString();
                if (string.IsNullOrEmpty(json)) return;
                using var doc = System.Text.Json.JsonDocument.Parse(json);
                var root = doc.RootElement;
                if (!root.TryGetProperty("type", out var type) || type.GetString() != "dsh-desktop-theme") return;

                bool dark = root.TryGetProperty("dark", out var d) && d.ValueKind == System.Text.Json.JsonValueKind.True;
                var tokens = new Dictionary<string, Color>(StringComparer.Ordinal);
                if (root.TryGetProperty("tokens", out var tk) && tk.ValueKind == System.Text.Json.JsonValueKind.Object)
                {
                    foreach (var prop in tk.EnumerateObject())
                    {
                        if (DsTheme.TryParseCssColor(prop.Value.GetString(), out var color))
                            tokens[prop.Name] = color;
                    }
                }
                ApplyPageTheme(dark, tokens);
            }
            catch { /* 主题回传解析失败不影响主流程 */ }
        };

        // 主题桥：把页面真实的深浅色状态 + 设计令牌回传宿主。
        // DSH 网页端把深色写在 <body data-ds-dark-theme>（跟随系统或用户偏好），
        // 皮肤/令牌变了也一并回传，外壳因此永远与网页一致。
        //
        // 令牌用「探针元素 + 计算样式」解析而不是直接读自定义属性：自定义属性
        // 取回来可能是 val(--x) 链或尚未解析的写法，交给浏览器解析成 rgb() 最稳。
        const string themeScript = @"(() => {
  if (window.__dshDesktopThemeBridge) return;
  window.__dshDesktopThemeBridge = true;
  const KEYS = {
    bgBase: '--dsw-alias-bg-base',
    layer1: '--dsw-alias-bg-layer-1',
    layer2: '--dsw-alias-bg-layer-2',
    code: '--dsw-alias-markdown-code-block',
    label1: '--dsw-alias-label-primary',
    label2: '--dsw-alias-label-secondary',
    label3: '--dsw-alias-label-tertiary',
    border2: '--dsw-alias-border-l2'
  };
  const SENTINEL = 'rgba(1, 2, 3, 0.5)';
  const isDark = () => {
    const b = document.body;
    if (b && b.hasAttribute('data-ds-dark-theme')) return true;
    const cs = document.documentElement && document.documentElement.style;
    if (cs && cs.colorScheme === 'dark') return true;
    try { return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
  };
  let probe = null;
  const tokenProbe = () => {
    if (probe && probe.parentNode) return probe;
    try {
      probe = document.getElementById('__dsh_desktop_theme_probe');
      if (!probe) {
        probe = document.createElement('span');
        probe.id = '__dsh_desktop_theme_probe';
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;pointer-events:none;';
        document.body.appendChild(probe);
      }
    } catch (e) { probe = null; }
    return probe;
  };
  const readTokens = () => {
    const out = {};
    const el = tokenProbe();
    if (!el) return out;
    let cs = null;
    try { cs = getComputedStyle(el); } catch (e) { return out; }
    for (const key in KEYS) {
      try {
        el.style.color = '';
        el.style.color = 'var(' + KEYS[key] + ', ' + SENTINEL + ')';
        const value = cs.color;
        if (value && value !== SENTINEL && value !== 'rgb(1, 2, 3)') out[key] = value;
      } catch (e) { }
    }
    el.style.color = '';
    return out;
  };
  let last = '';
  const post = () => {
    let payload;
    try { payload = JSON.stringify({ type: 'dsh-desktop-theme', dark: isDark(), tokens: readTokens() }); }
    catch (e) { return; }
    if (payload === last) return;
    last = payload;
    try { window.chrome && window.chrome.webview && window.chrome.webview.postMessage(payload); } catch (e) { }
  };
  const observe = () => {
    try {
      const mo = new MutationObserver(post);
      if (document.documentElement) mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-ds-dark-theme'] });
      if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['style', 'class', 'data-ds-dark-theme'] });
    } catch (e) { }
  };
  const start = () => {
    post();
    observe();
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', post); } catch (e) { }
    // 兜底轮询：令牌（皮肤）可能在插件启用后才写入，快照去重保证不刷屏
    let waited = 0;
    const timer = setInterval(() => {
      waited += 1500;
      post();
      if (waited > 60000 && Object.keys(readTokens()).length > 0) clearInterval(timer);
    }, 1500);
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();";

        // 在页面任何脚本运行前注入墨黑遮罩，盖住 DSH 壳自带的原生加载画面，
        // 直到 ENDFIELD 启动屏插件挂载（z-index 更高）再撤掉——消除“原生加载界面”闪现。
        const string earlyScript = @"(() => {
  const cover = document.createElement('div');
  cover.style.cssText = 'position:fixed;inset:0;z-index:2147482000;background:#101110;pointer-events:none;';
  (document.head || document.documentElement).appendChild(cover);
  let mo = null;
  const remove = () => { if (cover.parentNode) cover.parentNode.removeChild(cover); if (mo) { mo.disconnect(); mo = null; } };
  const hasPlate = () => typeof document.querySelector === 'function' && !!document.querySelector('[data-endfield-loader]');
  if (hasPlate()) { remove(); return; }
  mo = new MutationObserver(() => { if (hasPlate()) remove(); });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(remove, 12000);
})();";

        // 注入完成后再导航，避免和 Navigate 抢时序
        try { await WebView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(themeScript); }
        catch { /* 注入失败不影响主流程 */ }
        try { await WebView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(earlyScript); }
        catch { /* 注入失败不影响主流程 */ }

        // 拦截所有导航：只允许 DSH 本地界面（127.0.0.1:3099）在内嵌 WebView 中渲染；
        // 外部链接（含 target=_blank 弹窗）一律交给系统默认浏览器，避免卡在内嵌页。
        WebView.CoreWebView2.NavigationStarting += (_, e) =>
        {
            try
            {
                if (IsAppNavigation(e.Uri))
                {
                    // 新文档还没回传主题：先按系统兜底，等页面脚本回传后再对齐
                    _pageThemeValid = false;
                    return;
                }
                e.Cancel = true;
                OpenExternal(e.Uri);
            }
            catch { /* ignore */ }
        };

        WebView.CoreWebView2.NewWindowRequested += (_, e) =>
        {
            try
            {
                e.Handled = true;
                if (!IsAppNavigation(e.Uri)) OpenExternal(e.Uri);
            }
            catch { /* ignore */ }
        };
    }

    /// <summary>是否属于 DSH 本地应用导航（同源 + about/blob/data）。</summary>
    private bool IsAppNavigation(string uri)
    {
        if (string.IsNullOrEmpty(uri)) return true;
        if (uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase)) return true;
        if (uri.StartsWith("blob:", StringComparison.OrdinalIgnoreCase)
            || uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return true;
        if (Uri.TryCreate(_core.Url, UriKind.Absolute, out var app)
            && Uri.TryCreate(uri, UriKind.Absolute, out var target)
            && string.Equals(target.Scheme, app.Scheme, StringComparison.OrdinalIgnoreCase)
            && string.Equals(target.Host, app.Host, StringComparison.OrdinalIgnoreCase)
            && target.Port == app.Port) return true;
        return false;
    }

    /// <summary>用系统默认浏览器打开外部链接（仅 http/https；5 秒内同 URL 去重）。</summary>
    private void OpenExternal(string uri)
    {
        if (string.IsNullOrEmpty(uri)) return;
        if (!(uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
              || uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase))) return;
        var now = DateTime.UtcNow;
        if ((now - _openedExternalWindow).TotalSeconds > 5)
        {
            _openedExternally.Clear();
            _openedExternalWindow = now;
        }
        if (!_openedExternally.Add(uri.TrimEnd('/'))) return;
        try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); }
        catch { /* ignore */ }
    }

    private async void NavigateToApp()
    {
        if (!_webViewReady) return;

        // The server begins listening before redirected stdout necessarily
        // reaches dsh-web.out.log. Wait briefly for the current process's
        // launch token instead of racing ahead to the unauthenticated origin.
        int request = ++_navigationRequest;
        string url = _core.Url;
        for (int attempt = 0; attempt < 60; attempt++)
        {
            if (request != _navigationRequest || !_webViewReady) return;
            url = _core.BrowserUrl;
            if (!string.Equals(url, _core.Url, StringComparison.Ordinal)) break;
            await Task.Delay(100);
        }

        if (request == _navigationRequest && _webViewReady)
            WebView.CoreWebView2?.Navigate(url);
    }

    private void Reload_Click(object sender, RoutedEventArgs e)
    {
        if (_webViewReady) NavigateToApp();
    }

    private async void WebView_InitCompleted(object? sender, CoreWebView2InitializationCompletedEventArgs e)
    {
        if (e.IsSuccess)
        {
            _webViewReady = true;
            ApplyWebColorScheme();
            await ConfigureWebViewAsync();
            if (_core.IsRunning(out _)) NavigateToApp();
        }
    }

    private void WebView_NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (e.IsSuccess)
        {
            FinishLoading();
        }
        else
        {
            // 页面没起来：退回系统主题兜底
            _pageThemeValid = false;
            RefreshThemeFromOs();
            ShowLoading("连接 DSH 界面失败", "请确认服务已启动，或点「浏览器打开」");
        }
    }

    private async Task HandleMissingRuntimeAsync()
    {
        var choice = DshHub.AskDialog.Show(this, "需要 WebView2 运行时",
            "检测到本机缺少 WebView2 运行时（嵌入式浏览器内核）。\n\n是否现在下载并安装？\n（约 2MB，Microsoft 官方引导器，装到当前用户，无需管理员）",
            ("下载并安装", DshHub.AskResult.Yes, true),
            ("取消", DshHub.AskResult.Cancel, false));

        if (choice != DshHub.AskResult.Yes)
        {
            ShowLoading("缺少 WebView2 运行时", "可点「浏览器打开」用外部浏览器使用 DSH");
            return;
        }

        ShowLoading("正在下载 WebView2 运行时...", "约 2MB，请稍候");
        try
        {
            var exe = Path.Combine(Path.GetTempPath(), "MicrosoftEdgeWebview2Setup.exe");
            using (var http = new System.Net.Http.HttpClient())
            {
                var data = await http.GetByteArrayAsync("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
                await File.WriteAllBytesAsync(exe, data);
            }
            ShowLoading("正在安装 WebView2 运行时...", "约几十秒，无需管理员");
            using var p = Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true, Arguments = "--silent --install" });
            if (p is not null) await Task.Run(() => p.WaitForExit(120000));
            await InitWebViewAsync();
            if (_webViewReady) NavigateToApp();
        }
        catch (Exception ex)
        {
            ShowLoading("WebView2 安装失败：" + ex.Message, "可点「浏览器打开」使用外部浏览器");
        }
    }

    // =====================================================================
    //  Actions
    // =====================================================================

    private async void Start_Click(object sender, RoutedEventArgs e)
    {
        if (_core.Busy) return;
        await _core.StartAsync(noOpen: true);
        if (_core.IsRunning(out _))
        {
            if (_webViewReady) NavigateToApp();
            else await EnsureServerAndLoadAsync();
        }
    }

    private async void Stop_Click(object sender, RoutedEventArgs e)
    {
        if (_core.Busy) return;
        await _core.StopAsync();
    }

    private async void Restart_Click(object sender, RoutedEventArgs e)
    {
        if (_core.Busy) return;
        await _core.RestartAsync(noOpen: true);
        if (_core.IsRunning(out _) && _webViewReady) NavigateToApp();
    }

    private async void CheckUpdate_Click(object sender, RoutedEventArgs e)
    {
        if (_core.Busy) return;
        await _core.CheckUpdateAsync();
    }

    private async void Update_Click(object sender, RoutedEventArgs e)
    {
        if (_core.Busy) return;
        bool running = _core.IsRunning(out _);
        string msg = running
            ? "更新前会先停止当前服务（自动备份 → 升级 → 自检），\n完成后需要手动重新启动服务。\n\n确定现在开始更新吗？"
            : "将自动备份当前版本并升级到最新版（含自检）。\n\n确定现在开始更新吗？";
        var choice = DshHub.AskDialog.Show(this, "立即更新", msg,
            ("开始更新", DshHub.AskResult.Yes, true),
            ("取消", DshHub.AskResult.Cancel, false));
        if (choice != DshHub.AskResult.Yes) return;

        ShowLoading("正在更新...", "更新可能耗时数分钟，完成后请重新启动服务");
        await _core.UpdateAsync();
        HideLoading();
        if (_core.IsRunning(out _) && _webViewReady) NavigateToApp();
    }

    private void Versions_Click(object sender, RoutedEventArgs e)
        => VersionsPanel.Visibility = VersionsPanel.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;

    // 「日志」按钮：展开/收起底部日志栏
    private void OpenLogs_Click(object sender, RoutedEventArgs e) => ToggleLogPanel();

    private void ToggleLogPanel_Click(object sender, RoutedEventArgs e) => ToggleLogPanel();

    private void ToggleLogPanel()
    {
        bool show = LogPanel.Visibility != Visibility.Visible;
        LogPanel.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        if (show) LogBox.ScrollToEnd();
    }

    /// <summary>复制全部日志（主日志是 RichTextBox，这里走纯文本，方便贴到别处）。</summary>
    private void CopyAllLog_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var text = new System.Windows.Documents.TextRange(LogDoc.ContentStart, LogDoc.ContentEnd).Text;
            if (string.IsNullOrWhiteSpace(text)) return;
            Clipboard.SetText(text);
            FooterText.Text = $"已复制 {_logLineCount} 行日志到剪贴板";
        }
        catch (Exception ex)
        {
            LogLine($"[错误] 复制日志失败：{ex.Message}", DshLogKind.Bad);
        }
    }

    private void ClearLog_Click(object sender, RoutedEventArgs e)
    {
        LogDoc.Blocks.Clear();
        LoadingLogLines.Clear();
        _logLineCount = 0;
        LogCountText.Text = "";
    }

    // =====================================================================
    //  顶栏紧凑模式：窗口不够宽时收起按钮文字，只留图标（避免内容被裁掉）
    // =====================================================================

    private bool? _compact;

    private void ApplyCompactLayout(double width)
    {
        // 满标签时顶栏内容约 990 DIP（去掉品牌后窄了不少），留点余量：窄于 1060 就收起文字只留图标
        bool compact = width < 1060;
        if (_compact == compact) return;
        _compact = compact;

        var visibility = compact ? Visibility.Collapsed : Visibility.Visible;
        foreach (var label in new[] { TxtStart, TxtStop, TxtRestart, TxtCheckUpdate, BtnUpdateText, TxtVersions, TxtLogs, TxtReload, TxtOpenExternal })
        {
            if (label is not null) label.Visibility = visibility;
        }
        foreach (var separator in new[] { SepUpdate, SepTools })
        {
            if (separator is not null) separator.Visibility = visibility;
        }

        // 紧凑模式下把被收起的文字挪到 ToolTip，鼠标悬停仍能看懂
        BtnUpdate.ToolTip = compact ? BtnUpdateText.Text : "立即更新";

        // 每行按钮的左右内边距在紧凑模式收紧一点
        var padding = compact ? new Thickness(9, 0, 9, 0) : new Thickness(10, 0, 10, 0);
        foreach (var button in new[] { BtnStart, BtnStop, BtnRestart, BtnCheckUpdate, BtnUpdate, BtnVersions, BtnLogs, BtnReload, BtnOpenExternal })
        {
            if (button is not null) button.Padding = padding;
        }
    }

    private void OpenExternal_Click(object sender, RoutedEventArgs e)
    {
        try { Process.Start(new ProcessStartInfo(_core.BrowserUrl) { UseShellExecute = true }); }
        catch { /* ignore */ }
    }

    private void OpenFolder_Click(object sender, RoutedEventArgs e)
    {
        try { Process.Start(new ProcessStartInfo("explorer.exe", $"\"{_core.Root}\"") { UseShellExecute = true }); }
        catch { /* ignore */ }
    }

    // =====================================================================
    //  Close behavior
    // =====================================================================

    protected override void OnClosing(CancelEventArgs e)
    {
        if (_allowClose)
        {
            base.OnClosing(e);
            return;
        }

        bool running = _core.IsRunning(out _);
        if (!running)
        {
            base.OnClosing(e);
            return;
        }

        e.Cancel = true;
        if (_closePromptOpen || _stoppingForExit) return;

        _closePromptOpen = true;
        try
        {
            var choice = DshHub.AskDialog.Show(this, "关闭桌面版",
                "DeepSeek Harness 服务正在运行。\n关闭窗口时是否同时停止服务？\n\n选择「仅退出」后服务会继续在后台运行。",
                ("停止并退出", DshHub.AskResult.Yes, true),
                ("仅退出", DshHub.AskResult.No, false),
                ("取消", DshHub.AskResult.Cancel, false));

            if (choice == DshHub.AskResult.Yes)
            {
                _stoppingForExit = true;
                _ = StopThenCloseAsync();
            }
            else if (choice == DshHub.AskResult.No)
            {
                _allowClose = true;
                _ = Dispatcher.BeginInvoke(Close);
            }
        }
        catch (Exception ex)
        {
            LogLine($"[错误] 关闭确认框异常：{ex.Message}", DshLogKind.Bad);
        }
        finally
        {
            _closePromptOpen = false;
        }
    }

    private async Task StopThenCloseAsync()
    {
        try
        {
            await _core.StopThenCloseAsync();
        }
        finally
        {
            _allowClose = true;
            _ = Dispatcher.BeginInvoke(Close);
        }
    }

    // =====================================================================
    //  Window chrome
    // =====================================================================

    private void TitleBar_MouseLeftButtonDown(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        if (e.ButtonState == System.Windows.Input.MouseButtonState.Pressed && e.ClickCount == 1)
        {
            try { DragMove(); } catch { /* ignore */ }
        }
    }

    private void Minimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

    private void Maximize_Click(object sender, RoutedEventArgs e)
        => WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    // =====================================================================
    //  最大化时不要盖住任务栏
    //
    //  WindowStyle=None + WindowChrome 的窗口在最大化时，WPF 会把窗口拉到整块
    //  显示器尺寸（含任务栏那一条），底栏和右下角余额就被任务栏压住了。
    //  处理 WM_GETMINMAXINFO，把最大化位置/尺寸改成显示器【工作区】：
    //  所有最大化途径（按钮、双击标题栏、Win+↑、拖到屏幕顶端）都会经过这条消息。
    // =====================================================================

    private const int WM_GETMINMAXINFO = 0x0024;
    private const uint MONITOR_DEFAULTTONEAREST = 2;

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        try
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            HwndSource.FromHwnd(hwnd)?.AddHook(WndProc);
        }
        catch { /* 挂不上钩子时保持系统默认行为 */ }
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WM_GETMINMAXINFO)
        {
            try { ClampMaximizedSizeToWorkArea(hwnd, lParam); } catch { /* 用系统默认 */ }
            handled = true;
        }
        return IntPtr.Zero;
    }

    private void ClampMaximizedSizeToWorkArea(IntPtr hwnd, IntPtr lParam)
    {
        var mmi = Marshal.PtrToStructure<MINMAXINFO>(lParam);
        var monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if (monitor == IntPtr.Zero) return;

        var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        if (!GetMonitorInfo(monitor, ref mi)) return;

        // ptMaxPosition 是相对「显示器左上角」的偏移，所以要把工作区原点减掉显示器原点
        mmi.ptMaxPosition.X = mi.rcWork.Left - mi.rcMonitor.Left;
        mmi.ptMaxPosition.Y = mi.rcWork.Top - mi.rcMonitor.Top;
        mmi.ptMaxSize.X = mi.rcWork.Right - mi.rcWork.Left;
        mmi.ptMaxSize.Y = mi.rcWork.Bottom - mi.rcWork.Top;
        // 注意：不动 ptMaxTrackSize —— 那是「手动拖拽上限」，压到工作区会让窗口
        // 没法跨显示器拉宽；这里只修最大化/贴边，用户自己拖到任务栏底下属于他的自由。

        // handled=true 会跳过 WPF 自己的处理，所以最小尺寸得自己补回来
        double scale = 1.0;
        try { scale = GetDpiForWindow(hwnd) / 96.0; } catch { }
        if (scale <= 0) scale = 1.0;
        mmi.ptMinTrackSize.X = Math.Max(mmi.ptMinTrackSize.X, (int)Math.Round(MinWidth * scale));
        mmi.ptMinTrackSize.Y = Math.Max(mmi.ptMinTrackSize.Y, (int)Math.Round(MinHeight * scale));

        Marshal.StructureToPtr(mmi, lParam, true);
    }

    // 确保标题栏/控制条在屏幕内（多显示器/远程桌面 CenterScreen 可能顶出屏幕）
    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MINMAXINFO
    {
        public POINT ptReserved;
        public POINT ptMaxSize;
        public POINT ptMaxPosition;
        public POINT ptMinTrackSize;
        public POINT ptMaxTrackSize;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hwnd);

    // 确保窗口完整落在所在显示器工作区内：
    // 尺寸过大时收缩（避免 150% DPI 下窗口比屏幕还大、底部内容被顶出屏幕
    // 看不到，例如加载遮罩的状态/日志区），位置越界时拉回。
    private void ClampWindowIntoWorkArea()
    {
        try
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            if (hwnd == IntPtr.Zero) return;
            var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
            if (!GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref mi)) return;

            // 工作区转成 DIP（Left/Top/Width/Height 是 DIP）
            double scale = 1.0;
            try { scale = GetDpiForWindow(hwnd) / 96.0; } catch { }
            double waLeft = mi.rcWork.Left / scale;
            double waTop = mi.rcWork.Top / scale;
            double waW = (mi.rcWork.Right - mi.rcWork.Left) / scale;
            double waH = (mi.rcWork.Bottom - mi.rcWork.Top) / scale;

            // 尺寸过大 → 收缩到工作区（保留最小尺寸）
            double w = Width, h = Height;
            double maxW = waW - 24, maxH = waH - 24;
            if (maxW >= MinWidth && w > maxW) w = maxW;
            if (maxH >= MinHeight && h > maxH) h = maxH;
            if (w != Width) Width = w;
            if (h != Height) Height = h;

            // 位置钳位
            double x = Left, y = Top;
            double minX = waLeft, minY = waTop;
            double maxX = waLeft + waW - Math.Min(80, w);
            double maxY = waTop + waH - Math.Min(80, h);
            if (maxX < minX || maxY < minY) return;
            double nx = Math.Clamp(x, minX, maxX);
            double ny = Math.Clamp(y, minY, maxY);
            if (nx != x) Left = nx;
            if (ny != y) Top = ny;
        }
        catch { /* ignore */ }
    }
}
