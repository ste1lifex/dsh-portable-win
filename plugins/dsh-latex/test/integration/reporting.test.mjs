/**
 * The error-reporting regression, through the real engine.
 *
 * When the resource cache is missing a physical font, xdvipdfmx fails *after*
 * TeX has run: it prints an opaque `something bad happened inside xdvipdfmx`
 * line, and the only actionable fact — which font was missing and why the PDF
 * could not be written — sits on the indented `caused by:` line beneath it.
 *
 * That line used to be discarded, so the model was told a compile failed with
 * no way to fix it. This test removes one physical font from a copy of the
 * installed cache and asserts the root cause still reaches the caller.
 *
 * The test needs a warmed cache; it reports a skip when there is none.
 */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveConfig } from '../../lib/config.js';
import { createLatexEngine } from '../../lib/engine.js';

/**
 * A physical font this probe genuinely needs. Established by removing each
 * candidate from a cache copy and compiling: `cmmi9` is required, while
 * `cmex9` / `cmsy9` / `cmr9` are not (their glyphs come from other sizes).
 */
const REQUIRED_PHYSICAL_FONT = 'cmmi9.pfb';

/**
 * A document that needs the 9pt math families, so removing one of them is a
 * genuine failure rather than an unused-file no-op.
 */
function smallMathDocument() {
  return [
    '\\documentclass[10pt]{article}',
    '\\usepackage{amsmath}',
    '\\begin{document}',
    '{\\small Small math $\\alpha\\beta$ and a footnote\\footnote{note $x^{y}$}.}',
    '{\\small\\begin{tabular}{ll}\\hline a & $x^2$ \\\\\\hline\\end{tabular}}',
    '\\end{document}',
    ''
  ].join('\n');
}

/**
 * Copy the engine's resource cache into a temp directory and drop one physical
 * font, so an offline compile is guaranteed to fail.
 *
 * @param {string} cacheDir
 * @returns {{ cacheDir: string, cleanup: () => void } | undefined}
 */
function cacheWithoutPhysicalFont(cacheDir) {
  const bundleData = join(cacheDir, 'bundles', 'data');
  if (!existsSync(bundleData)) return undefined;
  const bundle = readdirSync(bundleData, { withFileTypes: true }).find(entry => entry.isDirectory());
  if (bundle === undefined) return undefined;
  const source = join(bundleData, bundle.name);
  // Only run when the font this test removes is actually cached.
  if (!existsSync(join(source, REQUIRED_PHYSICAL_FONT))) return undefined;

  const work = mkdtempSync(join(tmpdir(), 'dsh-latex-mr-'));
  const copy = join(work, 'cache');
  cpSync(cacheDir, copy, { recursive: true });
  rmSync(join(copy, 'bundles', 'data', bundle.name, REQUIRED_PHYSICAL_FONT));
  return { cacheDir: copy, cleanup: () => rmSync(work, { recursive: true, force: true }) };
}

test('a missing physical font still reports its root cause, not just "something bad happened"', async t => {
  const probe = createLatexEngine(resolveConfig({}));
  const cacheDir = probe.describe().cacheDir;
  const broken = cacheWithoutPhysicalFont(cacheDir);
  if (broken === undefined) {
    t.skip(`no warmed cache containing ${REQUIRED_PHYSICAL_FONT} on this machine`);
    return;
  }

  const work = mkdtempSync(join(tmpdir(), 'dsh-latex-mr-doc-'));
  const out = join(work, 'out');
  mkdirSync(out, { recursive: true });
  const source = join(work, 'probe.tex');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(source, smallMathDocument(), 'utf8');

  try {
    const engine = createLatexEngine(resolveConfig({ cacheDir: broken.cacheDir }));
    const outcome = await engine.compile({
      sourceFile: source,
      workingDirectory: work,
      outputDirectory: out,
      offline: true,
      timeoutMs: 120_000
    });

    assert.equal(outcome.ok, false, 'the compile really did fail');
    const all = [...outcome.errors, outcome.logTail].join('\n');
    assert.match(all, /caused by:/, 'the "caused by" line is preserved');
    assert.match(all, /physical font|\.vf/, 'the reason names the missing physical font');
  } finally {
    rmSync(work, { recursive: true, force: true });
    broken.cleanup();
  }
});
