/**
 * Where the pinned Tectonic engine and its TeX bundle cache live.
 *
 * The layout deliberately mirrors `dsh-doc`'s runtime convention:
 *
 *   <DSH_HOME>/runtimes/latex-runtime-<platform>-<arch>/
 *     tectonic[.exe]      the pinned engine binary
 *     manifest.json       engine version + binary SHA-256 recorded at fetch time
 *     cache/              Tectonic's TECTONIC_CACHE_DIR (lazily filled, then offline)
 *
 * Nothing here assumes a system TeX installation, and nothing writes outside
 * the harness home unless the operator points `runtimeDir` elsewhere.
 */
import { existsSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package root (`.../dsh-latex`), used for the package-local runtime fallback. */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Platform key used in runtime directory names, e.g. `win32-x64`.
 * @param {NodeJS.Platform} [platform]
 * @param {string} [arch]
 */
export function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

/**
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function engineFileName(platform = process.platform) {
  return platform === 'win32' ? 'tectonic.exe' : 'tectonic';
}

/**
 * @param {string} directory
 * @param {NodeJS.Platform} platform
 * @returns {string | undefined}
 */
function engineIn(directory, platform) {
  if (directory === undefined || directory === null || directory === '') return undefined;
  const candidate = join(directory, engineFileName(platform));
  try {
    if (statSync(candidate).isFile()) return candidate;
  } catch {
    // Missing or unreadable; treated as "not installed here".
  }
  return undefined;
}

/**
 * Search `PATH` for a system Tectonic, so an operator who already has one can
 * simply use it.
 * @param {NodeJS.ProcessEnv} env
 * @param {NodeJS.Platform} platform
 * @returns {string | undefined}
 */
function engineOnPath(env, platform) {
  const pathValue = env.PATH ?? env.Path ?? '';
  if (pathValue === '') return undefined;
  for (const entry of pathValue.split(delimiter)) {
    if (entry === '') continue;
    const found = engineIn(entry, platform);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Candidate runtime directories with the reason each one is tried, most
 * specific first.
 * @param {{ runtimeDir?: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, arch?: string }} options
 * @returns {{ directory: string, origin: RuntimeOrigin }[]}
 */
export function runtimeDirCandidates(options = {}) {
  const env = options.env ?? process.env;
  const key = platformKey(options.platform ?? process.platform, options.arch ?? process.arch);
  /** @type {{ directory: string, origin: RuntimeOrigin }[]} */
  const candidates = [];
  if (options.runtimeDir !== undefined) {
    candidates.push({ directory: resolve(options.runtimeDir), origin: 'configured-runtime' });
  }
  if (typeof env.DSH_LATEX_RUNTIME_DIR === 'string' && env.DSH_LATEX_RUNTIME_DIR !== '') {
    candidates.push({ directory: resolve(env.DSH_LATEX_RUNTIME_DIR), origin: 'environment' });
  }
  if (typeof env.DSH_HOME === 'string' && env.DSH_HOME !== '') {
    candidates.push({
      directory: join(resolve(env.DSH_HOME), 'runtimes', `latex-runtime-${key}`),
      origin: 'harness-home'
    });
  }
  candidates.push({
    directory: join(PACKAGE_ROOT, '.dsh-runtime', `latex-runtime-${key}`),
    origin: 'package-local'
  });
  return candidates;
}

/**
 * @typedef {'configured-engine' | 'configured-runtime' | 'environment' | 'harness-home' | 'package-local' | 'path' | 'none'} RuntimeOrigin
 */

/**
 * Resolve the engine, the directory that owns it, and the bundle cache.
 *
 * @param {{
 *   enginePath?: string,
 *   runtimeDir?: string,
 *   cacheDir?: string,
 *   env?: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform,
 *   arch?: string
 * }} options
 * @returns {{
 *   enginePath: string | undefined,
 *   runtimeDir: string | undefined,
 *   cacheDir: string,
 *   origin: RuntimeOrigin,
 *   searched: string[]
 * }}
 */
export function locateRuntime(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;

  const configuredEngine = options.enginePath;
  if (configuredEngine !== undefined && configuredEngine !== '') {
    const absolute = isAbsolute(configuredEngine) ? configuredEngine : resolve(configuredEngine);
    return {
      enginePath: absolute,
      runtimeDir: dirname(absolute),
      cacheDir: resolveCacheDir(options.cacheDir, dirname(absolute), env, platform, arch),
      origin: 'configured-engine',
      searched: [absolute]
    };
  }

  const candidates = runtimeDirCandidates({ runtimeDir: options.runtimeDir, env, platform, arch });
  const searched = [];
  for (const candidate of candidates) {
    searched.push(candidate.directory);
    const found = engineIn(candidate.directory, platform);
    if (found !== undefined) {
      return {
        enginePath: found,
        runtimeDir: candidate.directory,
        cacheDir: resolveCacheDir(options.cacheDir, candidate.directory, env, platform, arch),
        origin: candidate.origin,
        searched
      };
    }
  }

  const onPath = engineOnPath(env, platform);
  if (onPath !== undefined) {
    return {
      enginePath: onPath,
      runtimeDir: dirname(onPath),
      cacheDir: resolveCacheDir(options.cacheDir, dirname(onPath), env, platform, arch),
      origin: 'path',
      searched
    };
  }

  const fallbackRuntime = candidates[0]?.directory;
  return {
    enginePath: undefined,
    runtimeDir: fallbackRuntime,
    cacheDir: resolveCacheDir(options.cacheDir, fallbackRuntime, env, platform, arch),
    origin: 'none',
    searched
  };
}

/**
 * @param {string | undefined} configured
 * @param {string | undefined} runtimeDir
 * @param {NodeJS.ProcessEnv} env
 * @param {NodeJS.Platform} platform
 * @param {string} arch
 * @returns {string}
 */
function resolveCacheDir(configured, runtimeDir, env, platform, arch) {
  if (configured !== undefined && configured !== '') return resolve(configured);
  if (typeof env.DSH_LATEX_CACHE_DIR === 'string' && env.DSH_LATEX_CACHE_DIR !== '') {
    return resolve(env.DSH_LATEX_CACHE_DIR);
  }
  if (runtimeDir !== undefined && runtimeDir !== '') return join(runtimeDir, 'cache');
  const key = platformKey(platform, arch);
  const home = env.DSH_HOME ?? PACKAGE_ROOT;
  return join(resolve(home), 'runtimes', `latex-runtime-${key}`, 'cache');
}

/**
 * The fetch script's default destination for the current platform.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {NodeJS.Platform} [platform]
 * @param {string} [arch]
 * @returns {string}
 */
export function defaultRuntimeDir(env = process.env, platform = process.platform, arch = process.arch) {
  return runtimeDirCandidates({ env, platform, arch })[0].directory;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function fileExists(path) {
  return existsSync(path);
}
