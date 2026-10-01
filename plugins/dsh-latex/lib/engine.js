/**
 * The Tectonic engine adapter.
 *
 * Tectonic is a single self-contained binary: it reads a `.tex` file, fetches
 * only the TeX Live files that document actually needs into
 * `TECTONIC_CACHE_DIR`, and writes the requested output. There is no system TeX
 * installation, no `kpsewhich`, and no `fmtutil` step — which is exactly why it
 * is the engine this plugin pins.
 *
 * This module owns process invocation and log interpretation. Path
 * authorization and default-output policy live in the tool layer.
 */
import { spawn } from 'node:child_process';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { LATEX_ERROR_CODES, LatexError } from './errors.js';
import { locateRuntime } from './runtime.js';

/** Engine stdout/stderr retained per stream, in bytes. */
const MAX_CAPTURED_BYTES = 512 * 1024;
/**
 * Chatter lines that always mean "this run failed".
 *
 * `caused by:` matters as much as `error:`: when a back-end such as xdvipdfmx
 * dies it prints an opaque one-liner and puts the actionable reason (a missing
 * physical font, an unwritable path) on the indented `caused by:` line beneath
 * it. Dropping that line leaves the model with "something bad happened" and no
 * way to act, so it is treated as a first-class diagnostic.
 */
const ERROR_LINE = /^(?:error:|! |caused by:)/i;
/** Cosmetic noise the bare Windows Tectonic build prints on every run. */
const COSMETIC_NOISE = /^Fontconfig error: Cannot load default config file/i;
/**
 * Warnings about functionality this plugin disables on purpose. Reporting them
 * as document warnings would train the model to ignore real ones.
 */
const DELIBERATE_WARNINGS = [
  /shellesc Warning: Shell escape disabled/i
];

/**
 * @typedef {object} CompileRequest
 * @property {string} sourceFile absolute path of the `.tex` entry file
 * @property {string} workingDirectory directory the engine runs in (relative `\input`/graphics resolve here)
 * @property {string} outputDirectory directory Tectonic writes into
 * @property {string} [outputFormat] `pdf` (default), `xdv`, `html`, or `aux`
 * @property {boolean} [offline] pass `--only-cached` and never touch the network
 * @property {boolean} [keepIntermediates]
 * @property {boolean} [synctex]
 * @property {boolean} [untrusted]
 * @property {boolean} [shellEscape]
 * @property {number} [reruns]
 * @property {string} [pass]
 * @property {string[]} [searchPaths]
 * @property {number} [timeoutMs]
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {object} CompileOutcome
 * @property {boolean} ok
 * @property {string} outputFormat
 * @property {string[]} producedFiles absolute paths written by the engine
 * @property {number} durationMs
 * @property {number} exitCode
 * @property {string[]} errors
 * @property {string[]} warnings
 * @property {number | undefined} pages
 * @property {number} overfull
 * @property {number} underfull
 * @property {string} logTail
 * @property {string} engineVersion
 */

/**
 * Build the Tectonic argument vector. Exported so it can be unit-tested
 * without an engine binary.
 *
 * @param {CompileRequest} request
 * @returns {string[]}
 */
export function buildCompileArgs(request) {
  const args = [
    '-X', 'compile',
    request.sourceFile,
    '--outdir', request.outputDirectory,
    // Always retained internally: the log is how a failure is explained.
    // (The V2 `compile` subcommand has no `--chatter`; that flag only exists
    // on the legacy top-level command.)
    '--keep-logs'
  ];
  const format = request.outputFormat ?? 'pdf';
  if (format !== 'pdf') args.push('--outfmt', format);
  if (request.offline === true) args.push('--only-cached');
  if (request.keepIntermediates === true) args.push('--keep-intermediates');
  if (request.synctex === true) args.push('--synctex');
  if (request.untrusted === true) args.push('--untrusted');
  if (request.shellEscape === true) args.push('-Z', 'shell-escape');
  if (typeof request.reruns === 'number' && Number.isSafeInteger(request.reruns) && request.reruns >= 0) {
    args.push('--reruns', String(request.reruns));
  }
  if (typeof request.pass === 'string' && request.pass.length > 0) args.push('--pass', request.pass);
  for (const searchPath of request.searchPaths ?? []) args.push('-Z', `search-path=${searchPath}`);
  return args;
}

/**
 * Spawn a process, capture bounded output, and settle on exit, timeout, or
 * cancellation.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env: NodeJS.ProcessEnv, timeoutMs: number, signal?: AbortSignal }} options
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string, timedOut: boolean, aborted: boolean, durationMs: number }>}
 */
function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      reject(error);
      return;
    }

    /** @type {Buffer[]} */
    const stdoutChunks = [];
    /** @type {Buffer[]} */
    const stderrChunks = [];
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const capture = (chunks, chunk, budget) => {
      if (budget.used >= MAX_CAPTURED_BYTES) return;
      budget.used += chunk.byteLength;
      chunks.push(chunk);
    };
    const stdoutBudget = { used: 0 };
    const stderrBudget = { used: 0 };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    const onAbort = () => {
      aborted = true;
      child.kill('SIGKILL');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };

    child.on('error', error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });

    child.on('close', exitCode => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        exitCode: exitCode ?? -1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
        aborted,
        durationMs: Date.now() - startedAt
      });
    });

    child.stdout?.on('data', chunk => capture(stdoutChunks, chunk, stdoutBudget));
    child.stderr?.on('data', chunk => capture(stderrChunks, chunk, stderrBudget));
  });
}

/**
 * Interpret a TeX `.log` file into the few facts worth showing the model.
 *
 * @param {string} logText
 * @returns {{ errors: string[], warnings: string[], pages: number | undefined, overfull: number, underfull: number }}
 */
export function parseTexLog(logText) {
  const errors = [];
  const warnings = [];
  let pages;
  let overfull = 0;
  let underfull = 0;
  const lines = logText.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('!')) {
      // A TeX error is the `!` line plus the following `l.<n> <context>` line.
      const context = lines[index + 1]?.trim();
      errors.push(context !== undefined && context.startsWith('l.') ? `${line.trim()} ${context}` : line.trim());
      continue;
    }
    if (/^LaTeX (?:Warning|Font Warning)/.test(line) || /^Package \S+ Warning/.test(line)) {
      if (!DELIBERATE_WARNINGS.some(pattern => pattern.test(line))) warnings.push(line.trim());
      continue;
    }
    if (/^Overfull \\[hv]box/.test(line)) {
      overfull += 1;
      continue;
    }
    if (/^Underfull \\[hv]box/.test(line)) {
      underfull += 1;
      continue;
    }
    const pageMatch = /^Output written on .*\((\d+) pages?/.exec(line);
    if (pageMatch !== null) pages = Number.parseInt(pageMatch[1], 10);
  }

  return { errors, warnings, pages, overfull, underfull };
}

/**
 * Keep the meaningful tail of a noisy stream.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
export function tailOf(text, maxChars) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return false;
      if (COSMETIC_NOISE.test(trimmed)) return false;
      // Tectonic's per-message chatter prefixes every line with `warning:`.
      // Those are already surfaced separately as parsed document warnings, so
      // keeping them here would bury the terminal failure that follows them
      // under dozens of `Underfull \hbox` notices.
      if (/^warning:\s/i.test(trimmed)) return false;
      return true;
    });
  const trimmed = lines.join('\n').trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `…\n${trimmed.slice(trimmed.length - maxChars)}`;
}

/**
 * Create the engine facade bound to one resolved configuration.
 *
 * @param {ReturnType<import('./config.js').resolveConfig>} config
 * @param {{ log?: (message: string, details?: unknown) => void, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, arch?: string }} [options]
 */
export function createLatexEngine(config, options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const log = options.log ?? (() => {});
  /** @type {Map<string, string>} */
  const versionCache = new Map();

  /** @returns {ReturnType<typeof locateRuntime>} */
  function locate() {
    return locateRuntime({
      enginePath: config.enginePath,
      runtimeDir: config.runtimeDir,
      cacheDir: config.cacheDir,
      env,
      platform,
      arch
    });
  }

  /**
   * Child environment: the cache directory is the only knob Tectonic needs, and
   * pinning it keeps a portable harness from writing into the user profile.
   * @param {ReturnType<typeof locateRuntime>} runtime
   * @returns {NodeJS.ProcessEnv}
   */
  function childEnv(runtime) {
    return { ...env, TECTONIC_CACHE_DIR: runtime.cacheDir };
  }

  /**
   * @param {string} enginePath
   * @param {NodeJS.ProcessEnv} childEnvironment
   * @returns {Promise<string>}
   */
  async function engineVersion(enginePath, childEnvironment) {
    const cached = versionCache.get(enginePath);
    if (cached !== undefined) return cached;
    const result = await runProcess(enginePath, ['--version'], { env: childEnvironment, timeoutMs: 20_000 });
    const match = /Tectonic\s+([0-9][^\s]*)/i.exec(`${result.stdout}${result.stderr}`);
    const version = match?.[1] ?? 'unknown';
    versionCache.set(enginePath, version);
    return version;
  }

  /**
   * @param {string} cacheDir
   * @returns {Promise<{ files: number, bytes: number, warmedUp: boolean }>}
   */
  async function cacheStats(cacheDir) {
    let files = 0;
    let bytes = 0;
    let warmedUp = false;
    const walk = async directory => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const child = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'formats') warmedUp = true;
          await walk(child);
        } else if (entry.isFile()) {
          files += 1;
          try {
            bytes += (await stat(child)).size;
          } catch {
            // A file that vanished mid-walk contributes nothing.
          }
        }
      }
    };
    await walk(cacheDir);
    return { files, bytes, warmedUp };
  }

  return {
    /** Static description of the resolved runtime. */
    describe() {
      const runtime = locate();
      return {
        engine: 'tectonic',
        enginePath: runtime.enginePath,
        runtimeDir: runtime.runtimeDir,
        cacheDir: runtime.cacheDir,
        origin: runtime.origin,
        searched: runtime.searched,
        offlineDefault: config.offline
      };
    },

    /**
     * Probe the engine and the bundle cache.
     * @param {AbortSignal} [signal]
     */
    async health(signal) {
      const startedAt = Date.now();
      const runtime = locate();
      const stats = await cacheStats(runtime.cacheDir);
      let version;
      let error;
      if (runtime.enginePath !== undefined) {
        try {
          version = await engineVersion(runtime.enginePath, childEnv(runtime));
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause);
        }
      }
      return {
        ready: runtime.enginePath !== undefined && version !== undefined && version !== 'unknown',
        engine: 'tectonic',
        enginePath: runtime.enginePath ?? null,
        engineVersion: version ?? null,
        runtimeDir: runtime.runtimeDir ?? null,
        cacheDir: runtime.cacheDir,
        cacheFiles: stats.files,
        cacheBytes: stats.bytes,
        warmedUp: stats.warmedUp,
        origin: runtime.origin,
        offline: config.offline,
        latencyMs: Date.now() - startedAt,
        ...(error === undefined ? {} : { error }),
        ...(signal?.aborted === true ? { aborted: true } : {})
      };
    },

    /**
     * Run one compilation.
     *
     * @param {CompileRequest} request
     * @returns {Promise<CompileOutcome>}
     */
    async compile(request) {
      const runtime = locate();
      if (runtime.enginePath === undefined) {
        throw new LatexError(
          LATEX_ERROR_CODES.ENGINE_MISSING,
          'The Tectonic engine is not installed for this harness. Run '
          + '`node <dsh-latex>/scripts/fetch-runtime.mjs` (or `pnpm run runtime:fetch` inside the package) '
          + 'once, then retry.',
          { detail: `Searched: ${runtime.searched.join(', ') || '(no candidate directories)'}` }
        );
      }

      const timeoutMs = Math.min(request.timeoutMs ?? config.defaultTimeoutMs, config.maxTimeoutMs);
      const effectiveEnv = childEnv(runtime);
      const args = buildCompileArgs({
        ...request,
        untrusted: request.untrusted ?? config.untrusted,
        shellEscape: request.shellEscape === true && config.allowShellEscape
      });

      log('tectonic', { args, cwd: request.workingDirectory, cacheDir: runtime.cacheDir });

      let result;
      try {
        result = await runProcess(runtime.enginePath, args, {
          cwd: request.workingDirectory,
          env: effectiveEnv,
          timeoutMs,
          signal: request.signal
        });
      } catch (cause) {
        throw new LatexError(
          LATEX_ERROR_CODES.ENGINE_MISSING,
          `Could not start the Tectonic engine at ${runtime.enginePath}: ${cause instanceof Error ? cause.message : String(cause)}`
        );
      }

      const combined = tailOf(`${result.stdout}\n${result.stderr}`, config.maxOutputChars);
      const produced = await listProducedFiles(request.outputDirectory);
      const logText = await readTexLog(request.outputDirectory, request.sourceFile);
      const parsed = logText === undefined
        ? { errors: [], warnings: [], pages: undefined, overfull: 0, underfull: 0 }
        : parseTexLog(logText);

      // The TeX log is authoritative for document errors; chatter is the
      // fallback for failures that happen before the engine runs at all
      // (bundle download refused, malformed format, ...).
      const chatterErrors = combined
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => ERROR_LINE.test(line));

      const errors = parsed.errors.length > 0 ? parsed.errors : chatterErrors;

      if (result.aborted) {
        throw new LatexError(LATEX_ERROR_CODES.ABORTED, 'LaTeX compilation was cancelled.');
      }
      if (result.timedOut) {
        throw new LatexError(
          LATEX_ERROR_CODES.TIMEOUT,
          `LaTeX compilation exceeded ${timeoutMs} ms and was terminated. Raise timeout_ms for heavy documents, or simplify the source.`,
          { logTail: combined }
        );
      }

      return {
        ok: result.exitCode === 0 && errors.length === 0,
        outputFormat: request.outputFormat ?? 'pdf',
        producedFiles: produced,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        errors: errors.slice(0, 20),
        warnings: parsed.warnings.slice(0, 20),
        pages: parsed.pages,
        overfull: parsed.overfull,
        underfull: parsed.underfull,
        logTail: combined,
        engineVersion: await engineVersion(runtime.enginePath, effectiveEnv).catch(() => 'unknown')
      };
    },

    /** Exposed for the scripts and tests. */
    cacheStats,
    locate
  };
}

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function listProducedFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter(entry => entry.isFile()).map(entry => join(directory, entry.name));
  } catch {
    return [];
  }
}

/**
 * @param {string} directory
 * @param {string} sourceFile
 * @returns {Promise<string | undefined>}
 */
async function readTexLog(directory, sourceFile) {
  const stem = basename(sourceFile, extname(sourceFile));
  for (const candidate of [join(directory, `${stem}.log`), join(directory, 'texput.log')]) {
    try {
      return await readFile(candidate, 'utf8');
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

/**
 * Remove a temporary build directory, ignoring failures (Windows virus
 * scanners can hold handles briefly).
 * @param {string} directory
 */
export async function removeBuildDirectory(directory) {
  try {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Best effort.
  }
}
