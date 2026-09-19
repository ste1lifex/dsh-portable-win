using System;
using System.Collections.Generic;
using System.Globalization;
using System.Windows;
using System.Windows.Media;
using DshDesktopEngine;

namespace DshDesktop;

/// <summary>浅色 / 深色。</summary>
internal enum DsThemeKind { Dark = 0, Light = 1 }

/// <summary>
/// 桌面壳（WPF 原生部分）的配色与主题切换。
///
/// DSH 界面本身（WebUI）会跟随 Windows 深浅色或用户在「设置」里选的
/// ui-theme.preference 自动变色；原生控制条以前是写死的墨黑，于是会出现
/// “网页变白、外壳还是黑的”割裂感。这里把外壳的每个颜色都做成可改写的
/// 共享画刷：
///
/// * 页面加载前：按注册表 AppsUseLightTheme 选择内置调色板（启动即正确）；
/// * 页面加载后：注入的脚本把<body data-ds-dark-theme>状态与实时设计令牌
///   （--dsw-alias-*）回传给宿主，外壳与网页逐像素对齐（皮肤也能跟随）。
///
/// 调色板取值对齐 DSH 设计令牌，深色底 #151517 / 浅色底 #ffffff 与网页一致。
/// </summary>
internal static class DsTheme
{
    public static DsThemeKind Current { get; private set; } = DsThemeKind.Dark;

    /// <summary>主题（深浅或配色）发生变化时触发。</summary>
    public static event Action<DsThemeKind>? Changed;

    private static readonly Dictionary<string, SolidColorBrush> Cache = new(StringComparer.Ordinal);

    // =====================================================================
    //  调色板：Key -> (深色 ARGB, 浅色 ARGB)
    // =====================================================================
    private static readonly (string Key, uint Dark, uint Light)[] Palette =
    {
        ("WindowBg",           0xFF151517, 0xFFFFFFFF),
        ("ChromeBg",           0xFF1B1B1C, 0xFFF5F6F7),
        ("CardBg",             0xFF1B1B1C, 0xFFF9FAFB),
        ("CardBorder",         0x1FFFFFFF, 0x1A000000),
        ("LogBg",              0xFF0F1115, 0xFFF9FAFB),
        ("TextPrimary",        0xFFF9FAFB, 0xFF0F1115),
        ("TextSecondary",      0xFFCFD3D6, 0xFF61666B),
        ("TextDim",            0xFFADB2B8, 0xFF81858C),
        ("OnAccentFg",         0xFFFFFFFF, 0xFFFFFFFF),
        ("AccentBrush",        0xFF4D6BFE, 0xFF4D6BFE),
        ("AccentHoverBrush",   0xFF5E7BFF, 0xFF5E7BFF),
        ("AccentPressedBrush", 0xFF3A55E0, 0xFF3A55E0),
        ("GreenBrush",         0xFF34D399, 0xFF22C55E),
        ("AmberBrush",         0xFFFBBF24, 0xFFF59E0B),
        ("RedBrush",           0xFFF87171, 0xFFEC1313),
        ("GrayBrush",          0xFF8A8D88, 0xFF81858C),
        // 次要按钮：对齐网页端「无边框 + 抬升底色」（深色用 layer-2/layer-3，
        // 浅色各层都是白，只能靠一圈描边区分）
        ("GhostBg",            0xFF2C2C2E, 0xFFFFFFFF),
        ("GhostBorder",        0x002C2C2E, 0x1A000000),
        ("GhostHoverBg",       0xFF353638, 0xFFF1F3F5),
        ("GhostHoverBorder",   0x00353638, 0x29000000),
        ("GhostPressedBg",     0xFF3E3F42, 0xFFE9ECF2),
        // 危险按钮：网页端 danger 是纯色底，不描边
        ("DangerBg",           0x26F25A5A, 0xFFFEF2F2),
        ("DangerFg",           0xFFFF8A8A, 0xFFEC1313),
        ("DangerBorder",       0x00F25A5A, 0x00EC1313),
        ("DangerHoverBg",      0x40F25A5A, 0xFFFEE2E2),
        ("DangerHoverBorder",  0x00F25A5A, 0x00EC1313),
        ("DangerPressedBg",    0x59F25A5A, 0xFFFECACA),
        // 标题栏按钮
        ("TitleHoverBg",       0x1FFFFFFF, 0x14000000),
        ("TitlePressedBg",     0x29FFFFFF, 0x1F000000),
        // 版本徽标
        ("BadgeNeutralBg",     0xFF1C212B, 0xFFF1F3F5),
        ("BadgeNeutralFg",     0xFF8A94A6, 0xFF61666B),
        ("BadgeGreenBg",       0xFF0E2B22, 0xFFDCFCE7),
        ("BadgeGreenFg",       0xFF34D399, 0xFF15803D),
        ("BadgeAmberBg",       0xFF2E2510, 0xFFFEF3C7),
        ("BadgeAmberFg",       0xFFFBBF24, 0xFFB45309),
        // 文本选择与右键菜单
        ("SelectionBg",        0x664D6BFE, 0x664D6BFE),
        ("MenuBg",             0xFF232324, 0xFFFFFFFF),
        ("MenuBorder",         0x29FFFFFF, 0x29000000),
        ("MenuHoverBg",        0xFF2C2C2E, 0xFFF1F3F5),
        ("MenuFg",             0xFFF9FAFB, 0xFF0F1115),
        ("MenuSeparator",      0x1FFFFFFF, 0x1A000000),
    };

    // =====================================================================
    //  日志行配色（深色 / 浅色）
    // =====================================================================
    private static readonly (string Key, uint Dark, uint Light)[] LogPalette =
    {
        ("LogDefault", 0xFFCFD3D6, 0xFF3A4046),
        ("LogDim",     0xFF81858C, 0xFF8A9096),
        ("LogInfo",    0xFF7DD3FC, 0xFF0369A1),
        ("LogGood",    0xFF34D399, 0xFF15803D),
        ("LogWarn",    0xFFFBBF24, 0xFFB45309),
        ("LogBad",     0xFFF87171, 0xFFDC2626),
        ("LogAccent",  0xFF8FA6FF, 0xFF3A55E0),
    };

    // 启动遮罩（Endfield 启动屏）始终是墨黑底，它里面的迷你日志用固定深色配色。
    private static readonly (string Key, uint Argb)[] BootLogPalette =
    {
        ("BootLogDefault", 0xFFC9D1DF),
        ("BootLogDim",     0xFF6B7484),
        ("BootLogInfo",    0xFF7DD3FC),
        ("BootLogGood",    0xFF34D399),
        ("BootLogWarn",    0xFFFBBF24),
        ("BootLogBad",     0xFFF87171),
        ("BootLogAccent",  0xFF8FA6FF),
    };

    // =====================================================================
    //  实时令牌 -> 本地画刷（页面回传时优先采用，皮肤也能跟随）
    //
    //  这里刻意只映射「不会和原生控制条冲突」的颜色：
    //  * 画布底色 / 文字 / 边框 / 菜单跟着网页（皮肤换色时外壳同步）；
    //  * 顶栏、底栏、日志底 用内置值 —— 它们对齐的是网页最外层侧栏的颜色，
    //    直接用 --dsw-alias-bg-layer-1 会亮一档，在原生条与网页之间露出一道缝。
    // =====================================================================
    private static readonly (string Key, string Token)[] TokenMap =
    {
        ("WindowBg",      "bgBase"),
        ("CardBorder",    "border2"),
        ("MenuBg",        "layer1"),
        ("MenuHoverBg",   "layer2"),
        ("TextPrimary",   "label1"),
        ("TextSecondary", "label2"),
        ("TextDim",       "label3"),
    };

    // =====================================================================
    //  对外画刷（都是共享实例：改色即全局生效，已渲染的日志行也会跟着变）
    // =====================================================================

    public static Brush LogDefault => LogBrush(DshLogKind.Default);
    public static Brush LogDim => LogBrush(DshLogKind.Dim);
    public static Brush LogInfo => LogBrush(DshLogKind.Info);
    public static Brush LogGood => LogBrush(DshLogKind.Good);
    public static Brush LogWarn => LogBrush(DshLogKind.Warn);
    public static Brush LogBad => LogBrush(DshLogKind.Bad);
    public static Brush LogAccent => LogBrush(DshLogKind.Accent);

    public static Brush BadgeGreenFg => Shared("BadgeGreenFg");
    public static Brush BadgeGreenBg => Shared("BadgeGreenBg");
    public static Brush BadgeAmberFg => Shared("BadgeAmberFg");
    public static Brush BadgeAmberBg => Shared("BadgeAmberBg");
    public static Brush BadgeGrayFg => Shared("BadgeNeutralFg");
    public static Brush BadgeGrayBg => Shared("BadgeNeutralBg");
    public static Brush Accent => Shared("AccentBrush");
    public static Brush Green => Shared("GreenBrush");

    private static string LogKey(DshLogKind kind) => kind switch
    {
        DshLogKind.Dim => "LogDim",
        DshLogKind.Info => "LogInfo",
        DshLogKind.Good => "LogGood",
        DshLogKind.Warn => "LogWarn",
        DshLogKind.Bad => "LogBad",
        DshLogKind.Accent => "LogAccent",
        _ => "LogDefault",
    };

    private static string BootLogKey(DshLogKind kind) => kind switch
    {
        DshLogKind.Dim => "BootLogDim",
        DshLogKind.Info => "BootLogInfo",
        DshLogKind.Good => "BootLogGood",
        DshLogKind.Warn => "BootLogWarn",
        DshLogKind.Bad => "BootLogBad",
        DshLogKind.Accent => "BootLogAccent",
        _ => "BootLogDefault",
    };

    public static Brush LogBrush(DshLogKind kind) => Shared(LogKey(kind));

    public static Brush BootLogBrush(DshLogKind kind) => Shared(BootLogKey(kind));

    // =====================================================================
    //  应用主题
    // =====================================================================

    /// <summary>
    /// 应用主题。<paramref name="tokens"/> 来自页面（可空）：
    /// 命中的令牌会覆盖内置调色板，实现与 WebUI（含皮肤）逐像素对齐。
    /// </summary>
    /// <returns>是否发生了可见变化。</returns>
    public static bool Apply(DsThemeKind kind, IReadOnlyDictionary<string, Color>? tokens = null)
    {
        var res = Application.Current?.Resources;
        if (res is null) return false;

        bool changed = Current != kind;
        Current = kind;

        foreach (var (key, dark, light) in Palette)
        {
            var color = FromArgb(kind == DsThemeKind.Dark ? dark : light);
            if (tokens is not null && TryToken(key, tokens, out var tc)) color = tc;
            if (Set(res, key, color)) changed = true;
        }

        foreach (var (key, dark, light) in LogPalette)
            if (Set(res, key, FromArgb(kind == DsThemeKind.Dark ? dark : light))) changed = true;

        foreach (var (key, argb) in BootLogPalette)
            if (Set(res, key, FromArgb(argb))) changed = true;

        if (changed) Changed?.Invoke(kind);
        return changed;
    }

    private static bool TryToken(string key, IReadOnlyDictionary<string, Color> tokens, out Color color)
    {
        color = default;
        foreach (var (k, token) in TokenMap)
            if (k == key && tokens.TryGetValue(token, out color))
                return true;
        return false;
    }

    // =====================================================================
    //  画刷存取
    // =====================================================================

    /// <summary>取（必要时新建）应用资源里的共享画刷。</summary>
    private static SolidColorBrush Shared(string key)
    {
        if (Cache.TryGetValue(key, out var cached) && !cached.IsFrozen) return cached;

        var res = Application.Current?.Resources;
        if (res?[key] is SolidColorBrush existing)
        {
            Cache[key] = existing;
            return existing;
        }

        var created = new SolidColorBrush(Colors.Transparent);
        if (res is not null) res[key] = created;
        Cache[key] = created;
        return created;
    }

    /// <summary>
    /// 写入一个资源画刷。XAML 里声明的画刷会被 WPF 冻结，改色无效，
    /// 这种情况只能换成新的可写实例（XAML 侧必须用 DynamicResource 才会重新求值）；
    /// 代码里创建的画刷（日志配色等）则就地改色，已渲染的 Run 也会跟着变。
    /// </summary>
    private static bool Set(ResourceDictionary res, string key, Color color)
    {
        if (res[key] is SolidColorBrush brush && !brush.IsFrozen)
        {
            Cache[key] = brush;
            if (brush.Color == color) return false;
            brush.Color = color;
            return true;
        }

        // 资源缺失（或极少数被冻结的情况）：换一个可写实例。
        var fresh = new SolidColorBrush(color);
        res[key] = fresh;
        Cache[key] = fresh;
        return true;
    }

    private static Color FromArgb(uint v)
        => Color.FromArgb((byte)((v >> 24) & 0xFF), (byte)((v >> 16) & 0xFF), (byte)((v >> 8) & 0xFF), (byte)(v & 0xFF));

    // =====================================================================
    //  CSS 颜色解析（页面回传的是 CSS 计算值）
    // =====================================================================

    public static bool TryParseCssColor(string? text, out Color color)
    {
        color = default;
        if (string.IsNullOrWhiteSpace(text)) return false;
        var s = text.Trim();
        if (s.Equals("transparent", StringComparison.OrdinalIgnoreCase)) { color = Colors.Transparent; return true; }
        if (s.StartsWith("var(", StringComparison.OrdinalIgnoreCase)) return false;
        if (s.StartsWith("color-mix(", StringComparison.OrdinalIgnoreCase)) return false;

        if (s[0] == '#')
        {
            var hex = s[1..];
            if (hex.Length == 3 || hex.Length == 4)
            {
                var expanded = string.Empty;
                foreach (var ch in hex) expanded += new string(ch, 2);
                hex = expanded;
            }
            if (hex.Length != 6 && hex.Length != 8) return false;
            if (!uint.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var v)) return false;
            if (hex.Length == 6)
            {
                color = Color.FromRgb((byte)((v >> 16) & 0xFF), (byte)((v >> 8) & 0xFF), (byte)(v & 0xFF));
            }
            else
            {
                // CSS 是 #RRGGBBAA，WPF 是 #AARRGGBB
                byte r = (byte)((v >> 24) & 0xFF), g = (byte)((v >> 16) & 0xFF), b = (byte)((v >> 8) & 0xFF), a = (byte)(v & 0xFF);
                color = Color.FromArgb(a, r, g, b);
            }
            return true;
        }

        if (s.StartsWith("rgb", StringComparison.OrdinalIgnoreCase))
        {
            int open = s.IndexOf('('), close = s.LastIndexOf(')');
            if (open < 0 || close <= open) return false;
            var parts = s[(open + 1)..close].Split(new[] { ',', ' ', '/' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 3) return false;
            if (!TryChannel(parts[0], out var r) || !TryChannel(parts[1], out var g) || !TryChannel(parts[2], out var b)) return false;
            byte a = 255;
            if (parts.Length >= 4)
            {
                var at = parts[3];
                if (at.EndsWith("%", StringComparison.Ordinal))
                {
                    if (double.TryParse(at[..^1], NumberStyles.Float, CultureInfo.InvariantCulture, out var pct))
                        a = (byte)Math.Clamp(Math.Round(pct * 2.55), 0, 255);
                }
                else if (double.TryParse(at, NumberStyles.Float, CultureInfo.InvariantCulture, out var alpha))
                {
                    a = (byte)Math.Clamp(Math.Round(alpha * 255), 0, 255);
                }
            }
            color = Color.FromArgb(a, r, g, b);
            return true;
        }

        return false;
    }

    private static bool TryChannel(string text, out byte value)
    {
        value = 0;
        if (text.EndsWith("%", StringComparison.Ordinal))
        {
            if (!double.TryParse(text[..^1], NumberStyles.Float, CultureInfo.InvariantCulture, out var pct)) return false;
            value = (byte)Math.Clamp(Math.Round(pct * 2.55), 0, 255);
            return true;
        }
        if (!double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) return false;
        value = (byte)Math.Clamp(Math.Round(d), 0, 255);
        return true;
    }

    // =====================================================================
    //  Windows 主题
    // =====================================================================

    /// <summary>读注册表：应用界面是否为浅色（AppsUseLightTheme）。</summary>
    public static bool OsAppsLight()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            var v = key?.GetValue("AppsUseLightTheme");
            return v is int iv ? iv == 1 : true;
        }
        catch { return true; }
    }

    /// <summary>
    /// 任务栏/窗口图标用系统主题（SystemUsesLightTheme）判定：
    /// 图标贴在任务栏上，跟随系统而非应用界面更不容易“白鲸撞白底”。
    /// </summary>
    public static bool OsSystemLight()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            var v = key?.GetValue("SystemUsesLightTheme");
            return v is int iv ? iv == 1 : OsAppsLight();
        }
        catch { return OsAppsLight(); }
    }

    /// <summary>环境变量 DSH_DESKTOP_THEME=light|dark 可强制主题（排查/截图用）。</summary>
    public static DsThemeKind? Forced()
    {
        var v = Environment.GetEnvironmentVariable("DSH_DESKTOP_THEME");
        if (string.IsNullOrWhiteSpace(v)) return null;
        return v.Trim().ToLowerInvariant() switch
        {
            "light" => DsThemeKind.Light,
            "dark" => DsThemeKind.Dark,
            _ => null,
        };
    }
}
