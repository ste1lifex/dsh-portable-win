/**
 * `latex_math` — a cropped PDF of one formula.
 *
 * Typesetting a single equation through the full `latex_compile` path means
 * writing a preamble by hand every time. This tool wraps the snippet in the
 * `standalone` class with the `varwidth` option, so the page is cropped to the
 * formula and the result can be dropped straight into a slide or a paper.
 */
import { defineTool } from '../define-tool.js';
import { LATEX_ERROR_CODES, LatexError } from '../errors.js';
import { asHarnessError } from '../harness-error.js';
import { renderCompileResult } from '../output/render.js';
import { COMPILE_OUTPUT, COMPILE_PARAMETERS, runCompileJob, safeStem } from './shared.js';

/** Packages the math template always loads. */
const BASE_PACKAGES = ['amsmath', 'amssymb', 'amsfonts'];
/** A TeX package name, as accepted by `\usepackage{...}`. */
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Build the standalone document for one formula. Exported for unit tests.
 *
 * @param {{ expression: string, display?: boolean, packages?: string[], borderPt?: number }} request
 * @returns {string}
 */
export function buildMathDocument(request) {
  const border = Number.isSafeInteger(request.borderPt) && request.borderPt >= 0 ? request.borderPt : 2;
  const extra = (request.packages ?? []).filter(name => PACKAGE_NAME.test(name));
  const packages = [...new Set([...BASE_PACKAGES, ...extra])];
  const body = request.display === false ? `$${request.expression}$` : `$\\displaystyle ${request.expression}$`;
  return [
    `\\documentclass[border=${border}pt,varwidth]{standalone}`,
    ...packages.map(name => `\\usepackage{${name}}`),
    '\\begin{document}',
    body,
    '\\end{document}',
    ''
  ].join('\n');
}

/**
 * @param {ReturnType<import('../engine.js').createLatexEngine>} engine
 * @param {ReturnType<import('../config.js').resolveConfig>} config
 */
export function createMathTool(engine, config) {
  return defineTool({
    name: 'latex_math',
    description: 'Typeset one LaTeX math expression into a tightly cropped PDF using the bundled Tectonic engine, with amsmath/amssymb preloaded.',
    parameters: {
      expression: {
        type: 'string',
        required: true,
        description: 'The math expression only, without $ delimiters, for example \\int_0^\\infty e^{-x^2}\\,dx=\\frac{\\sqrt{\\pi}}{2}.'
      },
      display: {
        type: 'boolean',
        description: 'Render in display style (default true) or inline style.'
      },
      packages: {
        type: 'array',
        items: { type: 'string' },
        description: 'Extra packages to load, for example ["physics"] or ["bm"].'
      },
      border_pt: {
        type: 'integer',
        description: 'Crop border in points. Defaults to 2.'
      },
      output_name: {
        type: 'string',
        description: 'Base name (without extension) for the result. Defaults to math.'
      },
      ...COMPILE_PARAMETERS
    },
    output: {
      schema: COMPILE_OUTPUT,
      render: (_args, value) => [{ type: 'text', text: renderCompileResult(value) }]
    },
    async execute(args, exec) {
      try {
        const expression = args.expression.trim();
        if (expression === '') {
          throw new LatexError(LATEX_ERROR_CODES.BAD_REQUEST, 'expression must contain a LaTeX math snippet.');
        }
        const invalid = (args.packages ?? []).filter(name => !PACKAGE_NAME.test(name));
        if (invalid.length > 0) {
          throw new LatexError(
            LATEX_ERROR_CODES.BAD_REQUEST,
            `Not a usable TeX package name: ${invalid.join(', ')}. Pass bare names such as "physics".`
          );
        }

        const workingDirectory = exec.agent?.session.header.cwd ?? process.cwd();
        return await runCompileJob({
          engine,
          config,
          source: {
            kind: 'inline',
            text: buildMathDocument({
              expression,
              display: args.display,
              packages: args.packages,
              borderPt: args.border_pt
            })
          },
          stem: safeStem(args.output_name, 'math'),
          defaultOutputDirectory: workingDirectory,
          outputPath: args.output_path,
          outputFormat: args.output_format,
          offline: args.offline,
          keepIntermediates: args.keep_intermediates ?? config.keepIntermediates,
          synctex: args.synctex,
          reruns: args.reruns,
          timeoutMs: args.timeout_ms,
          searchPaths: args.search_paths,
          workingDirectory,
          signal: exec.signal
        });
      } catch (error) {
        return asHarnessError(error);
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Typeset math',
      kind: 'execute',
      rawInput: args.expression
    })
  });
}
