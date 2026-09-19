/**
 * dsh-pet-perlica — host half (fused).
 *
 * Combines:
 *  1. the full DSH session-activity projection (from @linxin666/dsh-pet,
 *     itself a Codex 9-row replica): both `activity/status` events and the
 *     official session event vocabulary (turn/start, assistant/chunk,
 *     tool/call, turn/end, ...) map onto the pet's visual phases and lines;
 *  2. the DeepSeek balance + session usage/cost service (from Suiwan/whale-purse,
 *     MIT): official Get User Balance query with cache/dedup, per-session
 *     token-usage cost with official pricing (auto-refreshed from the pricing
 *     page, peak-hour aware).
 *
 * Serves:
 *   GET /api/dsh-pet-perlica/state            -> { animation, phaseLine, size }
 *   GET /api/dsh-pet-perlica/balance          -> cached balance view
 *   GET /api/dsh-pet-perlica/balance/refresh  -> force refresh balance
 *   GET /api/dsh-pet-perlica/cost             -> per-provider cost of the last active
 *                                              session: official DeepSeek (CNY) +
 *                                              SCNet Token Plan (Credits)
 *
 * Zero-dependency pure ESM cordis plugin, mounted through the profile's
 * cordis.patch.yml insert (name: 'dsh-pet-perlica').
 * @module dsh-pet-perlica
 */

/** Plugin name: matches cordis.patch.yml insert.name and the client bundle id. */
export const name = 'dsh-pet-perlica'

/** Required services (Loader resolves them before apply). */
export const inject = ['webServer']

// ---------------------------------------------------------------------------
// Phase projection (ported from @linxin666/dsh-pet, Apache-2.0)
// ---------------------------------------------------------------------------

/** Map the DSH activity phase vocabulary onto 9-row sprite tracks. */
const PHASE_TO_ANIMATION = {
  idle: 'idle',
  waiting: 'waiting',
  thinking: 'running',
  tool: 'running-right',
  review: 'review',
  done: 'jumping',
  failed: 'failed',
}

/** Fresh projection runtime for a newly seen session. */
function emptyProjectionRuntime() {
  return { activeTools: new Set(), stepHadFailure: false }
}

/** Keep tool names readable inside the compact status bubble. */
function displayToolName(name) {
  const compact = String(name).replace(/\s+/g, ' ').trim() || '工具'
  return compact.length <= 24 ? compact : `${compact.slice(0, 21)}...`
}

/** Whether a phase is part of the pet's supported vocabulary. */
function isActivityPhase(phase) {
  return ['idle', 'waiting', 'thinking', 'tool', 'review', 'done', 'failed'].includes(phase)
}

/**
 * Project the durable DSH session vocabulary into the pet's visual phases.
 * Unknown and log-only events do not disturb the last meaningful activity.
 */
function projectOfficialEvent(event, runtime) {
  switch (event.type) {
    case 'turn/start':
      runtime.activeTools.clear()
      runtime.stepHadFailure = false
      return { input: { phase: 'waiting', line: '准备开始' } }
    case 'step/start':
      runtime.activeTools.clear()
      runtime.stepHadFailure = false
      return { input: { phase: 'waiting', line: '等待模型响应' } }
    case 'assistant/chunk': {
      const chunk = event.data?.chunk
      if (chunk?.type === 'reasoning-delta' && chunk.text.length > 0) {
        return { input: { phase: 'thinking', line: '正在思考' } }
      }
      if (chunk?.type === 'text-delta' && chunk.text.length > 0) {
        return { input: { phase: 'review', line: '整理回复中' } }
      }
      return undefined
    }
    case 'assistant/message':
      return { input: { phase: 'review', line: '整理回复中' } }
    case 'tool/call': {
      runtime.activeTools.add(String(event.data?.callId))
      return { input: { phase: 'tool', line: `正在使用 ${displayToolName(event.data?.name)}` } }
    }
    case 'tool/result': {
      const data = event.data ?? {}
      const content = data.message?.content
      const block = Array.isArray(content) ? content[0] : content
      runtime.activeTools.delete(String(data.message?.source?.callId))
      runtime.stepHadFailure ||= data.error !== undefined || block?.isError === true
      if (runtime.activeTools.size > 0) {
        return { input: { phase: 'tool', line: `还有 ${runtime.activeTools.size} 个工具运行中` } }
      }
      return runtime.stepHadFailure
        ? { input: { phase: 'failed', line: '工具执行失败' } }
        : { input: { phase: 'thinking', line: '处理工具结果' } }
    }
    case 'turn/end': {
      runtime.activeTools.clear()
      const reason = event.data?.reason?.kind
      switch (reason) {
        case 'completed':
          return { input: { phase: 'done', line: '完成啦' } }
        case 'error':
          return { input: { phase: 'failed', line: '执行失败' } }
        case 'max-tokens':
          return { input: { phase: 'failed', line: '达到输出上限' } }
        case 'interrupted':
          return { input: { phase: 'failed', line: '执行意外中断' } }
        case 'blocked':
          return { input: { phase: 'waiting', line: '等待继续' } }
        case 'aborted':
          return { input: { phase: 'idle', line: '已停止' } }
        default:
          return { input: { phase: 'idle', line: '' } }
      }
    }
    default:
      return undefined
  }
}

// ---------------------------------------------------------------------------
// Balance + cost service (ported from Suiwan/whale-purse, MIT)
// ---------------------------------------------------------------------------

const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_REFRESH_INTERVAL_SECONDS = 30
const DEFAULT_PRICING_REFRESH_HOURS = 6
const PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'
const PEAK_PRICING_START_MS = Date.UTC(2026, 7, 16, 16, 0, 0)
const MAX_BASE_URL_LENGTH = 256

/** Fallback flat pricing = 空闲时段 official rate: CNY per million tokens. */
const CURRENT_PRESETS = {
  flash: { cacheRead: 0.02, input: 1, output: 4 },
  pro: { cacheRead: 0.15, input: 4.5, output: 13.5 },
}

/** Fallback peak/off-peak pricing (official, 2026-09); off-peak is half of peak. */
const PEAK_PRESETS = {
  flash: {
    offPeak: { cacheRead: 0.02, input: 1, output: 4 },
    peak: { cacheRead: 0.04, input: 2, output: 8 },
  },
  pro: {
    offPeak: { cacheRead: 0.15, input: 4.5, output: 13.5 },
    peak: { cacheRead: 0.3, input: 9.0, output: 27.0 },
  },
}

/**
 * Provider ids routed to each billing bucket. The native DeepSeek adapter
 * registers `deepseek-official` (older compositions used `deepseek`), so any
 * id containing "deepseek" prices as the official route; SCNet Token Plan
 * routes through `supercompute`.
 */
const SCNET_PROVIDER = 'supercompute'

/** Whether a request-header provider id bills as official DeepSeek (CNY). */
function isOfficialProvider(provider) {
  return provider.includes('deepseek')
}

/**
 * SCNet Token Plan per-model rates: Credits per million tokens, from the
 * official Token Plan page (2026-08). Keys are lowercase DSH model ids.
 */
const SCNET_RATES = {
  'deepseek-v4-flash-0731': { input: 1543, output: 3086, cacheRead: 31 },
  'deepseek-v4-flash': { input: 1200, output: 2400, cacheRead: 24 },
  'deepseek-v4-pro': { input: 10286, output: 20571, cacheRead: 86 },
  'glm-5.2': { input: 7543, output: 26400, cacheRead: 189 },
  'glm-5.1': { input: 8743, output: 32057, cacheRead: 175 },
  'glm-5': { input: 8743, output: 32057, cacheRead: 175 },
  'kimi-k3': { input: 34286, output: 171429, cacheRead: 343 },
  'kimi-k2.7-code': { input: 8357, output: 34714, cacheRead: 167 },
  'kimi-k2.6': { input: 8357, output: 34714, cacheRead: 167 },
  'kimi-k2.5': { input: 5143, output: 27000, cacheRead: 103 },
  'minimax-m3': { input: 3600, output: 14400, cacheRead: 72 },
  'minimax-m2.7': { input: 3600, output: 14400, cacheRead: 72 },
  'minimax-m2.5': { input: 2520, output: 10080, cacheRead: 50 },
  'qwen3.8-max': { input: 18514, output: 49371, cacheRead: 231 },
}

/** Rate for models absent from {@link SCNET_RATES} (the configured DeepSeek-V4-Flash-0731). */
const SCNET_FALLBACK_RATE = SCNET_RATES['deepseek-v4-flash-0731']

/** Map a DeepSeek official model id to its pricing family. */
function officialFamily(model) {
  const id = String(model).toLowerCase()
  return id.includes('pro') || id.includes('reasoner') ? 'pro' : 'flash'
}

/**
 * Fold one session's durable log into per-provider, per-model token buckets.
 * Each step runs one model call: its usage is attributed to the provider/model
 * of the `request/header` that opened the step.
 */
function foldProviderUsage(session) {
  const buckets = { official: {}, supercompute: {} }
  let current
  // dsh-session 的 Session 不暴露 .events（事件列表走 snapshotEvents()）；
  // 兼容旧形态的 session.events，两者皆缺则视为空会话（不抛异常）。
  const events = Array.isArray(session?.events)
    ? session.events
    : typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : []
  for (const event of events) {
    if (event.type === 'request/header') {
      const config = event.data.header?.config
      current = { provider: String(config?.provider ?? ''), model: String(config?.model ?? '') }
      continue
    }
    if (event.type !== 'assistant/message') continue
    const usage = event.data.usage
    if (usage === undefined || current === undefined) continue
    const target = current.provider === SCNET_PROVIDER
      ? buckets.supercompute
      : isOfficialProvider(current.provider) ? buckets.official : undefined
    if (target === undefined) continue
    const row = target[current.model] ?? (target[current.model] = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
    row.input += Number(usage.inputTokens) || 0
    row.cacheRead += Number(usage.cacheReadTokens) || 0
    row.cacheWrite += Number(usage.cacheWriteTokens) || 0
    row.output += Number(usage.outputTokens) || 0
  }
  return buckets
}

const PRICE_RE = /(\d+(?:\.\d+)?)\s*元/
const MODEL_RE = /deepseek-v4-(flash|pro)\s+空闲时段\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+高峰时段\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元/gi

/**
 * Whether the current Beijing time is a peak hour. Official policy: peak is
 * Mon-Fri 09:00-12:00 and 14:00-18:00; weekends are off-peak all day.
 */
function isPeakHour(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(now)
  const weekday = parts.find((p) => p.type === 'weekday')?.value
  if (weekday === 'Sat' || weekday === 'Sun') return false
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  if (Number.isNaN(hour)) return false
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function parsePriceCell(text) {
  const match = PRICE_RE.exec(text)
  if (match === null) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

function parseCurrentTable(html) {
  const text = stripHtml(html)
  const hit = /百万tokens输入（缓存命中）([\s\S]{0,400}?)百万tokens输入（缓存未命中）[\s\S]{0,400}?百万tokens输出([\s\S]{0,400}?)(?:并发限制|$)/i.exec(text)
  if (hit === null) return undefined
  const cacheReadFlash = parsePriceCell(hit[1])
  const inputFlash = parsePriceCell(hit[2])
  const outputFlash = parsePriceCell(hit[3])
  if (cacheReadFlash === undefined || inputFlash === undefined || outputFlash === undefined) return undefined
  const second = (cell) => parsePriceCell(cell.replace(/^\s*(\d+(?:\.\d+)?)元/, ''))
  return {
    flash: { cacheRead: cacheReadFlash, input: inputFlash, output: outputFlash },
    pro: {
      cacheRead: second(hit[1]) ?? cacheReadFlash,
      input: second(hit[2]) ?? inputFlash,
      output: second(hit[3]) ?? outputFlash,
    },
  }
}

function parsePeakTable(html) {
  const text = stripHtml(html)
  const result = {}
  for (const match of text.matchAll(MODEL_RE)) {
    result[match[1]] = {
      offPeak: { cacheRead: Number(match[2]), input: Number(match[3]), output: Number(match[4]) },
      peak: { cacheRead: Number(match[5]), input: Number(match[6]), output: Number(match[7]) },
    }
  }
  return result
}

/**
 * Parse the 2026-09 pricing layout: each metric row carries 空闲时段 and
 * 高峰时段 cells, with one column per family (flash first, then pro). Returns
 * `{ current, peak }` where `current` is the 空闲时段 table, or undefined when
 * the layout is not recognized.
 */
function parsePricingTable(html) {
  const text = stripHtml(html)
  const m = /百万tokens输入\s*（缓存命中）\s*空闲时段\s*([\d.]+)元\s*([\d.]+)元\s*高峰时段\s*([\d.]+)元\s*([\d.]+)元[\s\S]{0,200}?百万tokens输入\s*（缓存未命中）\s*空闲时段\s*([\d.]+)元\s*([\d.]+)元\s*高峰时段\s*([\d.]+)元\s*([\d.]+)元[\s\S]{0,200}?百万tokens输出\s*空闲时段\s*([\d.]+)元\s*([\d.]+)元\s*高峰时段\s*([\d.]+)元\s*([\d.]+)元/.exec(text)
  if (m === null) return undefined
  const n = (i) => Number(m[i])
  const offFlash = { cacheRead: n(1), input: n(5), output: n(9) }
  const offPro = { cacheRead: n(2), input: n(6), output: n(10) }
  const peakFlash = { cacheRead: n(3), input: n(7), output: n(11) }
  const peakPro = { cacheRead: n(4), input: n(8), output: n(12) }
  const valid = (p) => Object.values(p).every((v) => Number.isFinite(v) && v > 0)
  if (!valid(offFlash) || !valid(peakFlash) || !valid(offPro) || !valid(peakPro)) return undefined
  return {
    current: { flash: offFlash, pro: offPro },
    peak: {
      flash: { offPeak: offFlash, peak: peakFlash },
      pro: { offPeak: offPro, peak: peakPro },
    },
  }
}

async function fetchPricing(fetchImpl = globalThis.fetch, timeoutMs = 15_000) {
  const fetchedAt = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetchImpl(PRICING_URL, { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) return { fetchedAt, error: `pricing page HTTP ${response.status}` }
    const html = await response.text()
    const parsed = parsePricingTable(html)
    if (parsed !== undefined) return { fetchedAt, current: parsed.current, peak: parsed.peak }
    // 旧版页面布局兜底（页面若回退仍可用）
    const current = parseCurrentTable(html)
    if (current === undefined) return { fetchedAt, error: 'pricing table not found' }
    const peak = parsePeakTable(html)
    return { fetchedAt, current, ...(peak === undefined ? {} : { peak }) }
  } catch (error) {
    return { fetchedAt, error: friendlyError(error, '定价页获取') }
  }
}

function parseBaseUrl(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`dsh-pet-perlica: invalid baseUrl "${raw}"`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`dsh-pet-perlica: baseUrl must be http(s), got "${url.protocol}"`)
  }
  return { origin: url.origin, prefix: url.pathname.replace(/\/+$/, '') }
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max)}..`
}

function friendlyError(error, label) {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  if (name === 'AbortError' || /abort/i.test(message)) return `${label}（请求超时）`
  return message || `${label}失败`
}

function costOfTokens(count, perMillion) {
  if (count <= 0 || !Number.isFinite(count)) return 0
  return (count / 1_000_000) * perMillion
}

class BalanceService {
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.apiKeyEnv = config.apiKeyEnv ?? DEFAULT_API_KEY_ENV
    this.baseUrl = String(config.baseUrl ?? DEFAULT_BASE_URL).slice(0, MAX_BASE_URL_LENGTH)
    this.refreshIntervalMs = Math.max(0, (config.refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS) * 1_000)
    this.model = config.model === 'pro' ? 'pro' : 'flash'
    this.enabled = config.enabled ?? true
    this.cached = undefined
    this.cachedAt = 0
    this.inflight = undefined
    this.pricingSnapshot = { fetchedAt: Date.now(), current: CURRENT_PRESETS, peak: PEAK_PRESETS }
    this.pricingTimer = undefined
    void this.refreshPricing()
    const cadenceMs = (config.pricingRefreshHours ?? DEFAULT_PRICING_REFRESH_HOURS) * 3_600_000
    this.pricingTimer = setInterval(() => { void this.refreshPricing() }, cadenceMs)
    this.pricingTimer.unref?.()
  }

  dispose() {
    clearInterval(this.pricingTimer)
    this.pricingTimer = undefined
  }

  effectivePrices(family = this.model) {
    const key = family === 'pro' ? 'pro' : 'flash'
    const snapshot = this.pricingSnapshot ?? { current: CURRENT_PRESETS }
    const current = snapshot.current?.[key] ?? CURRENT_PRESETS[key]
    const peak = snapshot.peak?.[key]
    if (peak !== undefined && Date.now() >= PEAK_PRICING_START_MS) {
      const inPeak = isPeakHour()
      const band = inPeak ? peak.peak : peak.offPeak
      return { ...band, band: inPeak ? 'peak' : 'off-peak' }
    }
    return { ...current, band: 'standard' }
  }

  async view() {
    if (!this.enabled) return { fetchedAt: Date.now(), available: false, balances: [], error: 'disabled' }
    const now = Date.now()
    if (this.cached !== undefined && now - this.cachedAt < this.refreshIntervalMs && this.refreshIntervalMs > 0) {
      return this.cached
    }
    if (this.inflight !== undefined) return this.inflight
    this.inflight = this.query().then((view) => {
      this.cached = view
      this.cachedAt = Date.now()
      return view
    }).finally(() => {
      this.inflight = undefined
    })
    return this.inflight
  }

  async refresh() {
    const view = await this.query()
    this.cached = view
    this.cachedAt = Date.now()
    return view
  }

  async refreshPricing() {
    const snapshot = await fetchPricing()
    if (snapshot.current !== undefined) this.pricingSnapshot = snapshot
    else this.pricingSnapshot = { fetchedAt: snapshot.fetchedAt, current: CURRENT_PRESETS, peak: PEAK_PRESETS, error: snapshot.error }
  }

  /**
   * Price the last active session split by provider: official DeepSeek is
   * billed in CNY (flash/pro pricing, auto-refreshed from the pricing page),
   * SCNet Token Plan in Credits (official per-model rate table). Every model
   * call is attributed to the provider/model of the `request/header` that
   * opened its step, so mixed sessions price each side independently.
   */
  sessionCost(session) {
    const { official, supercompute } = foldProviderUsage(session)
    const officialCost = this.officialCost(official)
    const scnetCost = this.scnetCost(supercompute)
    return {
      official: { ...officialCost, present: Object.keys(official).length > 0 },
      supercompute: { ...scnetCost, present: Object.keys(supercompute).length > 0 },
      tokens: {
        input: officialCost.tokens.input + scnetCost.tokens.input,
        cacheRead: officialCost.tokens.cacheRead + scnetCost.tokens.cacheRead,
        cacheWrite: officialCost.tokens.cacheWrite + scnetCost.tokens.cacheWrite,
        output: officialCost.tokens.output + scnetCost.tokens.output,
      },
    }
  }

  /** Price official DeepSeek buckets (CNY) via the auto-refreshed pricing page. */
  officialCost(byModel) {
    let cost = 0
    let model = this.model
    let band = 'standard'
    let prices = this.effectivePrices()
    const breakdown = {}
    const tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
    for (const [id, t] of Object.entries(byModel)) {
      model = id
      prices = this.effectivePrices(officialFamily(id))
      band = prices.band
      const input = costOfTokens(t.input, prices.input)
      const cacheRead = costOfTokens(t.cacheRead, prices.cacheRead)
      const output = costOfTokens(t.output, prices.output)
      cost += input + cacheRead + output
      breakdown[id] = { input, cacheRead, output }
      tokens.input += t.input
      tokens.cacheRead += t.cacheRead
      tokens.cacheWrite += t.cacheWrite
      tokens.output += t.output
    }
    return {
      cost,
      currency: 'CNY',
      model,
      band,
      breakdown,
      tokens,
      pricing: {
        model: officialFamily(model),
        cacheReadPerMillion: prices.cacheRead,
        inputPerMillion: prices.input,
        outputPerMillion: prices.output,
        band,
        peakPricingActive: Date.now() >= PEAK_PRICING_START_MS,
      },
    }
  }

  /** Price SCNet Token Plan buckets (Credits) via the official rate table. */
  scnetCost(byModel) {
    let credits = 0
    let model = undefined
    const unknownModels = []
    const tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
    for (const [id, t] of Object.entries(byModel)) {
      model = id
      const key = String(id).toLowerCase()
      const rate = SCNET_RATES[key] ?? SCNET_FALLBACK_RATE
      if (SCNET_RATES[key] === undefined) unknownModels.push(id)
      credits += costOfTokens(t.input, rate.input)
        + costOfTokens(t.output, rate.output)
        + costOfTokens(t.cacheRead, rate.cacheRead)
      tokens.input += t.input
      tokens.cacheRead += t.cacheRead
      tokens.cacheWrite += t.cacheWrite
      tokens.output += t.output
    }
    return { credits, model: model ?? null, unknownModels, tokens }
  }

  async query() {
    const fetchedAt = Date.now()
    const key = await this.resolveApiKey()
    if (key === undefined) {
      return {
        fetchedAt,
        available: false,
        balances: [],
        error: `no API key (store ${this.apiKeyEnv} via the credentials seam, or export it in the environment)`,
      }
    }
    try {
      const { origin, prefix } = parseBaseUrl(this.baseUrl)
      const url = `${origin}${prefix}/user/balance`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      let response
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        return {
          fetchedAt,
          available: false,
          balances: [],
          error: `Get User Balance failed: HTTP ${response.status}${body ? ` — ${truncate(body, 200)}` : ''}`,
        }
      }
      const payload = await response.json()
      const buckets = Array.isArray(payload.balance_infos)
        ? payload.balance_infos.map((b) => ({
          currency: String(b.currency ?? ''),
          total_balance: String(b.total_balance ?? '0'),
          granted_balance: String(b.granted_balance ?? '0'),
          topped_up_balance: String(b.topped_up_balance ?? '0'),
        })).filter((b) => b.currency !== '')
        : []
      const total = buckets.length === 1 ? Number(buckets[0].total_balance) : undefined
      return {
        fetchedAt,
        available: payload.is_available !== false,
        balances: buckets,
        ...(total === undefined || Number.isNaN(total) ? {} : { total, currency: buckets[0].currency }),
      }
    } catch (error) {
      return {
        fetchedAt,
        available: false,
        balances: [],
        error: friendlyError(error, '余额查询'),
      }
    }
  }

  async resolveApiKey() {
    const credentials = this.ctx.get('credentials')
    if (credentials !== undefined && typeof credentials.resolve === 'function') {
      const hit = await credentials.resolve(this.apiKeyEnv)
      if (hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0) return hit.value
    }
    const launchEnvironment = this.ctx.get('launchEnvironment')
    const ambient = launchEnvironment?.get?.(String(this.apiKeyEnv))
    if (ambient !== undefined && typeof ambient.value === 'string' && ambient.value.length > 0) return ambient.value
    const env = process.env[this.apiKeyEnv]
    if (typeof env === 'string' && env.length > 0) return env
    return undefined
  }
}

// ---------------------------------------------------------------------------
// HTTP route helpers
// ---------------------------------------------------------------------------

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function requireMethod(req, res, method) {
  if (req.method === method) return true
  json(res, 405, { ok: false, error: 'method-not-allowed' })
  return false
}

function getRoute(path, run) {
  return {
    kind: 'exact',
    path,
    handler: (req, res) => {
      if (!requireMethod(req, res, 'GET')) return
      Promise.resolve(run()).then((value) => json(res, 200, value), (error) => {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

const DEFAULT_SIZE = 160
const MIN_SIZE = 80
const MAX_SIZE = 320

/**
 * The fused plugin body: session-activity projection + balance/cost service.
 * @param ctx - the cordis context.
 * @param config - composition config (cordis.patch.yml insert config field).
 * @returns a disposer that stops listeners, routes, and timers.
 */
export function apply(ctx, config = {}) {
  const size = Number.isFinite(config.size) && config.size >= MIN_SIZE && config.size <= MAX_SIZE
    ? Math.round(config.size)
    : DEFAULT_SIZE

  const service = new BalanceService(ctx, config)
  ctx.provide('usageMeter', service)

  // Projection state: the latest phase/animation plus the last active session
  // (the session arg of every session/event), used by the cost route.
  let animation = 'idle'
  let phaseLine = ''
  let currentSession = undefined
  const runtimes = new WeakMap()

  const runtimeOf = (session) => {
    let runtime = runtimes.get(session)
    if (runtime === undefined) {
      runtime = emptyProjectionRuntime()
      runtimes.set(session, runtime)
    }
    return runtime
  }

  const onSessionEvent = (session, event) => {
    currentSession = session
    const runtime = runtimeOf(session)
    let input
    if (event.type === 'activity/status') {
      const payload = event.data ?? {}
      if (typeof payload.phase !== 'string' || !isActivityPhase(payload.phase)) return
      input = {
        phase: payload.phase,
        ...typeof payload.line === 'string' ? { line: payload.line } : {},
      }
    } else {
      const transition = projectOfficialEvent(event, runtime)
      if (transition === undefined) return
      input = transition.input
    }
    animation = PHASE_TO_ANIMATION[input.phase] ?? 'idle'
    phaseLine = typeof input.line === 'string' ? input.line : ''
  }

  const disposers = [ctx.on('session/event', onSessionEvent)]

  const routes = [
    getRoute('/api/dsh-pet-perlica/state', () => ({ animation, phaseLine, size })),
    getRoute('/api/dsh-pet-perlica/balance', () => service.view()),
    getRoute('/api/dsh-pet-perlica/balance/refresh', () => service.refresh()),
    getRoute('/api/dsh-pet-perlica/cost', () => {
      if (currentSession === undefined) return { ok: true, cost: null, note: 'no-active-session' }
      return { ok: true, ...service.sessionCost(currentSession) }
    }),
  ]
  for (const route of routes) disposers.push(ctx.webServer.register(route))

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // teardown best-effort
      }
    }
    service.dispose()
  }
}
