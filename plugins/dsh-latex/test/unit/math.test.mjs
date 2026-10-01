import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMathDocument } from '../../lib/tools/math.js';
import { normalizeOutputFormat, safeStem } from '../../lib/tools/shared.js';

test('buildMathDocument crops with standalone and preloads the ams packages', () => {
  const document = buildMathDocument({ expression: 'E = mc^2' });
  assert.match(document, /\\documentclass\[border=2pt,varwidth\]\{standalone\}/);
  assert.match(document, /\\usepackage\{amsmath\}/);
  assert.match(document, /\\usepackage\{amssymb\}/);
  assert.match(document, /\\usepackage\{amsfonts\}/);
  assert.match(document, /\$\\displaystyle E = mc\^2\$/);
});

test('buildMathDocument honours inline style, border and extra packages without duplicates', () => {
  const document = buildMathDocument({
    expression: 'a+b',
    display: false,
    borderPt: 8,
    packages: ['physics', 'amsmath', 'bm']
  });
  assert.match(document, /border=8pt/);
  assert.match(document, /\$a\+b\$/);
  assert.equal(document.match(/\\usepackage\{amsmath\}/g)?.length, 1, 'amsmath is not loaded twice');
  assert.match(document, /\\usepackage\{physics\}/);
  assert.match(document, /\\usepackage\{bm\}/);
});

test('buildMathDocument falls back to a safe border for junk input', () => {
  assert.match(buildMathDocument({ expression: 'x', borderPt: -3 }), /border=2pt/);
  assert.match(buildMathDocument({ expression: 'x', borderPt: 2.5 }), /border=2pt/);
});

test('safeStem keeps names filesystem- and TeX-safe', () => {
  assert.equal(safeStem('report', 'document'), 'report');
  assert.equal(safeStem('My Paper (v2)', 'document'), 'My-Paper-v2');
  assert.equal(safeStem('  ...  ', 'document'), 'document');
  assert.equal(safeStem(undefined, 'math'), 'math');
  assert.equal(safeStem('../../etc/passwd', 'document'), 'etc-passwd');
  assert.ok(safeStem('x'.repeat(200), 'document').length <= 64);
});

test('normalizeOutputFormat accepts the engine formats and rejects the rest', () => {
  assert.equal(normalizeOutputFormat(undefined), undefined);
  assert.equal(normalizeOutputFormat('pdf'), 'pdf');
  assert.equal(normalizeOutputFormat('html'), 'html');
  assert.throws(() => normalizeOutputFormat('dvi'), /output_format must be one of/);
  assert.throws(() => normalizeOutputFormat('../../etc/passwd'), /output_format must be one of/);
});
