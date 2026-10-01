/**
 * The one place `defineTool` is imported from.
 *
 * Tool modules import it from here instead of naming the harness package
 * directly, so a `link:`-installed plugin (real path outside any
 * `node_modules`) resolves it through {@link loadDshModule}. The top-level
 * await is safe: the cordis loader imports plugin entries with `await
 * import(...)`, so the module graph is fully settled before `apply()` runs.
 */
import { loadDshModule } from './dsh-runtime.js';

const tools = await loadDshModule('@deepseek-ai/dsh-tools');

/** Typed tool-definition builder from `@deepseek-ai/dsh-tools`. */
export const defineTool = tools.defineTool;
