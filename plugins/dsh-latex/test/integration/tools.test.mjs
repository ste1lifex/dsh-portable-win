/**
 * End-to-end test through the real DSH tool pipeline.
 *
 * Rather than calling the tool bodies directly, this boots the actual
 * `@deepseek-ai/dsh-tools` registry on a real cordis context, mounts the plugin
 * exactly as the harness does, and dispatches calls through
 * `ctx.tools.execute()` — the same path a model call takes, including schema
 * compilation, argument validation and result rendering.
 *
 * The compile assertions need the pinned engine; when it is not installed the
 * test reports a skip instead of a failure, so `node --test` stays useful on a
 * bare checkout.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadDshModule, resolveDshModule } from '../../lib/dsh-runtime.js';
import { apply } from '../../index.js';

/** @returns {{ cwd: string, cleanup: () => void }} */
function scratchWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-latex-it-'));
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

/**
 * Boot the registry and mount dsh-latex the way the harness does.
 * @param {{ cwd: string }} workspace
 */
async function mountPlugin(workspace) {
  const cordis = await loadDshModule('@deepseek-ai/cordis');
  const tools = await loadDshModule('@deepseek-ai/dsh-tools');
  const systemPrompt = await loadDshModule('@deepseek-ai/dsh-system-prompt');

  const ctx = new cordis.Context();
  ctx.plugin(systemPrompt.SystemPrompt);
  ctx.plugin(tools.ToolRuntime);
  await new Promise(resolve => setTimeout(resolve, 300));
  apply(ctx, { untrusted: true });

  const agent = { session: { header: { cwd: workspace.cwd } } };
  let counter = 0;
  return {
    schemas: () => ctx.tools.schemas().map(schema => schema.name),
    call: async (name, args) => ctx.tools.execute({
      callId: `it-${(counter += 1)}`,
      name,
      arguments: args,
      signal: new AbortController().signal,
      agent
    })
  };
}

const harnessAvailable = resolveDshModule('@deepseek-ai/dsh-tools') !== undefined;

test('the plugin mounts its three tools into the real registry', { skip: !harnessAvailable && 'DSH host packages are not resolvable here' }, async () => {
  const workspace = scratchWorkspace();
  try {
    const harness = await mountPlugin(workspace);
    const names = harness.schemas();
    for (const expected of ['latex_health', 'latex_compile', 'latex_math']) {
      assert.ok(names.includes(expected), `${expected} is visible to the model`);
    }
  } finally {
    workspace.cleanup();
  }
});

test('latex_health reports the resolved runtime through the registry', { skip: !harnessAvailable && 'DSH host packages are not resolvable here' }, async () => {
  const workspace = scratchWorkspace();
  try {
    const harness = await mountPlugin(workspace);
    const result = await harness.call('latex_health', {});
    assert.equal(result.isError, false);
    assert.equal(result.value.engine, 'tectonic');
    assert.equal(typeof result.value.cacheDir, 'string');
    assert.ok(Array.isArray(result.content));
    assert.match(result.content[0].text, /LaTeX engine: tectonic/);
  } finally {
    workspace.cleanup();
  }
});

test('argument validation rejects a call that supplies both sources', { skip: !harnessAvailable && 'DSH host packages are not resolvable here' }, async () => {
  const workspace = scratchWorkspace();
  try {
    const harness = await mountPlugin(workspace);
    const result = await harness.call('latex_compile', {
      source: '\\documentclass{article}\\begin{document}x\\end{document}',
      source_path: 'main.tex'
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /exactly one of source_path/i);
  } finally {
    workspace.cleanup();
  }
});

test('latex_compile and latex_math produce real PDFs', { skip: !harnessAvailable && 'DSH host packages are not resolvable here' }, async t => {
  const workspace = scratchWorkspace();
  try {
    const harness = await mountPlugin(workspace);
    const health = await harness.call('latex_health', {});
    if (health.value.ready !== true) {
      t.skip('the pinned Tectonic engine is not installed; run scripts/fetch-runtime.mjs');
      return;
    }

    const compiled = await harness.call('latex_compile', {
      source: [
        '\\documentclass[11pt]{article}',
        '\\usepackage{amsmath}',
        '\\begin{document}',
        '\\section{Registry path}',
        'Inline $E = mc^2$ and display:',
        '\\[ \\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2} \\]',
        '\\end{document}'
      ].join('\n'),
      output_name: 'registry',
      offline: true,
      timeout_ms: 300_000
    });
    assert.equal(compiled.isError, false, compiled.content?.[0]?.text);
    assert.equal(compiled.value.ok, true);
    assert.equal(compiled.value.outputFormat, 'pdf');
    assert.match(compiled.value.outputPath, /registry\.pdf$/);
    assert.ok(compiled.value.outputBytes > 1000, 'the PDF is not empty');

    const math = await harness.call('latex_math', {
      expression: '\\sum_{n=1}^{\\infty}\\frac{1}{n^2}=\\frac{\\pi^2}{6}',
      output_name: 'formula',
      offline: true,
      timeout_ms: 300_000
    });
    assert.equal(math.isError, false, math.content?.[0]?.text);
    assert.equal(math.value.ok, true);
    assert.match(math.value.outputPath, /formula\.pdf$/);
  } finally {
    workspace.cleanup();
  }
});

test('a broken document fails with a structured code and the engine log', { skip: !harnessAvailable && 'DSH host packages are not resolvable here' }, async t => {
  const workspace = scratchWorkspace();
  try {
    const harness = await mountPlugin(workspace);
    const health = await harness.call('latex_health', {});
    if (health.value.ready !== true) {
      t.skip('the pinned Tectonic engine is not installed; run scripts/fetch-runtime.mjs');
      return;
    }

    const result = await harness.call('latex_compile', {
      source: '\\documentclass{article}\\begin{document}\\notacommand\\end{document}',
      output_name: 'broken',
      offline: true,
      timeout_ms: 300_000
    });
    assert.equal(result.isError, true);
    const text = result.content[0].text;
    assert.match(text, /failed to compile broken\.tex/);
    assert.match(text, /Undefined control sequence/, 'the engine log explains the failure');
    assert.ok(!text.includes('!!'), 'the engine error prefix is normalized');
  } finally {
    workspace.cleanup();
  }
});
