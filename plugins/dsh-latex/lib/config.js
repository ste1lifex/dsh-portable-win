/**
 * Configuration normalization.
 *
 * The cordis loader hands `apply()` whatever the patch entry declared, so every
 * field is optional and defensively coerced. No schema library is involved:
 * the plugin must load even when the harness' own packages are only reachable
 * through {@link ./dsh-runtime.js}.
 */

/** Default per-call deadline; a full TikZ/PGFPlots document can legitimately take minutes. */
const DEFAULT_TIMEOUT_MS = 180_000;
/** Hard ceiling for a model-supplied `timeout_ms`, so a call cannot pin a worker forever. */
const MAX_TIMEOUT_MS = 900_000;
/** Largest inline `.tex` source accepted, in bytes. */
const DEFAULT_MAX_SOURCE_BYTES = 2_000_000;
/** Largest engine output echoed back to the model, in characters. */
const DEFAULT_MAX_OUTPUT_CHARS = 20_000;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveInteger(value, fallback) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(entry => typeof entry === 'string' && entry.length > 0);
}

/**
 * Normalize the loader entry into the shape the engine and tools consume.
 *
 * @param {unknown} raw config object from `cordis.patch.yml`
 * @returns {{
 *   enginePath?: string,
 *   runtimeDir?: string,
 *   cacheDir?: string,
 *   bundle?: string,
 *   offline: boolean,
 *   untrusted: boolean,
 *   allowShellEscape: boolean,
 *   keepIntermediates: boolean,
 *   allowWorkspaceFiles: boolean,
 *   allowedLocalRoots: string[],
 *   defaultTimeoutMs: number,
 *   maxTimeoutMs: number,
 *   maxSourceBytes: number,
 *   maxOutputChars: number,
 *   debug: boolean
 * }}
 */
export function resolveConfig(raw) {
  const config = raw !== null && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const text = value => (typeof value === 'string' && value.trim().length > 0 ? value : undefined);
  return {
    enginePath: text(config.enginePath),
    runtimeDir: text(config.runtimeDir),
    cacheDir: text(config.cacheDir),
    bundle: text(config.bundle),
    // Cached-only compilation unless a call explicitly opts into fetching.
    offline: config.offline === true,
    // Documents are untrusted by default: this is what disables \write18.
    untrusted: config.untrusted !== false,
    allowShellEscape: config.allowShellEscape === true,
    keepIntermediates: config.keepIntermediates === true,
    allowWorkspaceFiles: config.allowWorkspaceFiles !== false,
    allowedLocalRoots: stringArray(config.allowedLocalRoots),
    defaultTimeoutMs: positiveInteger(config.defaultTimeoutMs, DEFAULT_TIMEOUT_MS),
    maxTimeoutMs: positiveInteger(config.maxTimeoutMs, MAX_TIMEOUT_MS),
    maxSourceBytes: positiveInteger(config.maxSourceBytes, DEFAULT_MAX_SOURCE_BYTES),
    maxOutputChars: positiveInteger(config.maxOutputChars, DEFAULT_MAX_OUTPUT_CHARS),
    debug: config.debug === true
  };
}

export const CONFIG_DEFAULTS = Object.freeze({
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  maxTimeoutMs: MAX_TIMEOUT_MS,
  maxSourceBytes: DEFAULT_MAX_SOURCE_BYTES,
  maxOutputChars: DEFAULT_MAX_OUTPUT_CHARS
});
