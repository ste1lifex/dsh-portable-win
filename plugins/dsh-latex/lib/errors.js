/**
 * Structured failures for dsh-latex.
 *
 * Every rejection that the model is supposed to act on carries a stable
 * `code`, so the tool result reads as `Error: <CODE>: <message>` instead of an
 * opaque stack trace. Anything else propagates unchanged and is reported as an
 * ordinary tool failure.
 */

export const LATEX_ERROR_CODES = Object.freeze({
  /** The pinned Tectonic engine could not be found or executed. */
  ENGINE_MISSING: 'LATEX_ENGINE_MISSING',
  /** The engine ran but the document did not compile. */
  COMPILE_FAILED: 'LATEX_COMPILE_FAILED',
  /** The engine exceeded its deadline and was terminated. */
  TIMEOUT: 'LATEX_TIMEOUT',
  /** The call was cancelled by the caller. */
  ABORTED: 'LATEX_ABORTED',
  /** Argument combination is unusable (missing source, both sources, ...). */
  BAD_REQUEST: 'LATEX_BAD_REQUEST',
  /** Requested path is outside every authorized root. */
  FILE_ACCESS_DENIED: 'LATEX_FILE_ACCESS_DENIED',
  /** Requested source file does not exist. */
  FILE_NOT_FOUND: 'LATEX_FILE_NOT_FOUND',
  /** Source or output exceeds the configured size limit. */
  FILE_TOO_LARGE: 'LATEX_FILE_TOO_LARGE',
  /** The engine finished without producing the requested output. */
  OUTPUT_MISSING: 'LATEX_OUTPUT_MISSING'
});

export class LatexError extends Error {
  /**
   * @param {string} code stable machine-readable code from {@link LATEX_ERROR_CODES}
   * @param {string} message operator-facing explanation
   * @param {{ detail?: string, logTail?: string }} [extra] bounded diagnostics
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'LatexError';
    this.code = code;
    if (extra.detail !== undefined) this.detail = extra.detail;
    if (extra.logTail !== undefined) this.logTail = extra.logTail;
  }
}

/** @param {unknown} error */
export function isLatexError(error) {
  return error instanceof LatexError;
}
