import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  defaultRuntimeDir,
  engineFileName,
  locateRuntime,
  platformKey,
  runtimeDirCandidates
} from '../../lib/runtime.js';

/** @param {string} prefix */
function scratch(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('platformKey and engineFileName follow the host conventions', () => {
  assert.equal(platformKey('win32', 'x64'), 'win32-x64');
  assert.equal(platformKey('darwin', 'arm64'), 'darwin-arm64');
  assert.equal(engineFileName('win32'), 'tectonic.exe');
  assert.equal(engineFileName('linux'), 'tectonic');
  assert.equal(engineFileName('darwin'), 'tectonic');
});

test('candidate order prefers the configured runtime, then DSH_HOME, then the package', () => {
  const candidates = runtimeDirCandidates({
    runtimeDir: '/configured',
    env: { DSH_HOME: '/harness', DSH_LATEX_RUNTIME_DIR: '/from-env' },
    platform: 'linux',
    arch: 'x64'
  });
  assert.deepEqual(candidates.map(entry => entry.origin), [
    'configured-runtime',
    'environment',
    'harness-home',
    'package-local'
  ]);
  assert.equal(candidates[0].directory, resolve('/configured'));
  assert.equal(candidates[1].directory, resolve('/from-env'));
  assert.equal(candidates[2].directory, join(resolve('/harness'), 'runtimes', 'latex-runtime-linux-x64'));
});

test('locateRuntime finds an engine in the harness home and derives the cache beside it', () => {
  const home = scratch('dsh-latex-home-');
  try {
    const runtimeDir = join(home, 'runtimes', 'latex-runtime-linux-x64');
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(join(runtimeDir, 'tectonic'), '#!/bin/sh\n');
    const runtime = locateRuntime({ env: { DSH_HOME: home }, platform: 'linux', arch: 'x64' });
    assert.equal(runtime.origin, 'harness-home');
    assert.equal(runtime.enginePath, join(runtimeDir, 'tectonic'));
    assert.equal(runtime.cacheDir, join(runtimeDir, 'cache'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('locateRuntime prefers an explicit enginePath and keeps its directory as the runtime', () => {
  const home = scratch('dsh-latex-engine-');
  try {
    const engine = join(home, 'bin', 'tectonic');
    mkdirSync(join(home, 'bin'), { recursive: true });
    writeFileSync(engine, '#!/bin/sh\n');
    const runtime = locateRuntime({
      enginePath: engine,
      env: { DSH_HOME: join(home, 'ignored') },
      platform: 'linux',
      arch: 'x64'
    });
    assert.equal(runtime.origin, 'configured-engine');
    assert.equal(runtime.enginePath, engine);
    assert.equal(runtime.cacheDir, join(home, 'bin', 'cache'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('locateRuntime reports a search trail when nothing is installed', () => {
  const home = scratch('dsh-latex-empty-');
  try {
    const runtime = locateRuntime({ env: { DSH_HOME: home, PATH: '' }, platform: 'linux', arch: 'x64' });
    assert.equal(runtime.enginePath, undefined);
    assert.equal(runtime.origin, 'none');
    assert.ok(runtime.searched.length >= 2);
    assert.equal(runtime.runtimeDir, join(home, 'runtimes', 'latex-runtime-linux-x64'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('an explicit cacheDir wins over the runtime-local default', () => {
  const home = scratch('dsh-latex-cache-');
  try {
    const runtime = locateRuntime({
      cacheDir: join(home, 'shared-cache'),
      env: { DSH_HOME: home, PATH: '' },
      platform: 'linux',
      arch: 'x64'
    });
    assert.equal(runtime.cacheDir, join(home, 'shared-cache'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('defaultRuntimeDir names the harness home first when one is configured', () => {
  const directory = defaultRuntimeDir({ DSH_HOME: '/harness' }, 'win32', 'x64');
  assert.equal(directory, join(resolve('/harness'), 'runtimes', 'latex-runtime-win32-x64'));
});
