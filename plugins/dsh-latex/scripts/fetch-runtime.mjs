#!/usr/bin/env node
/**
 * Install the pinned Tectonic engine for this machine.
 *
 *   node scripts/fetch-runtime.mjs [output-directory] [--force]
 *
 * The archive is downloaded from the upstream GitHub Release, verified against
 * the SHA-256 pinned in `scripts/lib/manifest.mjs`, extracted into a staging
 * directory, and only then moved into place. A failed or mismatched download
 * leaves no half-installed engine behind.
 *
 * This is the whole "self-contained" story: a fresh clone plus one command
 * yields a working LaTeX toolchain with no system TeX, no package manager and
 * no compiler.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractArchive } from './lib/archive.mjs';
import { assertPinnedFile, downloadPinnedFile, formatBytes, moveWithRetry, sha256File } from './lib/download.mjs';
import { TECTONIC_VERSION, assetFor, assetUrl, platformKey } from './lib/manifest.mjs';
import { defaultRuntimeDir } from '../lib/runtime.js';

const SCRIPT_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIRECTORY, '..');

/**
 * @param {string} path
 * @returns {boolean}
 */
function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const positional = argv.filter(argument => !argument.startsWith('--'));
  const platform = process.platform;
  const arch = process.arch;
  const key = platformKey(platform, arch);
  const asset = assetFor(platform, arch);
  const output = resolve(positional[0] ?? defaultRuntimeDir(process.env, platform, arch));
  const enginePath = join(output, asset.binary);
  const manifestPath = join(output, 'manifest.json');

  if (!force && isFile(enginePath) && isFile(manifestPath)) {
    const existing = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (existing?.engineVersion === TECTONIC_VERSION && existing?.binarySha256 === sha256File(enginePath)) {
      console.log(`Tectonic ${TECTONIC_VERSION} already installed and verified: ${enginePath}`);
      return;
    }
  }

  const downloads = join(PACKAGE_ROOT, '.dsh-runtime', 'downloads');
  mkdirSync(downloads, { recursive: true });
  const archivePath = join(downloads, asset.file);
  const uri = assetUrl(asset);

  console.log(`Platform:  ${key} (${asset.target})`);
  console.log(`Asset:     ${asset.file}`);
  console.log(`Source:    ${uri}`);
  console.log(`Target:    ${output}`);

  const { reused } = await downloadPinnedFile(uri, archivePath, asset.sha256);
  console.log(`${reused ? 'Reused verified download' : 'Downloaded and verified'}: ${formatBytes(statSync(archivePath).size)}`);
  assertPinnedFile(archivePath, asset.sha256);

  const staging = join(resolve(output, '..'), `.fetch-latex-${Date.now().toString(36)}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    extractArchive(asset.kind, readFileSync(archivePath), staging);
    const stagedEngine = join(staging, asset.binary);
    if (!isFile(stagedEngine)) {
      throw new Error(`The archive did not contain '${asset.binary}'.`);
    }
    if (process.platform !== 'win32') {
      const { chmodSync } = await import('node:fs');
      chmodSync(stagedEngine, 0o755);
    }

    if (existsSync(output) && force) {
      rmSync(output, { recursive: true, force: true });
    }
    mkdirSync(output, { recursive: true });
    moveWithRetry(stagedEngine, enginePath);

    const binarySha256 = sha256File(enginePath);
    writeFileSync(manifestPath, `${JSON.stringify({
      engine: 'tectonic',
      engineVersion: TECTONIC_VERSION,
      releaseTag: `tectonic@${TECTONIC_VERSION}`,
      platform: key,
      rustTarget: asset.target,
      asset: asset.file,
      archiveSha256: asset.sha256,
      binary: asset.binary,
      binarySha256,
      installedAt: new Date().toISOString()
    }, null, 2)}\n`, 'utf8');

    console.log(`Installed: ${enginePath} (${formatBytes(statSync(enginePath).size)})`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [join(SCRIPT_DIRECTORY, 'verify-runtime.mjs'), output], { stdio: 'inherit' });
  console.log('');
  console.log('Next: warm the TeX resource cache so compiles work offline,');
  console.log(`  node "${join(SCRIPT_DIRECTORY, 'warm-cache.mjs')}"`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
