/**
 * Bridge plugin failures onto the harness' structured error type.
 *
 * `HarnessError` gives a tool result a stable, machine-routable `code` while
 * keeping the human-readable message. It is loaded through the same resolver
 * as `defineTool`; when the harness package is unavailable the plugin still
 * works, it just reports plain `Error`s.
 */
import { isLatexError } from './errors.js';
import { loadDshModule } from './dsh-runtime.js';

/** @type {typeof Error | undefined} */
let HarnessError;

try {
  const llm = await loadDshModule('@deepseek-ai/dsh-llm');
  if (typeof llm.HarnessError === 'function') {
    HarnessError = /** @type {typeof Error} */ (llm.HarnessError);
  }
} catch {
  HarnessError = undefined;
}

/**
 * Re-throw a {@link LatexError} as a harness error; anything else propagates
 * unchanged so the registry's own classification still applies.
 *
 * @param {unknown} error
 * @returns {never}
 */
export function asHarnessError(error) {
  if (isLatexError(error)) {
    const code = /** @type {import('./errors.js').LatexError} */ (error).code;
    if (HarnessError !== undefined) {
      throw new HarnessError(error.message, code, { cause: error });
    }
    throw new Error(`${code}: ${error.message}`, { cause: error });
  }
  throw error;
}
