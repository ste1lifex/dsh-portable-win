/**
 * Regression tests for the warm-cache font coverage.
 *
 * The bug these guard against: the warm-up documents only ever set text at the
 * class size (10pt/11pt), so Tectonic never resolved the 9pt/8pt Computer
 * Modern families. A cache warmed that way compiled the warm-up documents but
 * then failed offline on any ordinary document containing `\small`, a footnote
 * with math, or a small table:
 *
 *   warning: Could not locate a virtual/physical font for TFM "cmmi9".
 *   error: the xdvipdfmx engine had an unrecoverable error
 *   caused by: Cannot proceed without .vf or "physical" font for PDF output...
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  BASELINE,
  SIZE_COVERAGE_BODY,
  findMissingFontFiles,
  sizeCoverageDocument,
  unicodeFontNames
} from '../../scripts/warm-cache.mjs';

test('the warm-up sweeps every design size an ordinary document switches to', () => {
  const doc = sizeCoverageDocument();
  for (const size of ['\\tiny', '\\scriptsize', '\\footnotesize', '\\small', '\\normalsize', '\\large', '\\Large', '\\LARGE', '\\huge']) {
    assert.ok(doc.includes(size), `${size} is exercised`);
  }
});

test('the warm-up includes the shapes that pulled the missing 9pt/8pt fonts', () => {
  const doc = sizeCoverageDocument();
  // 9pt text + math (\small), footnote math, nested scripts and big delimiters
  // are what request cmr9/cmmi9/cmsy9/cmex8/cmex9.
  assert.ok(/\\small[^\n]*\$/.test(doc), 'small-size math is present');
  assert.ok(/\\footnote\{/.test(doc), 'a footnote with math is present');
  assert.ok(/x\^\{y\^\{z\}\}/.test(doc), 'nested scripts request the smallest sizes');
  assert.ok(/\\bigl\(/.test(doc), 'big delimiters request the cmex family');
  assert.ok(/\\begin\{tabular\}/.test(doc), 'a small-size table is present');
});

test('the size-coverage document is a complete, article-based document', () => {
  const doc = sizeCoverageDocument();
  assert.ok(doc.startsWith('\\documentclass[10pt]{article}'), 'a 10pt article is the worst case for 9pt switching');
  assert.ok(doc.trimEnd().endsWith('\\end{document}'), 'the document is closed');
  for (const pkg of BASELINE) {
    assert.ok(doc.includes(`\\usepackage{${pkg}}`), `${pkg} is loaded so the sweep matches the real profiles`);
  }
  // No literal \\ outside the tabular: that would break the warm-up itself.
  const outsideTabular = doc.replace(/\\begin\{tabular\}[\s\S]*?\\end\{tabular\}/, '');
  assert.ok(!outsideTabular.includes('\\\\'), 'no stray line breaks outside the table');
});

test('SIZE_COVERAGE_BODY is exposed for the offline self-check', () => {
  // The body only; documentFor() supplies the \documentclass ... \end{document} frame.
  assert.equal(typeof SIZE_COVERAGE_BODY, 'string');
  assert.ok(SIZE_COVERAGE_BODY.includes('\\tiny'));
  assert.ok(!SIZE_COVERAGE_BODY.includes('\\begin{document}'), 'the frame belongs to documentFor()');
});

test('unicodeFontNames reads every OpenType file a .fd declares', () => {
  const fd = [
    '\\DeclareFontShape{TU}{lmr}{m}{n}%',
    '  {<8.5-9.5> \\UnicodeFontFile{lmroman9-regular}{\\UnicodeFontTeXLigatures}}%',
    '\\DeclareFontShape{TU}{lmr}{bx}{n}%',
    '  {<8.5-9.5> \\UnicodeFontFile{lmroman9-bold}{\\UnicodeFontTeXLigatures}}%'
  ].join('\n');
  assert.deepEqual(unicodeFontNames(fd), ['lmroman9-regular', 'lmroman9-bold']);
  assert.deepEqual(unicodeFontNames('\\ProvidesFile{tulmr.fd}'), []);
});

test('findMissingFontFiles reports both the .otf and the .pfb gaps', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-latex-fonts-'));
  try {
    // tulmr.fd asks for two shapes; only one is cached.
    writeFileSync(join(dir, 'tulmr.fd'), [
      '\\DeclareFontShape{TU}{lmr}{m}{n}{<-> \\UnicodeFontFile{lmroman9-regular}{x}}{}',
      '\\DeclareFontShape{TU}{lmr}{bx}{n}{<-> \\UnicodeFontFile{lmroman9-bold}{x}}{}'
    ].join('\n'));
    writeFileSync(join(dir, 'lmroman9-regular.otf'), 'cached');
    // A CM metric with no outline is a pfb gap; with an outline it is not.
    writeFileSync(join(dir, 'cmmi9.tfm'), 'metric');
    writeFileSync(join(dir, 'cmr10.tfm'), 'metric');
    writeFileSync(join(dir, 'cmr10.pfb'), 'outline');
    // Neither .pfb nor .otf nor .vf, but not a family CTAN ships: ignored.
    writeFileSync(join(dir, 'line10.tfm'), 'metric');

    const missing = await findMissingFontFiles(dir);
    assert.deepEqual(missing.otf, ['lmroman9-bold']);
    assert.deepEqual(missing.pfb, ['cmmi9']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
