/**
 * dsh-latex — self-contained LaTeX for DeepSeek Harness.
 *
 * Host half. Mounts three tools into `ctx.tools`:
 *
 *   latex_health   is a pinned Tectonic engine installed, and is the TeX
 *                  resource cache warm enough to compile offline?
 *   latex_compile  a `.tex` file or an inline document -> PDF
 *   latex_math     one formula -> tightly cropped PDF
 *
 * The engine itself is not an npm dependency: it is a single pinned binary
 * fetched into `<DSH_HOME>/runtimes/latex-runtime-<platform>-<arch>` by
 * `scripts/fetch-runtime.mjs`, which keeps the package lightweight to clone and
 * rebuild anywhere.
 */
import { resolveConfig } from './lib/config.js';
import { createLatexEngine } from './lib/engine.js';
import { createCompileTool } from './lib/tools/compile.js';
import { createHealthTool } from './lib/tools/health.js';
import { createMathTool } from './lib/tools/math.js';

export const name = 'dsh-latex';
export const inject = ['tools'];

/**
 * Cordis entry point mounted by `cordis.patch.yml`.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} config
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config);
  const logger = ctx.logger('dsh-latex');
  const engine = createLatexEngine(resolved, {
    ...(resolved.debug ? { log: (message, details) => logger.debug(message, details) } : {})
  });

  ctx.tools.register(createHealthTool(engine));
  ctx.tools.register(createCompileTool(engine, resolved));
  ctx.tools.register(createMathTool(engine, resolved));

  const runtime = engine.describe();
  logger.info(
    runtime.enginePath === undefined
      ? 'LaTeX tools mounted, but the Tectonic engine is not installed yet; run scripts/fetch-runtime.mjs.'
      : `LaTeX tools mounted with ${runtime.enginePath} (cache: ${runtime.cacheDir}).`
  );
}

export { resolveConfig } from './lib/config.js';
export { createLatexEngine, buildCompileArgs, parseTexLog } from './lib/engine.js';
export { locateRuntime, platformKey, engineFileName } from './lib/runtime.js';
export { LatexError, LATEX_ERROR_CODES } from './lib/errors.js';
