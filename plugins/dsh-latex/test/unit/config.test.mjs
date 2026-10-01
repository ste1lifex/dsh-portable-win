import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONFIG_DEFAULTS, resolveConfig } from '../../lib/config.js';

test('resolveConfig supplies documented defaults for an empty entry', () => {
  const config = resolveConfig(undefined);
  assert.equal(config.offline, false);
  assert.equal(config.untrusted, true, 'documents are untrusted unless stated otherwise');
  assert.equal(config.allowShellEscape, false);
  assert.equal(config.allowWorkspaceFiles, true);
  assert.deepEqual(config.allowedLocalRoots, []);
  assert.equal(config.defaultTimeoutMs, CONFIG_DEFAULTS.defaultTimeoutMs);
});

test('resolveConfig ignores malformed values instead of throwing at mount time', () => {
  const config = resolveConfig({
    defaultTimeoutMs: -5,
    maxTimeoutMs: 'soon',
    maxSourceBytes: 1.5,
    allowedLocalRoots: ['/ok', 42, '', '/also-ok'],
    offline: 'yes',
    untrusted: 'no'
  });
  assert.equal(config.defaultTimeoutMs, CONFIG_DEFAULTS.defaultTimeoutMs);
  assert.equal(config.maxTimeoutMs, CONFIG_DEFAULTS.maxTimeoutMs);
  assert.equal(config.maxSourceBytes, CONFIG_DEFAULTS.maxSourceBytes);
  assert.deepEqual(config.allowedLocalRoots, ['/ok', '/also-ok']);
  assert.equal(config.offline, false);
  assert.equal(config.untrusted, true);
});

test('resolveConfig honours explicit operator choices', () => {
  const config = resolveConfig({
    enginePath: '/opt/tectonic',
    runtimeDir: '/srv/latex',
    cacheDir: '/srv/cache',
    offline: true,
    untrusted: false,
    allowShellEscape: true,
    keepIntermediates: true,
    allowWorkspaceFiles: false,
    defaultTimeoutMs: 30_000,
    maxTimeoutMs: 60_000,
    debug: true
  });
  assert.equal(config.enginePath, '/opt/tectonic');
  assert.equal(config.runtimeDir, '/srv/latex');
  assert.equal(config.cacheDir, '/srv/cache');
  assert.equal(config.offline, true);
  assert.equal(config.untrusted, false);
  assert.equal(config.allowShellEscape, true);
  assert.equal(config.keepIntermediates, true);
  assert.equal(config.allowWorkspaceFiles, false);
  assert.equal(config.defaultTimeoutMs, 30_000);
  assert.equal(config.debug, true);
});

test('resolveConfig treats blank strings as absent', () => {
  const config = resolveConfig({ enginePath: '   ', runtimeDir: '' });
  assert.equal(config.enginePath, undefined);
  assert.equal(config.runtimeDir, undefined);
});
