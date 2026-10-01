/**
 * Regression guard: the declared DSH peer ranges must still admit the DSH
 * runtime that is actually installed.
 *
 * DSH 0.2 evaluates every `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`
 * `peerDependencies` range against the running runtime before it mounts a
 * bundle, and skips the bundle when a range does not match. That is exactly how
 * dsh-latex silently disappeared on 0.2.0-rc.2: the code was fine, but the
 * manifest still declared `^0.1.0-rc.6`, so the profile reported "skipping
 * profile bundle dsh-latex" and none of the `latex_*` tools were registered.
 *
 * The test reports a skip instead of a failure when it cannot see a DSH
 * installation (a bare checkout, no `semver`), so `node --test` stays useful
 * outside the harness.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadDshModule, resolveDshModule } from '../../lib/dsh-runtime.js';

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));

/**
 * Read the nearest `package.json` at or above a resolved entry file.
 * @param {string} entry absolute path of a resolved package entry
 * @returns {Record<string, unknown> | undefined}
 */
function nearestPackageJson(entry) {
  let dir = dirname(entry);
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
      // No manifest here; walk up towards the package root.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Version of the installed DSH runtime, or `undefined` when not resolvable.
 *
 * `dsh-app-boot` owns the version the loader compares against, so it is tried
 * first; every other candidate ships from the same release train. The last
 * candidate covers the portable distribution, whose shared `profiles/node_modules`
 * junction farm can outlive the DSH version it was built for.
 * @returns {string | undefined}
 */
function runtimeVersion() {
  for (const specifier of ['@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh', '@deepseek-ai/dsh-tools']) {
    const entry = resolveDshModule(specifier);
    if (entry === undefined) continue;
    const version = nearestPackageJson(entry)?.version;
    if (typeof version === 'string') return version;
  }
  const home = process.env.DSH_HOME;
  if (typeof home === 'string' && home.length > 0) {
    try {
      const portable = JSON.parse(readFileSync(join(home, '..', 'app-npm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'));
      if (typeof portable.version === 'string') return portable.version;
    } catch {
      // Not the portable layout; nothing else to try.
    }
  }
  return undefined;
}

const version = runtimeVersion();
const semverModule = version === undefined ? undefined : await loadDshModule('semver').catch(() => undefined);
/** `semver` is CommonJS: `satisfies` sits either on the namespace or on `default`. */
const semverSatisfies = semverModule?.satisfies ?? semverModule?.default?.satisfies;
const skip = version === undefined
  ? 'no DSH installation is resolvable here'
  : typeof semverSatisfies !== 'function' ? 'the `semver` package is not resolvable here' : false;

test('every DSH peer range admits the installed DSH runtime', { skip }, () => {
  const peers = Object.entries(manifest.peerDependencies ?? {})
    .filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'));
  assert.ok(peers.length > 0, 'the manifest declares at least one DSH peer');
  for (const [name, range] of peers) {
    assert.equal(
      semverSatisfies(version, range, { includePrerelease: true }),
      true,
      `${name}@"${range}" does not admit the installed dsh ${version}; the profile loader would skip this bundle`,
    );
  }
});

test('dsh.engines.dsh admits the installed DSH runtime', { skip }, () => {
  const range = manifest.dsh?.engines?.dsh;
  assert.equal(typeof range, 'string', 'the manifest declares dsh.engines.dsh');
  assert.equal(
    semverSatisfies(version, range, { includePrerelease: true }),
    true,
    `dsh.engines.dsh "${range}" does not admit the installed dsh ${version}`,
  );
});
