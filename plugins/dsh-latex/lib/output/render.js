/**
 * Model-facing text for LaTeX tool results.
 *
 * The canonical value stays structured; this is the concise native rendering
 * the model actually reads in the transcript.
 */

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/**
 * @param {Record<string, any>} value
 * @returns {string}
 */
export function renderCompileResult(value) {
  const headline = value.ok
    ? `Compiled ${value.sourceName ?? 'document'} -> ${value.outputPath}`
    : `LaTeX compilation failed for ${value.sourceName ?? 'document'}`;
  const lines = [
    headline,
    `Engine: ${value.engine ?? 'tectonic'} ${value.engineVersion ?? ''}`.trim(),
    `Output: ${value.outputFormat ?? 'pdf'}${value.outputBytes === undefined ? '' : `, ${formatBytes(value.outputBytes)}`}`
      + `${value.pages === undefined ? '' : `, ${value.pages} page(s)`}`
      + ` in ${value.durationMs ?? 0} ms${value.cachedOnly === true ? ' (cached-only)' : ''}`
  ];

  if (value.errors !== undefined && value.errors.length > 0) {
    lines.push('', 'Errors:', ...value.errors.map(error => `  ${error}`));
  }
  if (value.warnings !== undefined && value.warnings.length > 0) {
    lines.push('', 'Warnings:', ...value.warnings.map(warning => `  ${warning}`));
  }
  if (typeof value.overfullBoxes === 'number' && value.overfullBoxes > 0) {
    lines.push('', `Overfull boxes: ${value.overfullBoxes}`);
  }
  if (value.artifacts !== undefined && value.artifacts.length > 0) {
    lines.push('', 'Artifacts:', ...value.artifacts.map(artifact => `  ${artifact}`));
  }
  if (!value.ok && typeof value.logTail === 'string' && value.logTail.length > 0) {
    lines.push('', 'Engine log (tail):', value.logTail);
  }
  return lines.join('\n');
}

/**
 * @param {Record<string, any>} value
 * @returns {string}
 */
export function renderHealthResult(value) {
  const lines = [
    `LaTeX engine: ${value.engine ?? 'tectonic'} (${value.ready ? 'ready' : 'not ready'})`,
    `Version: ${value.engineVersion ?? 'unknown'}`,
    `Binary: ${value.enginePath ?? 'not installed'}`,
    `Runtime: ${value.runtimeDir ?? 'unknown'} (resolved via ${value.origin ?? 'unknown'})`,
    `Bundle cache: ${value.cacheDir} - ${value.cacheFiles ?? 0} file(s), ${formatBytes(value.cacheBytes ?? 0)}`,
    `Offline ready: ${value.warmedUp === true ? 'yes (format cache present)' : 'no (first compile will fetch resources)'}`,
    `Latency: ${value.latencyMs ?? 0} ms`
  ];
  if (typeof value.error === 'string' && value.error.length > 0) {
    lines.push(`Error: ${value.error}`);
  }
  if (value.ready !== true) {
    lines.push('', 'Install the pinned engine with: node <dsh-latex>/scripts/fetch-runtime.mjs');
  }
  return lines.join('\n');
}
