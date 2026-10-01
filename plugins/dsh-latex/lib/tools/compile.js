/**
 * `latex_compile` — turn a `.tex` source (file or inline) into a PDF.
 *
 * Exactly one of `source_path` / `source` must be supplied: a path when the
 * document already exists in the workspace, inline text for a document the
 * model is generating right now.
 */
import { dirname, resolve } from 'node:path';
import { defineTool } from '../define-tool.js';
import { LATEX_ERROR_CODES, LatexError } from '../errors.js';
import { asHarnessError } from '../harness-error.js';
import { renderCompileResult } from '../output/render.js';
import { COMPILE_OUTPUT, COMPILE_PARAMETERS, runCompileJob, safeStem } from './shared.js';

/**
 * @param {ReturnType<import('../engine.js').createLatexEngine>} engine
 * @param {ReturnType<import('../config.js').resolveConfig>} config
 */
export function createCompileTool(engine, config) {
  return defineTool({
    name: 'latex_compile',
    description: 'Compile a LaTeX document to PDF with the bundled Tectonic engine (no system TeX required). Provide either source_path (an existing .tex file) or source (inline LaTeX text).',
    parameters: {
      source_path: {
        type: 'string',
        description: 'Path to an existing .tex file inside the session workspace or allowedLocalRoots. Mutually exclusive with source.'
      },
      source: {
        type: 'string',
        description: 'Inline LaTeX source for the whole document, including \\documentclass. Mutually exclusive with source_path.'
      },
      output_name: {
        type: 'string',
        description: 'Base name (without extension) for the result when compiling inline source. Defaults to document.'
      },
      ...COMPILE_PARAMETERS
    },
    output: {
      schema: COMPILE_OUTPUT,
      render: (_args, value) => [{ type: 'text', text: renderCompileResult(value) }]
    },
    async execute(args, exec) {
      try {
        const hasPath = typeof args.source_path === 'string' && args.source_path.trim().length > 0;
        const hasSource = typeof args.source === 'string' && args.source.trim().length > 0;
        if (hasPath === hasSource) {
          throw new LatexError(
            LATEX_ERROR_CODES.BAD_REQUEST,
            'Provide exactly one of source_path (an existing .tex file) or source (inline LaTeX text).'
          );
        }

        const workingDirectory = exec.agent?.session.header.cwd ?? process.cwd();
        const requestedOutput = args.output_path;
        const common = {
          engine,
          config,
          outputPath: requestedOutput,
          outputFormat: args.output_format,
          offline: args.offline,
          keepIntermediates: args.keep_intermediates ?? config.keepIntermediates,
          synctex: args.synctex,
          reruns: args.reruns,
          timeoutMs: args.timeout_ms,
          searchPaths: args.search_paths,
          workingDirectory,
          signal: exec.signal
        };

        if (hasPath) {
          const absoluteSource = resolve(workingDirectory, args.source_path);
          const sourceStem = safeStem(stripTexExtension(args.source_path), 'document');
          return await runCompileJob({
            ...common,
            source: { kind: 'file', path: args.source_path },
            stem: safeStem(args.output_name, sourceStem),
            defaultOutputDirectory: dirname(absoluteSource)
          });
        }

        return await runCompileJob({
          ...common,
          source: { kind: 'inline', text: args.source },
          stem: safeStem(args.output_name, 'document'),
          defaultOutputDirectory: workingDirectory
        });
      } catch (error) {
        return asHarnessError(error);
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Compile ${args.source_path ?? 'inline LaTeX'}`,
      kind: 'execute',
      rawInput: args.source_path ?? args.source
    })
  });
}

/**
 * @param {string} value
 * @returns {string}
 */
function stripTexExtension(value) {
  const name = value.replace(/\\/g, '/').split('/').pop() ?? value;
  return name.replace(/\.tex$/i, '');
}
