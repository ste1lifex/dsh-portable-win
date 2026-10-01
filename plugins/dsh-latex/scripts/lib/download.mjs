/**
 * Pinned download helpers.
 *
 * Every fetched byte is verified against the SHA-256 recorded in
 * `manifest.mjs` before it is moved into place, so a truncated transfer, a
 * proxy substitution or a moved release tag fails closed instead of silently
 * producing a broken engine.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * @param {string} path
 * @returns {string} lowercase hex digest
 */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * @param {string} path
 * @param {string} expectedSha256
 * @returns {void}
 */
export function assertPinnedFile(path, expectedSha256) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`Missing downloaded asset: ${path}`);
  }
  const actual = sha256File(path);
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error(`SHA-256 mismatch for '${path}'. Expected ${expectedSha256}, received ${actual}.`);
  }
}

/**
 * Download `uri` to `destination`, reusing an already-correct file.
 *
 * @param {string} uri
 * @param {string} destination
 * @param {string} expectedSha256
 * @returns {Promise<{ reused: boolean }>}
 */
export async function downloadPinnedFile(uri, destination, expectedSha256) {
  if (existsSync(destination) && statSync(destination).isFile()) {
    assertPinnedFile(destination, expectedSha256);
    return { reused: true };
  }
  mkdirSync(dirname(destination), { recursive: true });
  const partial = `${destination}.${randomUUID().replaceAll('-', '')}.part`;
  try {
    const response = await fetch(uri, { redirect: 'follow' });
    if (!response.ok || response.body === null) {
      throw new Error(`Download failed for ${uri}: HTTP ${response.status}`);
    }
    writeFileSync(partial, Buffer.from(await response.arrayBuffer()));
    assertPinnedFile(partial, expectedSha256);
    renameSync(partial, destination);
    return { reused: false };
  } finally {
    if (existsSync(partial)) rmSync(partial, { force: true });
  }
}

/**
 * Rename a freshly populated directory into place. Windows virus scanners and
 * indexers can briefly hold handles on new native binaries, so transient EPERM
 * failures are retried before giving up.
 *
 * @param {string} source
 * @param {string} destination
 * @returns {void}
 */
export function moveWithRetry(source, destination) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      renameSync(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (error?.code !== 'EPERM' && error?.code !== 'EBUSY' && error?.code !== 'ENOTEMPTY') throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * Human-readable byte count for script output.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
