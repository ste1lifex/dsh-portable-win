#!/usr/bin/env node
/**
 * Verify an installed Tectonic runtime.
 *
 *   node scripts/verify-runtime.mjs [runtime-directory]
 *
 * Fails closed (non-zero exit) when the binary is missing, its recorded
 * SHA-256 no longer matches, or it cannot report the pinned version. The
 * portable launcher runs this before starting the harness so a corrupted
 * runtime is repaired instead of silently breaking every compile.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256File } from './lib/download.mjs';
import { TECTONIC_VERSION, assetFor } from './lib/manifest.mjs';
import { defaultRuntimeDir, engineFileName } from '../lib/runtime.js';

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

function main() {
  const output = resolve(process.argv[2] ?? defaultRuntimeDir());
  const binaryName = existsSync(join(output, 'tectonic.exe')) ? 'tectonic.exe' : engineFileName();
  const enginePath = join(output, binaryName);
  const manifestPath = join(output, 'manifest.json');

  if (!isFile(enginePath)) {
    throw new Error(`Tectonic engine missing: ${enginePath}`);
  }

  if (isFile(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (typeof manifest.binarySha256 === 'string') {
      const actual = sha256File(enginePath);
      if (actual !== manifest.binarySha256) {
        throw new Error(`Engine binary changed since installation: expected ${manifest.binarySha256}, received ${actual}.`);
      }
    }
    if (typeof manifest.engineVersion === 'string' && manifest.engineVersion !== TECTONIC_VERSION) {
      throw new Error(`Runtime manifest records Tectonic ${manifest.engineVersion}, this plugin pins ${TECTONIC_VERSION}.`);
    }
  }

  let reported;
  try {
    reported = execFileSync(enginePath, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(`The engine at ${enginePath} could not be executed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const match = /Tectonic\s+([0-9][^\s]*)/i.exec(reported);
  if (match === null) {
    throw new Error(`Unexpected --version output: ${reported.trim()}`);
  }
  if (match[1] !== TECTONIC_VERSION) {
    throw new Error(`Engine reports Tectonic ${match[1]}, this plugin pins ${TECTONIC_VERSION}.`);
  }

  // Confirms the asset table still describes this machine, which catches a
  // runtime copied from another platform.
  assetFor(process.platform, process.arch);

  console.log(`Tectonic ${match[1]} verified at ${enginePath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
