# Free web-search backends / MCP servers for a mainland-China dsh user (verified 2026-09)

Scope: alternatives/supplements to `@liustack/modsearch` (installed here at v5.10.3).

**How to read the "China" column.** I ran live HTTPS probes **from this user's own Windows machine**
(no `HTTP_PROXY`/`HTTPS_PROXY` set). Everything marked ✅ was reachable and returned real payloads.
That is direct evidence for *this* machine, not proof of a clean mainland-China route — a
router-level/TUN VPN would look identical from inside PowerShell. Items marked ⚠️ were not probed.

## Table

| Name | Type | Free quota | Needs card? | Needs key? | Works without a proxy from mainland China? | Notes |
|---|---|---|---|---|---|---|
| **Firecrawl** (modsearch default) | REST API + hosted MCP | Keyless: 1,000 credits/mo "every developer", capped **per IP per day** by both a request and a credit cap (numbers unpublished). Free key: 1,000 credits/mo, no card | No | No (keyless); free key optional | ✅ probed: `mcp.firecrawl.dev/v2/mcp` HTTP 200, real tool list | Already the user's engine. Public MCP exposes only Search/Scrape/Parse keyless. **This machine is currently 429-ing on it** (see Observations). [pricing](https://www.firecrawl.dev/pricing) · [keyless launch](https://www.firecrawl.dev/blog/firecrawl-keyless-launch) · [rate limits](https://docs.firecrawl.dev/rate-limits) |
| **Tavily** | REST API + remote MCP | 1,000 credits/mo, resets on the 1st | **No** | Keyless mode needs none (`X-Tavily-Access-Mode: keyless`); keyed = 1,000/mo; `/crawl`,`/map`,`/research` need a key | ✅ probed: keyless `POST /search` HTTP 200 with real results; `mcp.tavily.com/mcp/` HTTP 200 | Keyless responses are schema-identical to keyed. [pricing](https://www.tavily.com/pricing) · [keyless](https://docs.tavily.com/documentation/keyless) · [MCP](https://docs.tavily.com/documentation/mcp) |
| **Exa** | REST API + hosted MCP | $20 credits on signup + **$10 recurring monthly** (~1,400–2,800 searches); hosted MCP has a **keyless** mode | No ("No payment method required") | No for keyless MCP; key for full quota | ✅ probed: `mcp.exa.ai/mcp` `web_search_exa` HTTP 200, returned real DeepSeek-Harness results **with no key** | Strongest keyless find. Keyless/anon uses Exa's free rate limits; 429 → sign in with OAuth or add key. `agent_run` is OAuth/key-only. [pricing](https://exa.ai/pricing) · [MCP docs](https://exa.ai/docs/get-started/exa-mcp) |
| **Parallel AI** — Search MCP | Hosted MCP | **Free, no API key** (rate-limited; numbers unpublished) | No | No | ✅ probed: `https://search.parallel.ai/mcp` HTTP 200, `web_search` tool | "The Search MCP is free to use — no API key required." `basic` mode. OAuth variant at `/mcp-oauth`; Task MCP needs a key. Paid API from $1/1k. [MCP quickstart](https://docs.parallel.ai/integrations/mcp/quickstart) · [pricing](https://docs.parallel.ai/getting-started/pricing) |
| **Brave Search API** | REST API + MCP | $5 of credits **every month** (~1,000 requests at $5/1k). The old 2,000-free-queries tier is gone | Not stated | Yes | ⚠️ not probed | Card-free signup unverified. [API page](https://brave.com/search/api/) · [MCP server](https://github.com/brave/brave-search-mcp-server) |
| **TinyFish** | REST API + MCP | Search **free** 30 req/min · 500/hour; Fetch free 150/min · 1,000/day; $8 wallet on signup | **No** | **Yes** (`X-API-Key`) | ✅ probed: `api.search.tinyfish.ai` HTTP 401 `MISSING_API_KEY` (host reachable, key needed) | MCP at `https://agent.tinyfish.ai/mcp` uses OAuth (probed: 401 "Valid OAuth Bearer token required"). Search stays free at $0 wallet. [pricing](https://www.tinyfish.ai/pricing) · [free announcement](https://www.tinyfish.ai/blog/search-and-fetch-are-now-free-for-every-agent-everywhere) |
| **DuckDuckGo** — `duckduckgo-mcp-server` (npm) | MCP server (stdio) | Self-imposed 1 req/s, 15,000 req/mo; DDG itself is unofficial | No | No | ✅ DDG endpoints reachable (`lite.duckduckgo.com` HTTP 202) | Unofficial scrape/API; ToS-fragile; package last published 2025-04. [npm](https://www.npmjs.com/package/duckduckgo-mcp-server) |
| **DuckDuckGo** — `ddgs` (PyPI, ex-`duckduckgo_search`) | Python library | None documented | No | No | ⚠️ | Widely used behind Open WebUI etc.; same ToS fragility. |
| **SearXNG** — `mcp-searxng` (npm) | MCP server (stdio/HTTP) + self-host | Unlimited **if self-hosted** | No | No (needs a SearXNG instance) | ✅/❌ **Public instances mostly fail**: `searx.be` returned a JS browser-check page, `priv.au` HTTP 429; self-host = ✅ works locally | Needs a SearXNG with `format: json` enabled. Public instances are unreliable/captcha-guarded — self-host is the real answer. [npm](https://www.npmjs.com/package/mcp-searxng) · [SearXNG search API](https://docs.searxng.org/dev/search_api.html) |
| **Jina AI** — Reader `r.jina.ai` | REST API + `mcp.jina.ai` | 20 RPM per IP with **no key** (keyed free: 500 RPM) | No | No for Reader | ✅ probed: `r.jina.ai` HTTP 200, real markdown | Best free keyless **page fetch**, not search. [rate limits](https://jina.ai/api-dashboard/rate-limit) · [reader](https://jina.ai/reader/) |
| **Jina AI** — Search `s.jina.ai` | REST API | **No keyless tier** — "block" without a key; free key = 100 RPM | No | Yes | ⚠️ | Search side is key-only. Same rate-limit table. |
| **博查 Bocha** | REST API (+ MCP mentioned in its wiki, endpoint unverified) | **1,000 calls free trial, valid 3 months**; Tier 0 (¥0 deposited) still allows 1 QPS / 30 QPM / **1,000 QPD** | No | Yes (Bearer) | ✅ host reachable (`api.bochaai.com` HTTP 401 without key, 59 ms RTT) | ¥0.036/call after. China-native, fast, high-quality Chinese results. [platform](https://open.bochaai.com/) · [pricing](https://bocha-ai.feishu.cn/wiki/JYSbwzdPIiFnz4kDYPXcHSDrnZb) |
| **智谱 GLM Web Search** | REST API + official remote MCP | **Not free** — Search-Std ¥0.01/call, Search-Pro ¥0.03, Sogou/Quark ¥0.05. New-account token packs (e.g. 20M tokens) are model tokens, not search calls | No | Yes | ✅ `open.bigmodel.cn/api/mcp-broker/proxy/web-search/mcp` HTTP 200 (needs `Authorization`) | Cheapest paid Chinese option; aggregates 搜狗/夸克. [web search](https://docs.bigmodel.cn/cn/guide/tools/web-search) · [pricing](https://docs.bigmodel.cn/cn/guide/start/pricing) |
| **火山引擎 豆包搜索** (Volcengine Ark) | REST API (tool use) | `web_search` ¥0.02/call; `web_fetch` limited-time free. **Beta 联网搜索's monthly free quota ended 2026-07-01** | No | Yes | ⚠️ | Subscription + activation required. [Ark model pricing](https://www.volcengine.com/docs/82379/1544106) · [豆包搜索](https://www.volcengine.com/docs/82379/2309827) |
| **阿里云百炼** web_search | REST API, **Responses API only** (also `enable_search` on legacy generation; `web_extractor`) | New-user model free quota only, **90 days, Beijing region only**; web-search tool calls are not a free tier | No | Yes (`DASHSCOPE_API_KEY`) | ⚠️ | Confirmed it is Responses-API `{"type":"web_search"}` / `enable_search`, not a standalone search endpoint. [web search](https://help.aliyun.com/zh/model-studio/web-search) · [free quota](https://help.aliyun.com/zh/model-studio/new-free-quota) |
| **秘塔 Metaso / 360** | REST API | Not verified | — | Yes | ⚠️ | **Could not verify** official free tiers — treat as unknown. |
| **Bing Search API** | — | — | — | — | — | **Retired 2025-08-11.** Do not plan around it. [Firecrawl summary](https://www.firecrawl.dev/blog/bing-search-api-alternatives) |
| **Google Programmable Search (Custom Search JSON API)** | REST API | 100 queries/day — but **closed to new customers**; existing customers must migrate by **2027-01-01** | No | Yes | ⚠️ (Google is normally blocked in CN) | Effectively not an option for a new user. [overview](https://developers.google.com/custom-search/v1/overview) |
| **Perplexity Sonar / Agent API** | REST API + remote MCP (`https://api.perplexity.ai/mcp`, OAuth or key) | **No free tier** — pay per request (Search API $5/1k; `web_search` tool $0.0025/call) | Yes (billing) | Yes | ✅ `api.perplexity.ai/mcp` HTTP 401 with a clear invalid-key JSON (host reachable) | MCP sign-in still requires an API org that can pay. [pricing](https://docs.perplexity.ai/docs/getting-started/pricing) · [MCP](https://docs.perplexity.ai/docs/getting-started/integrations/mcp-server) |
| **Whoogle** | Self-host | n/a | No | No | n/a | **Dead.** Project's final release v1.2.3; no longer returns search results / unmaintained as of April 2026. [repo](https://github.com/benbusby/whoogle-search) |
| **4get / LibreY** | Self-host (PHP) | n/a | No | No | n/a | Scraper front-ends; **not verified** as maintained/working in 2026 — treat as uncertain. |

## Observations from this machine (live probes)

1. `~/.modsearch/config.json` **already has a Firecrawl API key** (`C:\Users\xiaoh\.modsearch\config.json`, mode 666).
   `modsearch doctor` shows search+fetch resolving to `firecrawl`, and **tavily / exa / antigravity-cli / grok-cli are all "not set"**.
2. That single channel is why tool calls in this session repeatedly return
   `firecrawl returned 429 Too Many Requests ... Consumed (req/min): 11-13`, even while the keyless
   endpoints still answer (my raw probes to `mcp.firecrawl.dev` and `api.tavily.com` succeeded in the
   same minutes). **The engine chain has no working fallback configured.**
3. Network egress looks excellent from this box: 0.05–2.6 s to Bocha (CN), Tavily, Exa, Firecrawl, Parallel, Jina, Perplexity, DDG.
4. ~~`dsh` itself: I grepped the installed web-app bundle for `mcpServers` / MCP client code and found
   **no MCP client support**.~~
   **CORRECTION (verified by the parent agent, 2026-09-17): dsh DOES ship an MCP client.**
   The bridge is the in-box plugin `@deepseek-ai/dsh-mcp-client`; `dsh-computer-use-win` already uses it
   (`cordis.patch.yml` inserts `name: '@deepseek-ai/dsh-mcp-client'` with `transport: stdio`), and the
   model in this very session sees its tools as `mcp__wincu__*`. Config surface: one `insert:` row per
   server with `transport: stdio | streamable-http`, `command`/`args`/`env` or `url`/`headers`,
   `toolCallTimeoutMs`, `failOnStartupError`. So arbitrary **search MCP servers are a real option for dsh**
   — the earlier "no MCP client" line was an artifact of grepping a minified bundle.

## Top 3 recommendations for this user

### 1. Fix the 429 by adding the two best card-free keys to modsearch (highest value, 2 minutes)
Keeps one engine chain with automatic failover, and both quotas are card-free.

```bash
# Tavily: 1,000 credits/month, no credit card — key from https://app.tavily.com
modsearch config set tavily.apiKey tvly-XXXX

# Exa: $20 signup + $10 every month, no payment method — key from https://dashboard.exa.ai/api-keys
modsearch config set exa.apiKey XXXX

# optional: stop cloud page-fetch from burning Firecrawl credits
modsearch config set firecrawl.keylessFetch false

modsearch doctor     # expect: firecrawl READY, tavily READY, exa READY
```
`~/.modsearch/config.json` equivalent:
```json
{
  "engines": {
    "firecrawl": { "apiKey": "fc-XXXX", "keylessFetch": false },
    "tavily":    { "apiKey": "tvly-XXXX" },
    "exa":       { "apiKey": "XXXX" }
  }
}
```
Also available in the GUI: **Settings → Plugins → Plugin config → ModSearch card**.
(Env vars `TAVILY_API_KEY` / `EXA_API_KEY` / `FIRECRAWL_API_KEY` win over the file.
Any Tavily/Exa-compatible gateway or reseller can be pointed at with
`modsearch config set tavily.baseURL https://...` — useful if a U.S. endpoint ever becomes unreliable.)

### 2. Free keyless MCP fallbacks (no key, no card) — for any MCP-capable client
These three answered real queries in my probes with **zero credentials**:

```json
{
  "mcpServers": {
    "exa":      { "url": "https://mcp.exa.ai/mcp" },
    "parallel": { "url": "https://search.parallel.ai/mcp" },
    "tavily-keyless": {
      "url": "https://mcp.tavily.com/mcp/",
      "headers": { "X-Tavily-Access-Mode": "keyless" }
    }
  }
}
```
- Exa keyless: `https://mcp.exa.ai/mcp` (tools `web_search_exa`, `web_fetch_exa`; add `?tools=...` to extend).
- Parallel Search: `https://search.parallel.ai/mcp` (tool `web_search`).
- Tavily keyless: URL + header **is** mandatory; clients that accept only a bare URL cannot use it keyless.
- Firecrawl keyless (already wired): `https://mcp.firecrawl.dev/v2/mcp`.
For stdio-only clients, wrap any remote with `npx -y mcp-remote <URL>`.
**Caveat (corrected):** dsh **can** host these — insert one `@deepseek-ai/dsh-mcp-client` row per server in the
profile's `cordis.patch.yml` (see item 4). Note the naming there is dsh-native (`transport`/`command`/`args`/`env`
or `url`/`headers`), not the Claude-style `mcpServers` JSON shown above. Caveat that still applies: these tools
arrive as `mcp__<name>__<tool>` alongside the native `web_search`, so they add tool-definition tokens and do not
replace the built-in tool's citation UI.

### 3. Self-hosted SearXNG + `mcp-searxng` — the only genuinely unlimited keyless option
Public SearXNG instances failed my probes (captcha page on `searx.be`, 429 on `priv.au`), so self-host:

```bash
# SearXNG (Docker), JSON API enabled
docker run -d --name searxng -p 8080:8080 \
  -v searxng-data:/etc/searxng searxng/searxng
# then set in searxng/settings.yml:  search: { formats: [html, json] }

# MCP server
npx -y mcp-searxng
```
```json
{
  "mcpServers": {
    "searxng": {
      "command": "npx",
      "args": ["-y", "mcp-searxng"],
      "env": { "SEARXNG_URL": "http://localhost:8080" }
    }
  }
}
```
Zero keys, zero quota, no third-party data disclosure — at the cost of running Docker and
your own outbound scraping (which is exactly what gets public instances captcha'd).

### Honourable mentions
- **TinyFish** — genuinely free Search (30/min) + Fetch, **no card**, but signup + `X-API-Key` is required.
  MCP: `{ "mcpServers": { "tinyfish": { "url": "https://agent.tinyfish.ai/mcp" } } }` (OAuth).
- **Jina Reader** — keyless free page fetch (20 RPM/IP): `curl https://r.jina.ai/https://example.com`.
  Its *search* endpoint `s.jina.ai` has no keyless tier.
- **博查 Bocha** — China-native, 1,000 free calls (3-month validity) then ¥0.036/call; the best
  Chinese-web quality per yuan if the above run dry.
- **Skip**: Bing (retired), Google CSE (closed to new customers, dies 2027-01), Perplexity (no free tier), Whoogle (dead).

## Uncertainty flags
- Mainland-China reachability: probed successfully for Firecrawl, Tavily, Exa, Parallel, Jina, DDG,
  Perplexity, Bocha. **Brave, Zhipu web-search API, Volcengine, Aliyun, 秘塔/360 were not probed.**
  Direct reachability observed here may reflect a TUN VPN invisible to my env-var check.
- Exa keyless MCP rate limits: not published; I observed a successful unauthenticated call, not a ceiling.
- Firecrawl keyless daily request/credit numbers: explicitly unpublished per its own docs.
- Bocha's MCP server exists in its doc index, but I could not retrieve the endpoint (Feishu anti-scrape);
  no working MCP URL found — use the REST API `https://api.bochaai.com/v1/web-search`.
- Parallel AI free keyless rate limits: not published.
- 4get / LibreY: not verified.
- dsh MCP support: **RESOLVED — supported** via the in-box `@deepseek-ai/dsh-mcp-client` bridge (see item 4).
- SearXNG public instances: confirmed failing from this box (429 / browser-check / non-JSON) by the parent
  agent running the engines' own code — so `searxng` must not be the only free engine in a chain.

## Addendum — what was actually changed (parent agent, 2026-09-17)
The user chose to **replace** modsearch rather than add keys:
- Installed `dsh-free-search@0.4.28` into profile `web` and removed `@liustack/modsearch` (dependency,
  `dsh.profile.bundles`, `minimumReleaseAgeExclude`, `plugin-track.json`, and the fallback list in `update-dsh.ps1`).
- Composed config now: `web.searchProvider: ddg` + `web.fetchProvider: http`, row `web-search-free` present.
- Live engine probe of the installed plugin code (no DSH boot): `bing`, `ddg-html`, `ddg-lite`, `anysearch`,
  `tavily-keyless` all returned 3 real sources; `searxng` public instances failed.

