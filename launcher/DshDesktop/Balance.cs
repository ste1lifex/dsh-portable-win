using System;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace DshDesktop;

/// <summary>DeepSeek 官方账户余额（GET /user/balance 的一条 balance_infos）。</summary>
internal sealed class BalanceInfo
{
    public bool Available { get; init; }
    public string Currency { get; init; } = "CNY";
    public decimal Total { get; init; }
    public decimal Granted { get; init; }
    public decimal ToppedUp { get; init; }

    public string Symbol => string.Equals(Currency, "USD", StringComparison.OrdinalIgnoreCase) ? "$" : "¥";

    public string Display => Symbol + Total.ToString("0.00", CultureInfo.InvariantCulture);

    /// <summary>悬停提示里的明细。</summary>
    public string Breakdown =>
        $"总计 {Display}（赠送 {Symbol}{Granted.ToString("0.00", CultureInfo.InvariantCulture)}"
        + $" + 充值 {Symbol}{ToppedUp.ToString("0.00", CultureInfo.InvariantCulture)}）";
}

/// <summary>
/// 读 DEEPSEEK_API_KEY 并查询官方余额。
/// 只走 https://api.deepseek.com/user/balance，密钥只用于 Authorization 头，绝不写日志。
/// </summary>
internal static class DeepSeekBalance
{
    private const string Endpoint = "https://api.deepseek.com/user/balance";

    /// <summary>密钥来源：进程环境变量 → app-npm\.env → 包根 .env。</summary>
    public static string? ReadApiKey(string root)
    {
        var fromEnv = Environment.GetEnvironmentVariable("DEEPSEEK_API_KEY");
        if (!string.IsNullOrWhiteSpace(fromEnv)) return fromEnv.Trim();

        foreach (var file in new[]
                 {
                     Path.Combine(root, "app-npm", ".env"),
                     Path.Combine(root, ".env"),
                 })
        {
            var key = ReadKeyFromEnvFile(file);
            if (!string.IsNullOrWhiteSpace(key)) return key;
        }
        return null;
    }

    private static string? ReadKeyFromEnvFile(string path)
    {
        try
        {
            if (!File.Exists(path)) return null;
            foreach (var raw in File.ReadAllLines(path))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line[0] == '#') continue;
                int eq = line.IndexOf('=');
                if (eq <= 0) continue;
                if (!line[..eq].Trim().Equals("DEEPSEEK_API_KEY", StringComparison.Ordinal)) continue;
                var value = line[(eq + 1)..].Trim().Trim('"', '\'');
                if (value.Length > 0) return value;
            }
        }
        catch { /* 读不到就当没配 */ }
        return null;
    }

    /// <summary>查询余额；失败时返回给用户看的中文原因（不含密钥）。</summary>
    public static async Task<(BalanceInfo? Info, string? Error)> QueryAsync(string apiKey, CancellationToken ct)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            try { http.DefaultRequestHeaders.UserAgent.ParseAdd("DshDesktop/1.0"); } catch { }

            using var resp = await http.GetAsync(Endpoint, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
            {
                return (null, resp.StatusCode switch
                {
                    System.Net.HttpStatusCode.Unauthorized => "密钥无效或已过期（401）",
                    System.Net.HttpStatusCode.PaymentRequired => "账户不可用（402）",
                    System.Net.HttpStatusCode.TooManyRequests => "请求过于频繁（429）",
                    _ => $"查询失败：HTTP {(int)resp.StatusCode}",
                });
            }

            await using var stream = await resp.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct).ConfigureAwait(false);
            var root = doc.RootElement;

            bool available = root.TryGetProperty("is_available", out var av)
                             && av.ValueKind == JsonValueKind.True;

            if (!root.TryGetProperty("balance_infos", out var infos)
                || infos.ValueKind != JsonValueKind.Array
                || infos.GetArrayLength() == 0)
                return (null, "接口未返回余额信息");

            // 官方会同时返回 USD / CNY 两条，优先人民币（另一条通常是 0）
            var pick = infos[0];
            foreach (var item in infos.EnumerateArray())
            {
                if (item.TryGetProperty("currency", out var cur)
                    && string.Equals(cur.GetString(), "CNY", StringComparison.OrdinalIgnoreCase))
                {
                    pick = item;
                    break;
                }
            }

            return (new BalanceInfo
            {
                Available = available,
                Currency = pick.TryGetProperty("currency", out var c) ? c.GetString() ?? "CNY" : "CNY",
                Total = Amount(pick, "total_balance"),
                Granted = Amount(pick, "granted_balance"),
                ToppedUp = Amount(pick, "topped_up_balance"),
            }, null);
        }
        catch (OperationCanceledException) { return (null, "查询超时"); }
        catch (Exception ex) { return (null, "查询失败：" + ex.Message); }
    }

    private static decimal Amount(JsonElement el, string name)
        => el.TryGetProperty(name, out var v)
           && decimal.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d)
            ? d
            : 0m;
}
