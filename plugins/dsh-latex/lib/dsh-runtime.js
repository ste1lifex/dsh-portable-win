/**
 * Resolve DSH host packages from wherever this plugin happens to be installed.
 *
 * A published plugin (`dsh-doc` style) lives inside the profile's
 * `node_modules`, so a plain `import '@deepseek-ai/dsh-tools'` works. A plugin
 * that is *linked* into the profile (`"dsh-latex": "link:../../plugins/dsh-latex"`)
 * keeps its real path outside `node_modules`, and Node resolves bare
 * specifiers from the importing file's real directory — which walks up to the
 * repository root and finds nothing.
 *
 * Rather than depending on how the harness mounted us, try the normal
 * resolution first and then fall back to the profile roots that `DSH_HOME`
 * names. That keeps the package self-contained: clone, link, start, done.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const loaded = new Map();

/**
 * Directories that may hold the harness' own packages, most specific first.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function dshModuleRoots(env = process.env) {
  const roots = [];
  if (typeof env.DSH_HOME === 'string' && env.DSH_HOME.length > 0) {
    roots.push(join(env.DSH_HOME, 'profiles', 'node_modules'));
    roots.push(join(env.DSH_HOME, 'profiles', 'web', 'node_modules'));
  }
  return roots;
}

/**
 * Resolve a package to its entry file, or `undefined` when it is genuinely
 * absent (never throws for the ordinary "not installed here" case).
 *
 * @param {string} specifier
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {string | undefined}
 */
export function resolveDshModule(specifier, options = {}) {
  try {
    return require.resolve(specifier);
  } catch {
    // Not installed next to the plugin; fall through to the harness home.
  }
  for (const root of dshModuleRoots(options.env ?? process.env)) {
    try {
      return require.resolve(specifier, { paths: [root] });
    } catch {
      // Try the next candidate root.
    }
  }
  return undefined;
}

/**
 * Import a DSH host package exactly once per process.
 *
 * @param {string} specifier
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadDshModule(specifier, options = {}) {
  const cached = loaded.get(specifier);
  if (cached !== undefined) return cached;
  const resolved = resolveDshModule(specifier, options);
  if (resolved === undefined) {
    throw new Error(
      `dsh-latex could not resolve the DeepSeek Harness package '${specifier}'. `
      + 'Install dsh-latex as a regular dependency of the active DSH profile, or start the harness '
      + 'through its launcher so DSH_HOME points at the harness home.'
    );
  }
  const namespace = await import(pathToFileURL(resolved).href);
  loaded.set(specifier, namespace);
  return namespace;
}
