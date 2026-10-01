/**
 * Shared compile plumbing for `latex_compile` and `latex_math`.
 *
 * The split is deliberate: this module owns argument policy (which source,
 * where the output goes, what counts as a failure) while `lib/engine.js` owns
 * the process. Both tools therefore behave identically for paths, limits,
 * offline mode and error reporting.
 */
import { copyFile, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { LATEX_ERROR_CODES, LatexError } from '../errors.js';
import { removeBuildDirectory } from '../engine.js';
import {
  effectiveLocalRoots,
  resolveAuthorizedDirectory,
  resolveReadableFile,
  resolveWritablePath
} from '../security/local-path.js';

/** Extensions Tectonic can emit, keyed by `--outfmt`. */
export const OUTPUT_EXTENSIONS = Object.freeze({
  pdf: 'pdf',
  xdv: 'xdv',
  html: 'html',
  aux: 'aux'
});

/** Arguments shared by every compiling tool. */
export const COMPILE_PARAMETERS = Object.freeze({
  output_path: {
    type: 'string',
    description: 'Where to write the result. Defaults next to the source (file input) or in the session workspace (inline source).'
  },
  output_format: {
    type: 'string',
    enum: ['pdf', 'xdv', 'html', 'aux'],
    description: 'Tectonic output format. pdf is the default.'
  },
  offline: {
    type: 'boolean',
    description: 'Compile strictly from the local resource cache. Fails instead of fetching missing TeX packages.'
  },
  keep_intermediates: {
    type: 'boolean',
    description: 'Also keep the .aux/.log/.toc files next to the result.'
  },
  synctex: {
    type: 'boolean',
    description: 'Emit a SyncTeX file for editor round-tripping.'
  },
  reruns: {
    type: 'integer',
    description: 'Extra engine passes, for cross-references that need more than Tectonic\'s automatic reruns.'
  },
  timeout_ms: {
    type: 'integer',
    description: 'Compilation deadline in milliseconds. Defaults to the plugin configuration (180000).'
  },
  search_paths: {
    type: 'array',
    items: { type: 'string' },
    description: 'Extra authorized directories to resolve \\input and \\includegraphics from, for inline sources that reference workspace files.'
  }
});

/** Canonical result of one compilation. */
export const COMPILE_OUTPUT = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    sourceName: { type: 'string' },
    outputPath: { type: 'string' },
    outputFormat: { type: 'string' },
    outputBytes: { type: 'integer' },
    pages: { type: 'integer' },
    durationMs: { type: 'integer', required: true },
    engine: { type: 'string' },
    engineVersion: { type: 'string' },
    cachedOnly: { type: 'boolean' },
    errors: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    overfullBoxes: { type: 'integer' },
    artifacts: { type: 'array', items: { type: 'string' } },
    logTail: { type: 'string' }
  }
});

/**
 * @param {string | undefined} candidate
 * @param {string} fallback
 * @returns {string}
 */
export function safeStem(candidate, fallback = 'document') {
  const raw = (candidate ?? '').trim();
  if (raw === '') return fallback;
  // Keep the stem filesystem- and TeX-safe: letters, digits, dash, underscore.
  const cleaned = raw.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned === '' ? fallback : cleaned.slice(0, 64);
}

/**
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
export function normalizeOutputFormat(value) {
  if (value === undefined) return undefined;
  if (Object.hasOwn(OUTPUT_EXTENSIONS, value)) return value;
  throw new LatexError(
    LATEX_ERROR_CODES.BAD_REQUEST,
    `output_format must be one of ${Object.keys(OUTPUT_EXTENSIONS).join(', ')}.`
  );
}

/**
 * @param {string} value
 * @param {number} maxBytes
 * @returns {void}
 */
export function assertSourceSize(value, maxBytes) {
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > maxBytes) {
    throw new LatexError(
      LATEX_ERROR_CODES.FILE_TOO_LARGE,
      `The inline LaTeX source is ${bytes} bytes, above the configured ${maxBytes}-byte limit.`
    );
  }
}

/**
 * Run one compilation end to end: stage the source, invoke the engine, publish
 * the result, and clean up.
 *
 * @param {{
 *   engine: ReturnType<import('../engine.js').createLatexEngine>,
 *   config: ReturnType<import('../config.js').resolveConfig>,
 *   source: { kind: 'file', path: string } | { kind: 'inline', text: string },
 *   stem: string,
 *   defaultOutputDirectory: string,
 *   outputPath?: string,
 *   outputFormat?: string,
 *   offline?: boolean,
 *   keepIntermediates?: boolean,
 *   synctex?: boolean,
 *   reruns?: number,
 *   timeoutMs?: number,
 *   searchPaths?: string[],
 *   workingDirectory?: string,
 *   signal?: AbortSignal
 * }} job
 * @returns {Promise<Record<string, any>>}
 */
export async function runCompileJob(job) {
  const { engine, config } = job;
  const roots = effectiveLocalRoots(config, job.workingDirectory);
  const outputFormat = normalizeOutputFormat(job.outputFormat) ?? 'pdf';
  const extension = OUTPUT_EXTENSIONS[outputFormat];

  const buildDirectory = await mkdtemp(join(tmpdir(), 'dsh-latex-'));
  let stagedSource;
  let engineWorkingDirectory;
  let sourceName;

  try {
    if (job.source.kind === 'file') {
      const file = await resolveReadableFile(job.source.path, roots, config.maxSourceBytes, job.workingDirectory);
      stagedSource = file.path;
      engineWorkingDirectory = dirname(file.path);
      sourceName = file.name;
    } else {
      assertSourceSize(job.source.text, config.maxSourceBytes);
      stagedSource = join(buildDirectory, `${job.stem}.tex`);
      await writeFile(stagedSource, job.source.text, 'utf8');
      engineWorkingDirectory = buildDirectory;
      sourceName = `${job.stem}.tex`;
    }

    const authorizedSearchPaths = [];
    for (const candidate of job.searchPaths ?? []) {
      authorizedSearchPaths.push(await resolveAuthorizedDirectory(candidate, roots, job.workingDirectory));
    }

    const requestedOutput = job.outputPath ?? join(job.defaultOutputDirectory, `${job.stem}.${extension}`);
    const outputPath = await resolveWritablePath(requestedOutput, roots, job.workingDirectory);

    const outcome = await engine.compile({
      sourceFile: stagedSource,
      workingDirectory: engineWorkingDirectory,
      outputDirectory: buildDirectory,
      outputFormat,
      offline: job.offline ?? config.offline,
      keepIntermediates: true,
      synctex: job.synctex === true,
      reruns: job.reruns,
      timeoutMs: job.timeoutMs,
      searchPaths: authorizedSearchPaths,
      signal: job.signal
    });

    if (!outcome.ok) {
      throw new LatexError(
        LATEX_ERROR_CODES.COMPILE_FAILED,
        `LaTeX failed to compile ${sourceName}: ${summarizeError(outcome.errors)}`,
        { logTail: outcome.logTail }
      );
    }

    const primary = pickPrimaryOutput(outcome.producedFiles, job.stem, extension);
    if (primary === undefined) {
      throw new LatexError(
        LATEX_ERROR_CODES.OUTPUT_MISSING,
        `The engine exited successfully but produced no .${extension} file for ${sourceName}.`,
        { logTail: outcome.logTail }
      );
    }

    await copyFile(primary, outputPath);
    const published = await stat(outputPath);

    const artifacts = [];
    if (job.keepIntermediates === true) {
      for (const produced of outcome.producedFiles) {
        if (produced === primary) continue;
        const destination = join(dirname(outputPath), basename(produced));
        await copyFile(produced, destination);
        artifacts.push(destination);
      }
    }

    return {
      ok: true,
      sourceName,
      outputPath,
      outputFormat,
      outputBytes: published.size,
      ...(outcome.pages === undefined ? {} : { pages: outcome.pages }),
      durationMs: outcome.durationMs,
      engine: 'tectonic',
      engineVersion: outcome.engineVersion,
      cachedOnly: (job.offline ?? config.offline) === true,
      errors: [],
      warnings: outcome.warnings,
      overfullBoxes: outcome.overfull,
      artifacts,
      logTail: outcome.logTail
    };
  } finally {
    await removeBuildDirectory(buildDirectory);
  }
}

/**
 * One readable line for the model. TeX error lines arrive with a leading `!`
 * (sometimes doubled, depending on the engine) and stray newlines from the
 * `l.<n>` context line.
 *
 * @param {string[]} errors
 * @returns {string}
 */
function summarizeError(errors) {
  const raw = errors[0] ?? 'the engine reported an error';
  return raw
    .replace(/^(?:\s*!+\s*)+/, '')
    .replace(/\s+/g, ' ')
    .replace(/\.{2,}$/, '.')
    .trim() || 'the engine reported an error';
}

/**
 * Prefer the file Tectonic names after the entry file, then any file with the
 * expected extension.
 *
 * @param {string[]} producedFiles
 * @param {string} stem
 * @param {string} extension
 * @returns {string | undefined}
 */
function pickPrimaryOutput(producedFiles, stem, extension) {
  const expected = `${stem}.${extension}`.toLowerCase();
  const exact = producedFiles.find(file => basename(file).toLowerCase() === expected);
  if (exact !== undefined) return exact;
  return producedFiles.find(file => extname(file).toLowerCase() === `.${extension}`);
}
