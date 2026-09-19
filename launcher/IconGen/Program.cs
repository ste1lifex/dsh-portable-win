using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace IconGen;

/// <summary>
/// Renders the DeepSeek whale (from dsh-web-frontend favicon.svg) into a
/// rounded blue app icon, then packs it into a multi-size .ico plus PNGs.
/// </summary>
public static class Program
{
    // Path data copied verbatim from dsh-web-frontend/dist/favicon.svg (viewBox 0 0 50 50).
    private const string WhalePathData =
        "M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z";

    private static readonly int[] Sizes = { 16, 24, 32, 48, 64, 128, 256 };

    [STAThread]
    public static int Main(string[] args)
    {
        // 角色图标模式：IconGen --character <src.jpg> <winOutDir> [macOutDir]
        // Windows：深色底（原图）/ 浅色底（黑底换成白色）两套 PNG + 多尺寸 .ico
        // macOS  ：同一套两版 PNG（Dock 运行时切换）+ DSH.icns（Finder/Launchpad）
        if (args.Length >= 3 && args[0] == "--character")
            return RunCharacter(args[1], args[2], args.Length >= 4 ? args[3] : null);

        if (args.Length < 3)
        {
            Console.Error.WriteLine("usage: IconGen <out.ico> <out-256.png> <out-48.png>");
            Console.Error.WriteLine("       IconGen --character <srcImage> <outDir>");
            return 2;
        }

        var icoPath = args[0];
        var png256Path = args[1];
        var png48Path = args[2];

        // 深色底 + 白鲸（Windows 深色模式 / 静态 exe 图标）
        var darkTile = Color.FromRgb(0x1A, 0x1C, 0x1A);
        // 浅色底 + DeepSeek 蓝鲸（Windows 浅色模式，运行时主题切换用）
        var lightTile = Color.FromRgb(0xF2, 0xF2, 0xEC);
        var blue = Color.FromRgb(0x4D, 0x6B, 0xFE);

        var frames = new Dictionary<int, byte[]>();
        foreach (var size in Sizes)
            frames[size] = RenderTilePng(size, darkTile, Colors.White);

        WriteIco(icoPath, frames);
        File.WriteAllBytes(png256Path, frames[256]);
        File.WriteAllBytes(png48Path, frames[48]);

        // 主题切换用的浅色图标（放在同目录，供 DshDesktop 运行时按 Windows 深浅色切换）
        var light256 = RenderTilePng(256, lightTile, blue);
        var lightPath = Path.Combine(Path.GetDirectoryName(png256Path)!, "whale-light.png");
        File.WriteAllBytes(lightPath, light256);

        Console.WriteLine($"icon written: {icoPath} ({frames.Count} sizes) + whale-light.png");
        return 0;
    }

    // =====================================================================
    //  角色图标（深色底原图 / 浅色底换白底）
    // =====================================================================

    /// <summary>
    /// 把一张「人物 + 深色底」的方图做成桌面端图标：
    /// * 深色一套：原图直接裁圆角（供深色模式 / exe 静态图标）
    /// * 浅色一套：从贴边连通的黑底泛洪换成白色，人物内部的深色（眼睛、发影）不动
    /// Windows 输出 icon-dark[-256/-48].png、icon-light[-256/-48].png 与 DshDesktop.ico；
    /// 传入 macOutDir 时额外输出 DSH.icns 与 dock-dark/light.png（macOS Dock 运行时切换用）。
    /// </summary>
    private static int RunCharacter(string srcPath, string outDir, string? macOutDir)
    {
        if (!File.Exists(srcPath))
        {
            Console.Error.WriteLine($"找不到源图：{srcPath}");
            return 2;
        }
        Directory.CreateDirectory(outDir);

        var source = LoadPixels(srcPath);
        var light = ReplaceDarkBackground(source, Colors.White, out int replaced);

        var darkFrames = new Dictionary<int, byte[]>();
        var lightFrames = new Dictionary<int, byte[]>();
        foreach (var size in Sizes)
        {
            darkFrames[size] = RenderArtPng(source, size);
            lightFrames[size] = RenderArtPng(light, size);
        }

        WriteIco(Path.Combine(outDir, "DshDesktop.ico"), darkFrames);
        File.WriteAllBytes(Path.Combine(outDir, "icon-dark-256.png"), darkFrames[256]);
        File.WriteAllBytes(Path.Combine(outDir, "icon-dark-48.png"), darkFrames[48]);
        File.WriteAllBytes(Path.Combine(outDir, "icon-light-256.png"), lightFrames[256]);
        File.WriteAllBytes(Path.Combine(outDir, "icon-light-48.png"), lightFrames[48]);

        Console.WriteLine($"character icon written to {outDir}：DshDesktop.ico（{Sizes.Length} 尺寸）"
                          + $" + icon-dark/light-256/48.png（背景替换 {replaced} 像素）");

        if (!string.IsNullOrWhiteSpace(macOutDir))
        {
            Directory.CreateDirectory(macOutDir);
            WriteIcns(Path.Combine(macOutDir, "DSH.icns"), source, light);
            File.WriteAllBytes(Path.Combine(macOutDir, "dock-dark.png"), darkFrames[256]);
            File.WriteAllBytes(Path.Combine(macOutDir, "dock-light.png"), lightFrames[256]);
            Console.WriteLine($"macOS icon written to {macOutDir}：DSH.icns + dock-dark/light.png");
        }
        return 0;
    }

    /// <summary>
    /// 写 macOS .icns：icns 头 + 若干 PNG 条目（现代 macOS 直接吃 PNG）。
    /// 覆盖 16@2x…512@2x 的标准槽位，Retina Dock / Launchpad 都能取到足够大的图。
    /// </summary>
    private static void WriteIcns(string path, BitmapSource darkArt, BitmapSource lightArt)
    {
        // 类型码 -> 像素尺寸；macOS 侧的 Dock 图标跟系统外观走，Finder 用 icns 里的深色版
        var slots = new (string Type, int Size)[]
        {
            ("ic11", 32),   // 16@2x
            ("ic12", 64),   // 32@2x
            ("ic07", 128),  // 128
            ("ic13", 256),  // 128@2x
            ("ic08", 256),  // 256
            ("ic14", 512),  // 256@2x
            ("ic09", 512),  // 512
            ("ic10", 1024), // 512@2x
        };

        var entries = new List<(string Type, byte[] Data)>();
        foreach (var (type, size) in slots)
            entries.Add((type, RenderArtPng(darkArt, size)));

        int total = 8 + entries.Sum(e => 8 + e.Data.Length);
        using var fs = File.Create(path);
        using var bw = new BinaryWriter(fs);
        bw.Write(new[] { (byte)'i', (byte)'c', (byte)'n', (byte)'s' });
        WriteBigEndian(bw, total);
        foreach (var (type, data) in entries)
        {
            bw.Write(System.Text.Encoding.ASCII.GetBytes(type));
            WriteBigEndian(bw, 8 + data.Length);
            bw.Write(data);
        }
        // 浅色版只用于 Dock 运行时切换，单独出 PNG（dock-light.png），不进 icns
        _ = lightArt;
    }

    private static void WriteBigEndian(BinaryWriter bw, int value)
    {
        bw.Write((byte)((value >> 24) & 0xFF));
        bw.Write((byte)((value >> 16) & 0xFF));
        bw.Write((byte)((value >> 8) & 0xFF));
        bw.Write((byte)(value & 0xFF));
    }

    /// <summary>读图并统一成 Bgra32，方便直接按字节处理。</summary>
    private static BitmapSource LoadPixels(string path)
    {
        var img = new BitmapImage();
        img.BeginInit();
        img.UriSource = new Uri(Path.GetFullPath(path));
        img.CacheOption = BitmapCacheOption.OnLoad;
        img.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
        img.EndInit();
        return new FormatConvertedBitmap(img, PixelFormats.Bgra32, null, 0);
    }

    /// <summary>
    /// 从「贴边的深色区域」泛洪，把背景换成 <paramref name="fill"/>。
    /// 只泛洪与边缘连通的像素，因此人物内部的纯黑（眼睛、发影）不会被误伤。
    /// </summary>
    private static BitmapSource ReplaceDarkBackground(BitmapSource src, Color fill, out int replaced)
    {
        int w = src.PixelWidth, h = src.PixelHeight, stride = w * 4;
        var px = new byte[stride * h];
        src.CopyPixels(px, stride, 0);

        // 背景色：取顶边条带里偏暗像素的中位数（顶边既有背景也有发丝，所以要过滤）
        var samples = new List<(int l, int r, int g, int b)>();
        for (int y = 0; y < 4 && y < h; y++)
            for (int x = 0; x < w; x++)
            {
                int o = y * stride + x * 4;
                int r = px[o + 2], g = px[o + 1], b = px[o];
                int l = Luma(r, g, b);
                if (l < 70) samples.Add((l, r, g, b));
            }
        if (samples.Count == 0)
        {
            replaced = 0;
            return src;   // 顶边找不到背景：原样返回（浅色图标会跟深色一样，但不至于毁图）
        }
        samples.Sort((a, b2) => a.l.CompareTo(b2.l));
        var mid = samples[samples.Count / 2];
        int bgR = mid.r, bgG = mid.g, bgB = mid.b;

        const int Tolerance = 60;     // 与背景色的距离阈值
        const int MaxLuma = 130;      // 亮度保险：亮部（脸/衣服）永不填充

        var mask = new bool[w * h];
        var queue = new Queue<int>();
        void TrySeed(int x, int y)
        {
            int p = y * w + x, o = y * stride + x * 4;
            if (mask[p]) return;
            int r = px[o + 2], g = px[o + 1], b = px[o];
            if (Luma(r, g, b) > MaxLuma) return;
            if (Dist(r, g, b, bgR, bgG, bgB) > Tolerance) return;
            mask[p] = true;
            queue.Enqueue(p);
        }

        // 种子：顶边 + 左右两侧的上半段（背景主要从上方包过来）
        for (int x = 0; x < w; x++) TrySeed(x, 0);
        for (int y = 0; y < h / 3; y++) { TrySeed(0, y); TrySeed(w - 1, y); }

        while (queue.Count > 0)
        {
            int p = queue.Dequeue();
            int x = p % w, y = p / w;
            if (x > 0) TrySeed(x - 1, y);
            if (x < w - 1) TrySeed(x + 1, y);
            if (y > 0) TrySeed(x, y - 1);
            if (y < h - 1) TrySeed(x, y + 1);
        }

        replaced = 0;
        for (int p = 0; p < mask.Length; p++)
        {
            if (!mask[p]) continue;
            int o = p * 4;
            px[o] = fill.B; px[o + 1] = fill.G; px[o + 2] = fill.R; px[o + 3] = 255;
            replaced++;
        }

        var outBmp = BitmapSource.Create(w, h, 96, 96, PixelFormats.Bgra32, null, px, stride);
        outBmp.Freeze();
        return outBmp;
    }

    private static int Luma(int r, int g, int b) => (299 * r + 587 * g + 114 * b) / 1000;

    private static int Dist(int r1, int g1, int b1, int r2, int g2, int b2)
    {
        int dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
        return (int)Math.Sqrt(dr * dr + dg * dg + db * db);
    }

    /// <summary>整图铺满尺寸 + 22% 圆角（与鲸鱼图标同一套观感）。</summary>
    private static byte[] RenderArtPng(BitmapSource art, int size)
    {
        var dv = new DrawingVisual();
        using (var dc = dv.RenderOpen())
        {
            var full = new Rect(0, 0, size, size);
            double radius = size * 0.22;
            dc.PushClip(new RectangleGeometry(full, radius, radius));
            dc.DrawImage(art, full);
            dc.Pop();
        }
        var rtb = new RenderTargetBitmap(size, size, 96, 96, PixelFormats.Pbgra32);
        rtb.Render(dv);
        var enc = new PngBitmapEncoder();
        enc.Frames.Add(BitmapFrame.Create(rtb));
        using var ms = new MemoryStream();
        enc.Save(ms);
        return ms.ToArray();
    }

    /// <summary>圆角底 + 居中鲸鱼（跟随 Windows 深浅色的两套图标共用这一个渲染）。</summary>
    private static byte[] RenderTilePng(int size, Color tile, Color whale)
    {
        var dv = new DrawingVisual();
        using (var dc = dv.RenderOpen())
        {
            var full = new Rect(0, 0, size, size);
            double radius = size * 0.22;
            var bg = new RectangleGeometry(full, radius, radius);
            var tileBrush = new SolidColorBrush(tile);
            tileBrush.Freeze();
            dc.DrawGeometry(tileBrush, null, bg);

            var whaleGeo = Geometry.Parse(WhalePathData);
            var bounds = whaleGeo.Bounds; // 0..50
            double target = size * 0.72;
            double scale = target / Math.Max(bounds.Width, bounds.Height);
            var tg = new TransformGroup();
            tg.Children.Add(new ScaleTransform(scale, scale));
            tg.Children.Add(new TranslateTransform(
                (size - bounds.Width * scale) / 2 - bounds.X * scale,
                (size - bounds.Height * scale) / 2 - bounds.Y * scale));
            dc.PushTransform(tg);
            var whaleBrush = new SolidColorBrush(whale);
            whaleBrush.Freeze();
            dc.DrawGeometry(whaleBrush, null, whaleGeo);
            dc.Pop();
        }

        var rtb = new RenderTargetBitmap(size, size, 96, 96, PixelFormats.Pbgra32);
        rtb.Render(dv);
        var enc = new PngBitmapEncoder();
        enc.Frames.Add(BitmapFrame.Create(rtb));
        using var ms = new MemoryStream();
        enc.Save(ms);
        return ms.ToArray();
    }

    private static void WriteIco(string path, Dictionary<int, byte[]> frames)
    {
        using var fs = File.Create(path);
        using var bw = new BinaryWriter(fs);
        int count = frames.Count;
        bw.Write((short)0);
        bw.Write((short)1);
        bw.Write((short)count);
        int offset = 6 + 16 * count;
        foreach (var size in Sizes)
        {
            var data = frames[size];
            bw.Write((byte)(size >= 256 ? 0 : size));
            bw.Write((byte)(size >= 256 ? 0 : size));
            bw.Write((byte)0);   // palette
            bw.Write((byte)0);   // reserved
            bw.Write((short)1);  // planes
            bw.Write((short)32); // bpp
            bw.Write(data.Length);
            bw.Write(offset);
            offset += data.Length;
        }
        foreach (var size in Sizes)
            bw.Write(frames[size]);
    }
}
