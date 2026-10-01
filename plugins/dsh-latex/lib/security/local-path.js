/**
 * Path authorization for LaTeX sources and outputs.
 *
 * The model may only read `.tex` inputs from, and write results into, the
 * session workspace plus the operator's `allowedLocalRoots`. Both directions
 * are checked twice — lexically first (cheap, and it rejects UNC/device paths
 * before any filesystem call can touch a network endpoint), then against real
 * paths so a symlink cannot escape an authorized root.
 */
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { LATEX_ERROR_CODES, LatexError } from '../errors.js';

/**
 * @param {string} root
 * @param {string} candidate
 * @returns {boolean}
 */
function isWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot));
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isFilesystemRoot(path) {
  const normalized = resolve(path);
  return parse(normalized).root === normalized;
}

/**
 * UNC shares, device namespaces and URI-shaped strings are rejected before any
 * filesystem call, because resolving them can itself contact a remote host.
 * @param {string} path
 * @returns {boolean}
 */
export function isNetworkOrDevicePath(path) {
  return /^(?:\\\\|\/\/|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/.test(path);
}

/**
 * @param {string[]} roots
 * @returns {Promise<string[]>}
 */
async function realAllowedRoots(roots) {
  const resolved = [];
  for (const root of roots) {
    try {
      const rootStat = await stat(root);
      if (!rootStat.isDirectory()) continue;
      const realRoot = await realpath(root);
      if (!isFilesystemRoot(realRoot)) resolved.push(realRoot);
    } catch {
      // A stale configured root grants no access, and its details are not leaked.
    }
  }
  return resolved;
}

/**
 * @param {string} requestedPath
 * @param {string[]} roots
 * @returns {boolean}
 */
function withinAnyRoot(requestedPath, roots) {
  return roots.some(root => isWithin(root, requestedPath));
}

/**
 * Authorized roots for one call: the configured allowlist plus, unless
 * disabled, the session workspace. The agent can already read its own cwd, so
 * trusting it here does not widen the model's reach.
 *
 * @param {{ allowWorkspaceFiles: boolean, allowedLocalRoots: string[] }} config
 * @param {string | undefined} workingDirectory
 * @returns {string[]}
 */
export function effectiveLocalRoots(config, workingDirectory) {
  if (!config.allowWorkspaceFiles || workingDirectory === undefined) return config.allowedLocalRoots;
  if (config.allowedLocalRoots.includes(workingDirectory)) return config.allowedLocalRoots;
  return [...config.allowedLocalRoots, workingDirectory];
}

/**
 * Resolve an existing regular file inside an authorized root.
 *
 * @param {string} inputPath
 * @param {string[]} allowedRoots
 * @param {number} maxBytes
 * @param {string | undefined} workingDirectory
 * @returns {Promise<{ path: string, name: string, size: number }>}
 */
export async function resolveReadableFile(inputPath, allowedRoots, maxBytes, workingDirectory) {
  if (allowedRoots.length === 0) {
    throw new LatexError(
      LATEX_ERROR_CODES.FILE_ACCESS_DENIED,
      'Compiling from a file requires allowedLocalRoots configuration or an active session workspace.'
    );
  }
  if (isNetworkOrDevicePath(inputPath)) {
    throw new LatexError(LATEX_ERROR_CODES.FILE_ACCESS_DENIED, 'The requested source is outside allowedLocalRoots.');
  }

  const requestedPath = resolve(workingDirectory ?? process.cwd(), inputPath);
  if (isNetworkOrDevicePath(requestedPath) || !allowedRoots.some(root => !isNetworkOrDevicePath(root) && isWithin(resolve(root), requestedPath))) {
    throw new LatexError(LATEX_ERROR_CODES.FILE_ACCESS_DENIED, 'The requested source is outside allowedLocalRoots.');
  }

  let realFilePath;
  try {
    realFilePath = await realpath(requestedPath);
  } catch {
    throw new LatexError(LATEX_ERROR_CODES.FILE_NOT_FOUND, `LaTeX source not found: ${inputPath}`);
  }

  const roots = await realAllowedRoots(allowedRoots);
  if (!withinAnyRoot(realFilePath, roots)) {
    throw new LatexError(LATEX_ERROR_CODES.FILE_ACCESS_DENIED, 'The requested source is outside allowedLocalRoots.');
  }

  let handle;
  try {
    const currentPath = await realpath(realFilePath);
    if (!withinAnyRoot(currentPath, roots)) {
      throw new LatexError(LATEX_ERROR_CODES.FILE_ACCESS_DENIED, 'The requested source is outside allowedLocalRoots.');
    }
    const details = await lstat(currentPath);
    if (!details.isFile()) {
      throw new LatexError(LATEX_ERROR_CODES.FILE_ACCESS_DENIED, 'The requested source must be a regular file.');
    }
    if (details.size > maxBytes) {
      throw new LatexError(LATEX_ERROR_CODES.FILE_TOO_LARGE, `The LaTeX source exceeds the configured ${maxBytes}-byte limit.`);
    }
    // O_NOFOLLOW closes the open-time symlink race where the platform supports
    // it; the descriptor identity checks below cover Windows, which does not.
    handle = await open(currentPath, process.platform === 'win32' ? 'r' : constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    const afterOpen = await realpath(currentPath);
    if (afterOpen !== currentPath || !withinAnyRoot(afterOpen, roots)) {
      throw new LatexError(LATEX_ERROR_CODES.FILE_ACCESS_DENIED, 'The requested source is outside allowedLocalRoots.');
    }
    if (!opened.isFile()) {
      throw new LatexError(LATEX_ERROR_CODES.FILE_ACCESS_DENIED, 'The requested source must be a regular file.');
    }
    if (opened.size > maxBytes) {
      throw new LatexError(LATEX_ERROR_CODES.FILE_TOO_LARGE, `The LaTeX source exceeds the configured ${maxBytes}-byte limit.`);
    }
    return { path: afterOpen, name: basename(afterOpen), size: opened.size };
  } catch (error) {
    if (error instanceof LatexError) throw error;
    throw new LatexError(LATEX_ERROR_CODES.FILE_NOT_FOUND, `LaTeX source not found: ${inputPath}`);
  } finally {
    await handle?.close();
  }
}

/**
 * Resolve a destination inside an authorized root, creating parent directories
 * as needed. The file itself does not have to exist yet; the deepest existing
 * ancestor is realpath-checked instead.
 *
 * @param {string} outputPath
 * @param {string[]} allowedRoots
 * @param {string | undefined} workingDirectory
 * @returns {Promise<string>}
 */
export async function resolveWritablePath(outputPath, allowedRoots, workingDirectory) {
  if (allowedRoots.length === 0) {
    throw new LatexError(
      LATEX_ERROR_CODES.FILE_ACCESS_DENIED,
      'Writing a result requires allowedLocalRoots configuration or an active session workspace.'
    );
  }
  if (isNetworkOrDevicePath(outputPath)) {
    throw new LatexError(LATEX_ERROR_CODES.FILE_ACCESS_DENIED, 'The requested output path is outside allowedLocalRoots.');
  }

  const requestedPath = resolve(workingDirectory ?? process.cwd(), outputPath);
  if (isNetworkOrDevicePath(requestedPath) || !allowedRoots.some(root => !isNetworkOrDevicePath(root) && isWithin(resolve(root), requestedPath))) {
    throw new LatexError(LATEX_ERROR_CODES.FILE_ACCESS_DENIED, 'The requested output path is outside allowedLocalRoots.');
  }

  const roots = await realAllowedRoots(allowedRoots);
  if (roots.length === 0) {
    throw new LatexError(LATEX_ERROR_CODES.FILE_ACCESS_DENIED, 'No authorized output root exists on this machine.');
  }

  await mkdir(dirname(requestedPath), { recursive: true });

  // Walk up to the deepest existing ancestor and realpath-check it, so a
  // symlinked directory cannot redirect the write out of an authorized root.
  let ancestor = dirname(requestedPath);
  for (;;) {
    try {
      const realAncestor = await realpath(ancestor);
      if (!withinAnyRoot(realAncestor, roots)) {
        throw new LatexError(LATEX_ERROR_CODES.FILE_ACCESS_DENIED, 'The requested output path is outside allowedLocalRoots.');
      }
      const target = resolve(realAncestor, relative(ancestor, requestedPath));
      if (!withinAnyRoot(target, roots)) {
        throw new LatexError(LATEX_ERROR_CODES.FILE_ACCESS_DENIED, 'The requested output path is outside allowedLocalRoots.');
      }
      return target;
    } catch (error) {
      if (error instanceof LatexError) throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) {
        throw new LatexError(LATEX_ERROR_CODES.FILE_ACCESS_DENIED, 'The requested output path is outside allowedLocalRoots.');
      }
      ancestor = parent;
    }
  }
}

/**
 * Ensure a directory exists and return its real path, used for the default
 * output location.
 * @param {string} directory
 * @returns {Promise<string>}
 */
export async function ensureDirectory(directory) {
  await mkdir(directory, { recursive: true });
  return realpath(directory);
}

/**
 * Resolve an existing directory inside an authorized root. Used for the extra
 * `-Z search-path` entries an inline document may request.
 *
 * @param {string} directory
 * @param {string[]} allowedRoots
 * @param {string | undefined} workingDirectory
 * @returns {Promise<string>}
 */
export async function resolveAuthorizedDirectory(directory, allowedRoots, workingDirectory) {
  if (allowedRoots.length === 0) {
    throw new LatexError(
      LATEX_ERROR_CODES.FILE_ACCESS_DENIED,
      'Search paths require allowedLocalRoots configuration or an active session workspace.'
    );
  }
  if (isNetworkOrDevicePath(directory)) {
    throw new LatexError(LATEX_ERROR_CODES.FILE_ACCESS_DENIED, 'The requested search path is outside allowedLocalRoots.');
  }

  const requested = resolve(workingDirectory ?? process.cwd(), directory);
  if (isNetworkOrDevicePath(requested) || !allowedRoots.some(root => !isNetworkOrDevicePath(root) && isWithin(resolve(root), requested))) {
    throw new LatexError(LATEX_ERROR_CODES.FILE_ACCESS_DENIED, 'The requested search path is outside allowedLocalRoots.');
  }

  let realDirectory;
  try {
    realDirectory = await realpath(requested);
  } catch {
    throw new LatexError(LATEX_ERROR_CODES.FILE_NOT_FOUND, `Search path not found: ${directory}`);
  }
  const details = await stat(realDirectory);
  if (!details.isDirectory()) {
    throw new LatexError(LATEX_ERROR_CODES.BAD_REQUEST, `Search path is not a directory: ${directory}`);
  }
  const roots = await realAllowedRoots(allowedRoots);
  if (!withinAnyRoot(realDirectory, roots)) {
    throw new LatexError(LATEX_ERROR_CODES.FILE_ACCESS_DENIED, 'The requested search path is outside allowedLocalRoots.');
  }
  return realDirectory;
}

/**
 * Join and normalize an output file name, refusing anything that would escape
 * the directory it is placed in.
 * @param {string} directory
 * @param {string} fileName
 * @returns {string}
 */
export function joinOutput(directory, fileName) {
  const safeName = basename(fileName);
  if (safeName === '' || safeName === '.' || safeName === '..' || safeName !== fileName) {
    throw new LatexError(LATEX_ERROR_CODES.BAD_REQUEST, `Unsafe output file name: ${fileName}`);
  }
  return `${directory}${sep}${safeName}`;
}
