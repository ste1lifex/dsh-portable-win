import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCompileArgs, parseTexLog, tailOf } from '../../lib/engine.js';

const base = {
  sourceFile: '/work/main.tex',
  workingDirectory: '/work',
  outputDirectory: '/work/.build'
};

test('buildCompileArgs always keeps the log and never uses the legacy --chatter flag', () => {
  const args = buildCompileArgs(base);
  assert.deepEqual(args, ['-X', 'compile', '/work/main.tex', '--outdir', '/work/.build', '--keep-logs']);
  assert.ok(!args.includes('--chatter'), 'the V2 compile subcommand rejects --chatter');
});

test('buildCompileArgs adds only the requested options', () => {
  const args = buildCompileArgs({
    ...base,
    outputFormat: 'html',
    offline: true,
    keepIntermediates: true,
    synctex: true,
    untrusted: true,
    reruns: 2,
    pass: 'tex',
    searchPaths: ['/a', '/b']
  });
  assert.ok(args.includes('--outfmt') && args.includes('html'));
  assert.ok(args.includes('--only-cached'));
  assert.ok(args.includes('--keep-intermediates'));
  assert.ok(args.includes('--synctex'));
  assert.ok(args.includes('--untrusted'));
  assert.deepEqual(args.slice(args.indexOf('--reruns'), args.indexOf('--reruns') + 2), ['--reruns', '2']);
  assert.deepEqual(args.slice(args.indexOf('--pass'), args.indexOf('--pass') + 2), ['--pass', 'tex']);
  assert.deepEqual(args.filter(value => value.startsWith('search-path=')), ['search-path=/a', 'search-path=/b']);
});

test('buildCompileArgs omits pdf (the engine default) and never enables shell escape by default', () => {
  const args = buildCompileArgs({ ...base, outputFormat: 'pdf' });
  assert.ok(!args.includes('--outfmt'));
  assert.ok(!args.includes('shell-escape'));
  assert.ok(buildCompileArgs({ ...base, shellEscape: true }).includes('shell-escape'));
});

test('parseTexLog separates errors, warnings, boxes and page count', () => {
  const log = [
    'This is XeTeX',
    'LaTeX Warning: Reference `x` undefined on page 1.',
    'Overfull \\hbox (12.0pt too wide) in paragraph at lines 4--5',
    'Underfull \\vbox (badness 10000) has occurred while \\output is active',
    '! Undefined control sequence.',
    'l.7 \\notacommand',
    'Output written on main.pdf (3 pages, 12345 bytes).'
  ].join('\n');
  const parsed = parseTexLog(log);
  assert.deepEqual(parsed.errors, ['! Undefined control sequence. l.7 \\notacommand']);
  assert.deepEqual(parsed.warnings, ['LaTeX Warning: Reference `x` undefined on page 1.']);
  assert.equal(parsed.overfull, 1);
  assert.equal(parsed.underfull, 1);
  assert.equal(parsed.pages, 3);
});

test('parseTexLog copes with a clean log', () => {
  const parsed = parseTexLog('This is XeTeX\nOutput written on main.pdf (1 page, 900 bytes).');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.pages, 1);
});

test('parseTexLog hides warnings about functionality the plugin disables on purpose', () => {
  const log = [
    'Package shellesc Warning: Shell escape disabled on input line 73.',
    'LaTeX Warning: There were undefined references.'
  ].join('\n');
  const parsed = parseTexLog(log);
  assert.deepEqual(parsed.warnings, ['LaTeX Warning: There were undefined references.']);
});

test('tailOf drops blank lines and the cosmetic Windows fontconfig warning', () => {
  const text = [
    'Fontconfig error: Cannot load default config file: No such file: (null)',
    '',
    'note: Running TeX ...',
    '   ',
    'note: Writing `main.pdf`'
  ].join('\n');
  assert.equal(tailOf(text, 1000), 'note: Running TeX ...\nnote: Writing `main.pdf`');
});

test('tailOf keeps the end of an over-long stream', () => {
  const text = `${'a'.repeat(50)}\n${'b'.repeat(50)}`;
  const result = tailOf(text, 20);
  assert.ok(result.startsWith('…'));
  assert.ok(result.endsWith('b'.repeat(20)));
});

test('tailOf keeps a back-end "caused by" line, which carries the real reason', () => {
  // Regression: xdvipdfmx dies with an opaque one-liner and puts the only
  // actionable fact — the missing physical font — on the `caused by:` line.
  const text = [
    'note: Running xdvipdfmx ...',
    'error: something bad happened inside xdvipdfmx; its output follows:',
    'error: the xdvipdfmx engine had an unrecoverable error',
    'caused by: Cannot proceed without .vf or "physical" font for PDF output...'
  ].join('\n');
  const result = tailOf(text, 1000);
  assert.ok(result.includes('caused by: Cannot proceed without'), 'the root cause survives');
  assert.ok(result.includes('xdvipdfmx'), 'the failing engine is still named');
});

test('tailOf drops per-message "warning:" chatter so the failure stays readable', () => {
  const text = [
    'warning: main.tex:63: Underfull \\hbox (badness 10000) in paragraph at lines 63--63',
    'warning: main.tex:104: Underfull \\hbox (badness 10000) in paragraph at lines 104--104',
    'error: the xdvipdfmx engine had an unrecoverable error',
    'caused by: Cannot proceed without .vf or "physical" font for PDF output...'
  ].join('\n');
  const result = tailOf(text, 1000);
  assert.ok(!result.includes('Underfull'), 'box chatter is left to the parsed warning list');
  assert.ok(result.includes('caused by:'), 'the terminating reason is what remains');
});
