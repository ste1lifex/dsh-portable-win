#!/usr/bin/env node
/**
 * Warm the Tectonic resource cache so compiles work with no network.
 *
 *   node scripts/warm-cache.mjs [--profile=minimal|common|chinese|full] [--runtime=<dir>] [--check]
 *
 * Tectonic fetches only the TeX Live files a document actually needs, lazily,
 * into `TECTONIC_CACHE_DIR`. Warming the cache compiles a few representative
 * documents once so those files are already local; afterwards `--only-cached`
 * (and the plugin's `offline: true` config) can compile without any network
 * access at all.
 *
 * This is the step that turns "self-contained" from a claim into an offline
 * capability. It is optional: without it the first compile simply downloads.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { locateRuntime } from '../lib/runtime.js';

/**
 * Packages warmed for every profile: the plain Latin document path, plus the
 * two the bundled `latex_math` template needs (`standalone` with `varwidth`).
 */
export const BASELINE = ['amsmath', 'amssymb', 'graphicx', 'hyperref', 'xcolor', 'geometry', 'standalone', 'varwidth'];
/**
 * Body that makes the engine resolve every font shape a normal article uses.
 * A document that is only "hello" caches far less than it appears to: section
 * headings, footnotes, captions, tables and *bold math* each pull their own
 * font files (`cmbx10.tfm` and friends), and `--only-cached` compiles fail on
 * whichever one is missing.
 */
export const BASELINE_BODY = [
  '\\title{Warm-up}\\author{DeepSeek Harness}\\maketitle',
  '\\tableofcontents',
  '\\section{Section}\\subsection{Subsection}\\subsubsection{Subsubsection}',
  'Text with \\textbf{bold}, \\textit{italic}, \\texttt{mono}, \\textsc{Small Caps}, and a note\\footnote{note}.',
  '\\begin{itemize}\\item first\\item second\\end{itemize}',
  '\\begin{enumerate}\\item first\\item second\\end{enumerate}',
  'Inline $E = mc^2$ and display:',
  '\\begin{equation}\\int_0^\\infty e^{-x^2}\\,dx=\\frac{\\sqrt{\\pi}}{2}\\end{equation}',
  // Bold and bold-symbol math pull cmbx10/cmbsy10, which a plain formula never asks for.
  'Bold math: $\\mathbf{A}\\boldsymbol{\\beta}\\mathcal{L}\\mathbb{R}\\mathfrak{g}$ and',
  '\\begin{equation}\\boldsymbol{\\nabla}\\times\\mathbf{B}=\\mu_0\\mathbf{J}\\end{equation}',
  '\\begin{table}[h]\\centering',
  '\\begin{tabular}{ll}\\hline a & b \\\\ c & d \\\\\\hline\\end{tabular}',
  '\\caption{A table}\\end{table}',
  '\\begin{verbatim}verbatim\\end{verbatim}',
  '\\begin{quote}quoted\\end{quote}'
].join('\n');

/**
 * Class options to warm. `size10.clo` and `size11.clo` are different files, and
 * a cache holding only one cannot compile the other offline.
 */
const BASELINE_CLASS_OPTIONS = ['11pt', '10pt'];

/**
 * The exact shape `latex_math` emits. `standalone` is a *class*, so loading the
 * `standalone` package in the article warm-up does not cache `standalone.cls`.
 * Bold symbols are included because `\boldsymbol` pulls `cmbsy10`/`cmbx10`.
 */
function mathTemplateDocument() {
  return [
    '\\documentclass[border=2pt,varwidth]{standalone}',
    '\\usepackage{amsmath}',
    '\\usepackage{amssymb}',
    '\\usepackage{amsfonts}',
    '\\begin{document}',
    '$\\displaystyle \\int_0^\\infty e^{-x^2}\\,dx=\\frac{\\sqrt{\\pi}}{2}$',
    '\\quad$\\boldsymbol{\\nabla}\\times\\mathbf{B}=\\mu_0\\mathbf{J}$',
    '\\end{document}',
    ''
  ].join('\n');
}

/**
 * Every text size a normal document can switch to, plus the math that goes with
 * it.
 *
 * This exists because `BASELINE_BODY` only ever sets text at the class's own
 * size. Computer Modern ships *separate physical fonts per design size*
 * (`cmr10.pfb`, `cmmi7.pfb`, `cmsy9.pfb`, `cmex9.pfb`, ...), so a cache warmed
 * only at 10/11pt is missing the 9pt and 8pt families entirely — and Tectonic
 * resolves `\small`, `\footnotesize` and footnote math lazily, per document.
 * The result was an offline cache that compiled the warm-up documents but died
 * on ordinary documents with `Cannot proceed without .vf or "physical" font`.
 *
 * Nested scripts (`x^{y^{z}}`) and the `\big`-family delimiters are included
 * on purpose: they pull the smallest `cmex`/`cmmi` sizes, which are otherwise
 * never requested.
 */
export const SIZE_COVERAGE_BODY = [
  '{\\tiny tiny text $\\gamma$}\\par',
  '{\\scriptsize scriptsize text $\\beta_2$}\\par',
  '{\\footnotesize footnotesize text $\\int_0^1 f(x)\\,dx$}\\par',
  '{\\small small text at 9pt $\\alpha\\beta\\gamma$ and $\\sum_{i=1}^{n} x_i$}\\par',
  '{\\normalsize normalsize text}\\par',
  '{\\large large text $\\alpha$}\\par',
  '{\\Large Large text}\\par',
  '{\\LARGE LARGE text}\\par',
  '{\\huge huge text}\\par',
  'Normal size with a note\\footnote{A footnote holding math $\\alpha=\\beta$ and 9pt text.}',
  'Nested scripts and big delimiters:',
  '\\[ \\left( x^{y^{z}} \\right) \\quad \\bigl(\\alpha^{\\beta^{\\gamma}}\\bigr) \\]',
  '{\\small\\begin{center}\\begin{tabular}{ll}\\hline',
  'a & $x^2+y^2$ \\\\ b & $\\alpha_9$ \\\\\\hline',
  '\\end{tabular}\\end{center}}',
  '{\\small Text-mode bold \\textbf{bold at nine} and italic \\textit{italic at nine}.}'
].join('\n');

/**
 * The size-coverage document, also used as the offline self-check that proves
 * the 9pt/8pt font families really are cached.
 */
function sizeCoverageDocument() {
  return documentFor(BASELINE, SIZE_COVERAGE_BODY, '10pt');
}

/**
 * Extra document classes a profile needs. Classes are separate files from the
 * same-named packages, so `\usepackage{ctex}` does not cache `ctexart.cls`.
 * The body matters just as much: ctex pulls its CJK font files (Fandol) only
 * once real glyphs are typeset, and the fandol fontset maps `\ttfamily` to
 * `FandolFang-Regular`, so `\texttt` has to appear in the warm-up too.
 *
 * @type {Record<string, { name: string, body: string }[]>}
 */
const PROFILE_CLASSES = {
  minimal: [],
  common: [],
  chinese: [{
    name: 'ctexart',
    body: '\\section{章节标题}中文排版预热：\\textbf{粗体}\\textit{斜体}\\texttt{等宽}\\textsf{无衬线}\\emph{强调}，公式 $\\mathbf{A}\\boldsymbol{\\beta}$，脚注\\footnote{注}。'
  }],
  full: [
    {
      name: 'ctexart',
      body: '\\section{章节标题}中文排版预热：\\textbf{粗体}\\textit{斜体}\\texttt{等宽}\\textsf{无衬线}，公式 $\\mathbf{A}\\boldsymbol{\\beta}$。'
    },
    {
      name: 'beamer',
      body: '\\begin{frame}{Frame}\\begin{itemize}\\item one\\item $\\mathbf{A}\\boldsymbol{\\beta}$\\end{itemize}\\end{frame}'
    }
  ]
};

/**
 * @param {string} className
 * @param {string[]} packages
 * @param {string} body
 * @returns {string}
 */
function classDocument(className, packages, body) {
  return [
    `\\documentclass{${className}}`,
    ...packages.map(name => `\\usepackage{${name}}`),
    '\\begin{document}',
    body,
    '\\end{document}',
    ''
  ].join('\n');
}

/** Package groups, smallest useful set first. */
const PROFILES = {
  minimal: ['amsmath', 'amssymb', 'amsfonts', 'graphicx', 'geometry', 'xcolor'],
  common: [
    'amsmath', 'amssymb', 'amsfonts', 'mathtools', 'bm', 'graphicx', 'geometry', 'xcolor',
    'hyperref', 'booktabs', 'array', 'longtable', 'tabularx', 'multirow', 'makecell',
    'enumitem', 'caption', 'subcaption', 'float', 'fancyhdr', 'titlesec', 'setspace',
    'parskip', 'microtype', 'listings', 'verbatim', 'ulem', 'soul', 'xspace', 'etoolbox',
    'ifthen', 'calc', 'textcomp', 'lmodern', 'csquotes'
  ],
  chinese: [
    'ctex', 'amsmath', 'amssymb', 'mathtools', 'bm', 'graphicx', 'geometry', 'xcolor',
    'hyperref', 'booktabs', 'array', 'longtable', 'tabularx', 'multirow', 'enumitem',
    'caption', 'float', 'fancyhdr', 'titlesec', 'setspace', 'listings', 'xeCJK'
  ],
  full: [
    'ctex', 'amsmath', 'amssymb', 'amsfonts', 'mathtools', 'bm', 'physics', 'siunitx',
    'graphicx', 'geometry', 'xcolor', 'hyperref', 'booktabs', 'array', 'longtable',
    'tabularx', 'multirow', 'makecell', 'enumitem', 'caption', 'subcaption', 'float',
    'fancyhdr', 'titlesec', 'setspace', 'parskip', 'microtype', 'listings', 'ulem',
    'etoolbox', 'lmodern', 'csquotes', 'cleveref', 'algorithm2e', 'algorithmicx',
    'algpseudocode', 'tikz', 'pgfplots', 'circuitikz', 'chemfig', 'mhchem',
    'threeparttable', 'adjustbox', 'wrapfig', 'appendix', 'tocloft', 'pdfpages',
    'datetime2', 'glossaries', 'nomencl', 'biblatex'
  ]
};

/**
 * The Computer Modern / AMS families the bakoma Type 1 tree actually ships.
 * Restricting the `.pfb` hunt to these prefixes keeps the completion step
 * honest: families such as `lcircle10`, `line10` and `pzdr` have a cached
 * `.tfm` but no standalone outline anywhere (Tectonic synthesises them), so
 * treating them as fetchable gaps would report the same false failures on every
 * warm-up run.
 */
const CM_PFB_FAMILIES = ['cmbsy', 'cmbx', 'cmcsc', 'cmdunh', 'cmex', 'cmmi', 'cmmib', 'cmr', 'cmss', 'cmssbx', 'cmssdc', 'cmssi', 'cmsy', 'cmtex', 'cmti', 'cmtt', 'eufm', 'eufb', 'eurm', 'msam', 'msbm'];

/**
 * Where the two font trees this plugin needs actually live on CTAN. The
 * bakoma tree holds the Computer Modern / AMS Type 1 fonts in one flat
 * directory; Latin Modern ships its OpenType fonts in a second one.
 */
const CTAN_CM_PFB = 'https://mirrors.tuna.tsinghua.edu.cn/CTAN/fonts/cm/ps-type1/bakoma/pfb';
const CTAN_LM_OTF = 'https://mirrors.tuna.tsinghua.edu.cn/CTAN/fonts/lm/fonts/opentype/public/lm';

/**
 * `\UnicodeFontFile{name}` names the OpenType file behind a TU-encoded font
 * shape, which makes the `.fd` files a precise inventory of what the text path
 * needs — far better than guessing sizes.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function unicodeFontNames(text) {
  return [...text.matchAll(/\\UnicodeFontFile\{([^}]+)\}/g)].map(match => match[1]);
}

/**
 * Physical font files this cache is missing.
 *
 * Two independent gaps are covered, because warming alone reliably leaves both:
 *
 *  - **Unicode (`.otf`) fonts.** `\texttt` / `\textsf` / bold at a small size
 *    only resolve when the matching `.otf` is cached, and a warm-up that
 *    happens to use one design size caches only that size (`lmroman9-regular`
 *    without `lmroman9-bold`). The `.fd` files list every shape, so they are
 *    read back and diffed.
 *  - **Type 1 (`.pfb`) fonts.** Warming tends to pull the `.tfm` metrics of the
 *    Computer Modern family without the matching `.pfb` outline, and then
 *    xdvipdfmx aborts with `Cannot proceed without .vf or "physical" font`.
 *    Any `.tfm` with no `.pfb`, no `.otf` and no `.vf` is treated as a gap.
 *
 * @param {string} dataDir the bundle's flat resource directory inside the cache
 * @returns {Promise<{ otf: string[], pfb: string[] }>}
 */
export async function findMissingFontFiles(dataDir) {
  const present = new Set(await readdir(dataDir).catch(() => []));

  const fdFiles = [...present].filter(name => name.startsWith('tu') && name.endsWith('.fd'));
  const otf = new Set();
  for (const name of fdFiles) {
    const text = await readFile(join(dataDir, name), 'utf8').catch(() => '');
    for (const font of unicodeFontNames(text)) {
      if (!present.has(`${font}.otf`)) otf.add(font);
    }
  }

  const pfb = [];
  for (const name of present) {
    if (!name.endsWith('.tfm')) continue;
    const stem = name.slice(0, -'.tfm'.length);
    if (present.has(`${stem}.pfb`) || present.has(`${stem}.otf`) || present.has(`${stem}.vf`)) continue;
    if (!CM_PFB_FAMILIES.some(family => stem.startsWith(family))) continue;
    pfb.push(stem);
  }

  return { otf: [...otf].sort(), pfb: pfb.sort() };
}

/**
 * @param {string} url
 * @param {string} destination
 * @returns {Promise<boolean>}
 */
async function download(url, destination) {
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    const bytes = Buffer.from(await response.arrayBuffer());
    // A mirror that answers with an HTML error page must not be cached as a font.
    if (bytes.byteLength < 512) return false;
    await writeFile(destination, bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fill the physical-font gaps the warm-up left behind.
 *
 * This is what makes the warming step reproducible on a fresh machine: the
 * warm-up documents decide which *metrics* are cached, and this step makes sure
 * every physical font those metrics reference is actually present. It needs the
 * network, so a failure is reported and survived — the offline check that runs
 * afterwards is the thing that decides whether the cache is usable.
 *
 * @param {string} cacheDir
 * @param {{ log?: (message: string) => void }} [options]
 * @returns {Promise<{ otf: number, pfb: number, failed: string[] }>}
 */
export async function completeFontFiles(cacheDir, options = {}) {
  const log = options.log ?? (() => {});
  const dataRoot = join(cacheDir, 'bundles', 'data');
  const bundleDirs = await readdir(dataRoot, { withFileTypes: true }).catch(() => []);
  const dataDir = bundleDirs.find(entry => entry.isDirectory());
  if (dataDir === undefined) {
    log('No bundle data directory found; skipping physical-font completion.');
    return { otf: 0, pfb: 0, failed: [] };
  }
  const directory = join(dataRoot, dataDir.name);

  const missing = await findMissingFontFiles(directory);
  if (missing.otf.length === 0 && missing.pfb.length === 0) {
    log('Physical fonts: complete.');
    return { otf: 0, pfb: 0, failed: [] };
  }

  let otf = 0;
  let pfb = 0;
  const failed = [];
  for (const name of missing.otf) {
    if (await download(`${CTAN_LM_OTF}/${name}.otf`, join(directory, `${name}.otf`))) otf += 1;
    else failed.push(`${name}.otf`);
  }
  for (const name of missing.pfb) {
    if (await download(`${CTAN_CM_PFB}/${name}.pfb`, join(directory, `${name}.pfb`))) pfb += 1;
    else failed.push(`${name}.pfb`);
  }

  log(`Physical fonts: fetched ${otf} .otf and ${pfb} .pfb.`);
  if (failed.length > 0) {
    // A handful of names legitimately have no standalone outline (Tectonic
    // synthesises them), so this is a note rather than a failure.
    log(`No downloadable outline for ${failed.length} name(s): ${failed.join(', ')}`);
  }
  return { otf, pfb, failed };
}

/**
 * @param {string[]} packages
 * @param {string} [body]
 * @param {string} [classOptions]
 * @returns {string}
 */
function documentFor(packages, body = 'Warm-up.', classOptions = '11pt') {
  return [
    `\\documentclass[${classOptions}]{article}`,
    ...packages.map(name => `\\usepackage{${name}}`),
    '\\begin{document}',
    body,
    '\\end{document}',
    ''
  ].join('\n');
}

/**
 * @param {string} enginePath
 * @param {string} cacheDir
 * @param {string} source
 * @param {string[]} [extraArgs]
 * @returns {{ ok: boolean, output: string }}
 */
function compileWith(enginePath, cacheDir, source, extraArgs = []) {
  const work = mkdtempSync(join(tmpdir(), 'dsh-latex-warm-'));
  try {
    const file = join(work, 'warmup.tex');
    writeFileSync(file, source, 'utf8');
    try {
      const output = execFileSync(
        enginePath,
        ['-X', 'compile', file, '--outdir', work, ...extraArgs],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, TECTONIC_CACHE_DIR: cacheDir }
        }
      );
      return { ok: true, output };
    } catch (error) {
      const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
      const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
      return { ok: false, output: `${stdout}${stderr}`.trim() || String(error?.message ?? error) };
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * @param {string} enginePath
 * @param {string} cacheDir
 * @param {string} source
 * @returns {{ ok: boolean, output: string }}
 */
function compile(enginePath, cacheDir, source) {
  return compileWith(enginePath, cacheDir, source);
}

/**
 * @param {string} output
 * @returns {string}
 */
function firstErrorLine(output) {
  const line = output
    .split(/\r?\n/)
    .map(entry => entry.trim())
    .find(entry => /^error:|^! /.test(entry));
  return line ?? output.split(/\r?\n/).filter(Boolean).at(-1) ?? 'unknown error';
}

async function main() {
  const argv = process.argv.slice(2);
  const profileArgument = argv.find(argument => argument.startsWith('--profile='));
  const runtimeArgument = argv.find(argument => argument.startsWith('--runtime='));
  const checkOnly = argv.includes('--check');
  const profileName = profileArgument?.slice('--profile='.length) ?? 'minimal';
  const packages = PROFILES[profileName];
  if (packages === undefined) {
    throw new Error(`Unknown profile '${profileName}'. Choose one of: ${Object.keys(PROFILES).join(', ')}.`);
  }

  const runtime = locateRuntime({ runtimeDir: runtimeArgument?.slice('--runtime='.length) });
  if (runtime.enginePath === undefined) {
    throw new Error('No Tectonic engine found. Run scripts/fetch-runtime.mjs first.');
  }
  mkdirSync(runtime.cacheDir, { recursive: true });
  console.log(`Engine:  ${runtime.enginePath}`);
  console.log(`Cache:   ${runtime.cacheDir}`);
  console.log(`Profile: ${profileName} (${packages.length} package(s))`);

  if (!checkOnly) {
    // The baseline document comes first and is warmed on its own: it exercises
    // the plain Latin path (article + amsmath + graphicx + hyperref), which
    // pulls font-definition files such as TS1cmr.fd that a CJK-only document
    // never asks for. Warming it separately is what makes the later
    // `--only-cached` check meaningful.
    console.log('');
    console.log(`Warming baseline (${BASELINE.length} packages, ${BASELINE_CLASS_OPTIONS.length} class options)...`);
    for (const classOptions of BASELINE_CLASS_OPTIONS) {
      const baseline = compile(runtime.enginePath, runtime.cacheDir, documentFor(BASELINE, BASELINE_BODY, classOptions));
      if (!baseline.ok) {
        throw new Error(`Baseline warm-up (${classOptions}) failed: ${firstErrorLine(baseline.output)}`);
      }
      console.log(`  ok    article[${classOptions}]`);
    }
    const mathTemplate = compile(runtime.enginePath, runtime.cacheDir, mathTemplateDocument());
    if (!mathTemplate.ok) {
      throw new Error(`latex_math template warm-up failed: ${firstErrorLine(mathTemplate.output)}`);
    }
    console.log('  ok    standalone math template');

    // The design-size sweep. Doing this *before* the package profiles means the
    // 9pt/8pt font families are cached even for the `minimal` profile, which is
    // the one an operator is most likely to rely on.
    const sizeCoverage = compile(runtime.enginePath, runtime.cacheDir, sizeCoverageDocument());
    if (!sizeCoverage.ok) {
      throw new Error(`Font-size coverage warm-up failed: ${firstErrorLine(sizeCoverage.output)}`);
    }
    console.log('  ok    font-size sweep (tiny .. huge, footnotes, nested scripts)');

    console.log('');
    console.log(`Warming profile '${profileName}' (${packages.length} packages)...`);
    const bulk = compile(runtime.enginePath, runtime.cacheDir, documentFor(packages));
    if (bulk.ok) {
      console.log('Warmed the whole package set in one pass.');
    } else {
      console.log(`Bulk warm-up failed (${firstErrorLine(bulk.output)}); warming package by package instead.`);
      const failed = [];
      for (const name of packages) {
        const single = compile(runtime.enginePath, runtime.cacheDir, documentFor([name]));
        if (single.ok) {
          console.log(`  ok    ${name}`);
        } else {
          console.log(`  FAIL  ${name} - ${firstErrorLine(single.output)}`);
          failed.push(name);
        }
      }
      if (failed.length === packages.length) {
        throw new Error('Every package failed to warm; the engine or the bundle is unusable.');
      }
      if (failed.length > 0) {
        console.log(`Unavailable packages (not fatal): ${failed.join(', ')}`);
      }
    }

    for (const documentClass of PROFILE_CLASSES[profileName] ?? []) {
      const warmClass = compile(runtime.enginePath, runtime.cacheDir, classDocument(documentClass.name, BASELINE, documentClass.body));
      if (!warmClass.ok) {
        throw new Error(`Class warm-up (${documentClass.name}) failed: ${firstErrorLine(warmClass.output)}`);
      }
      console.log(`  ok    ${documentClass.name}`);
    }
  }

  // Prove the warm cache really is self-sufficient: every warmed shape must
  // compile with `--only-cached`, which forbids every network fetch.
  console.log('');
  console.log('Completing physical fonts (the warm-up documents only pull the design');
  console.log('sizes they happen to use)...');
  await completeFontFiles(runtime.cacheDir, { log: message => console.log(`  ${message}`) });

  const offlineChecks = [
    ['article', () => documentFor(BASELINE, BASELINE_BODY)],
    ['standalone math template', mathTemplateDocument],
    // Guards the design-size regression: this document failed from cache alone
    // when only the 10/11pt font families had been warmed.
    ['font-size sweep', sizeCoverageDocument],
    ...(PROFILE_CLASSES[profileName] ?? []).map(documentClass => [
      `${documentClass.name} class`,
      () => classDocument(documentClass.name, BASELINE, documentClass.body)
    ])
  ];
  let offlineFailure;
  for (const [label, build] of offlineChecks) {
    const outcome = compileWith(runtime.enginePath, runtime.cacheDir, build(), ['--only-cached']);
    console.log(`Cached-only ${label}: ${outcome.ok ? 'ok' : 'FAILED'}`);
    if (!outcome.ok && offlineFailure === undefined) {
      offlineFailure = `${label}: ${firstErrorLine(outcome.output)}`;
    }
  }
  console.log('');
  if (offlineFailure !== undefined) {
    throw new Error(`The cache is not yet sufficient for offline compiles (${offlineFailure}).`);
  }

  const manifestPath = join(runtime.runtimeDir ?? '', 'manifest.json');
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.warmedProfiles = [...new Set([...(manifest.warmedProfiles ?? []), profileName])];
    manifest.warmedAt = new Date().toISOString();
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  } catch {
    // No manifest (a hand-installed engine); nothing to record.
  }

  console.log('');
  console.log(`Cache is offline-ready for profile '${profileName}'.`);
}

/**
 * Exported so the regression suite can assert the warmed shapes really cover
 * the font design sizes an ordinary document uses, without re-running a warm-up.
 */
export { classDocument, documentFor, mathTemplateDocument, sizeCoverageDocument };

// Importing this module (as the tests do) must not start a warm-up run.
if (process.argv[1] !== undefined && process.argv[1].endsWith('warm-cache.mjs')) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}