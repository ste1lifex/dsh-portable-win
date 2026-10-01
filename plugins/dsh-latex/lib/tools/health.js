/**
 * `latex_health` — is a LaTeX engine actually installed and warmed up?
 *
 * The model calls this before promising a PDF, and an operator calls it to
 * check whether the pinned runtime needs fetching.
 */
import { defineTool } from '../define-tool.js';
import { asHarnessError } from '../harness-error.js';
import { renderHealthResult } from '../output/render.js';

export const HEALTH_OUTPUT = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    ready: { type: 'boolean', required: true },
    engine: { type: 'string' },
    enginePath: { type: 'string' },
    engineVersion: { type: 'string' },
    runtimeDir: { type: 'string' },
    cacheDir: { type: 'string' },
    cacheFiles: { type: 'integer' },
    cacheBytes: { type: 'integer' },
    warmedUp: { type: 'boolean' },
    origin: { type: 'string' },
    offline: { type: 'boolean' },
    latencyMs: { type: 'integer', required: true },
    error: { type: 'string' }
  }
});

/**
 * @param {ReturnType<import('../engine.js').createLatexEngine>} engine
 */
export function createHealthTool(engine) {
  return defineTool({
    name: 'latex_health',
    description: 'Check whether the self-contained Tectonic LaTeX engine and its local TeX resource cache are ready, and where they live.',
    parameters: {},
    output: {
      schema: HEALTH_OUTPUT,
      render: (_args, value) => [{ type: 'text', text: renderHealthResult(value) }]
    },
    async execute(_args, exec) {
      try {
        return await engine.health(exec.signal);
      } catch (error) {
        return asHarnessError(error);
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Check LaTeX engine', kind: 'read' })
  });
}
