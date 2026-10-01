# Architecture

## What this package is

A DSH host-side plugin. It contributes three tools to `ctx.tools` and shells out
to a pinned Tectonic binary. There is no client (browser) half: produced PDFs are
rendered by the harness' existing document preview.

## Module map

| Path | Role |
| --- | --- |
| `index.js` | Cordis entry. Resolves config, builds the engine, registers the three tools, logs the resolved runtime once. |
| `lib/config.js` | Defensive normalization of the loader entry. No schema library, because the plugin must load even when the harness packages are only reachable through `lib/dsh-runtime.js`. |
| `lib/dsh-runtime.js` | Resolves `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-llm` from either the normal `node_modules` walk or `$DSH_HOME/profiles/**/node_modules`. See "Why the resolver exists". |
| `lib/define-tool.js` | The single import site for `defineTool`. Uses top-level `await`, which is safe because the cordis loader imports plugin entries with `await import(...)`. |
| `lib/harness-error.js` | Maps `LatexError` onto `HarnessError` so tool results carry a stable code; degrades to a plain `Error` when `@deepseek-ai/dsh-llm` is unavailable. |
| `lib/errors.js` | `LatexError` and the stable `LATEX_*` code set. |
| `lib/runtime.js` | Pure path logic: platform key, engine file name, candidate runtime directories, cache directory. No filesystem mutation, so it is trivially unit-testable and is reused by the scripts. |
| `lib/engine.js` | Process invocation and log interpretation: `buildCompileArgs`, `runProcess`, `parseTexLog`, `tailOf`, `createLatexEngine`. |
| `lib/security/local-path.js` | Two-phase path authorization for reads, writes and `search-path` directories. |
| `lib/output/render.js` | Canonical result → concise model-facing text. |
| `lib/tools/shared.js` | Argument policy shared by both compiling tools: stem sanitization, format validation, source staging, output publication, artifact copying, cleanup. |
| `lib/tools/{health,compile,math}.js` | Tool definitions: schema, execute, presentation. |
| `scripts/lib/manifest.mjs` | The pinned engine table: version, asset names, SHA-256 per platform. The only place an engine bump happens. |
| `scripts/lib/archive.mjs` | Dependency-free ZIP and `tar.gz` readers that refuse unsafe member names. |
| `scripts/lib/download.mjs` | Pinned download, digest verification, retrying rename. |
| `scripts/{fetch-runtime,verify-runtime,warm-cache}.mjs` | Operator entry points. |

## Data flow of one `latex_compile` call

```text
model arguments
  └─ defineTool validation (compiled JSON Schema, in @deepseek-ai/dsh-tools)
      └─ tool execute
          ├─ exactly one of source / source_path?
          ├─ effectiveLocalRoots(config, session cwd)
          ├─ mkdtemp(<tmp>/dsh-latex-*)                    staging build directory
          ├─ file source:  resolveReadableFile()           lexical + realpath + open checks
          │                cwd = dirname(source)
          │  inline source: write <stem>.tex into staging, cwd = staging
          ├─ resolveAuthorizedDirectory() per search_path
          ├─ resolveWritablePath(requested output)         mkdir -p + deepest-ancestor realpath check
          ├─ engine.compile()
          │     ├─ locateRuntime()                         configured → env → DSH_HOME → package → PATH
          │     ├─ spawn tectonic -X compile <src> --outdir <staging> --keep-logs …
          │     ├─ read <stem>.log from staging            authoritative error/warning source
          │     └─ parseTexLog / tailOf
          ├─ failure → LatexError(COMPILE_FAILED | TIMEOUT | …) with the log tail
          ├─ pickPrimaryOutput() → copyFile into place
          ├─ optional artifact copying (keep_intermediates)
          └─ remove staging directory (finally)
```

The engine always writes into the staging directory, so a failed compile never
litters the user's folder with `.aux` files.

## Why the resolver exists

A published plugin (`dsh-doc` style) lives inside the profile's `node_modules`,
so `import '@deepseek-ai/dsh-tools'` just works. A plugin **linked** into a
profile — `"dsh-latex": "link:../../../plugins/dsh-latex"` — keeps its real path
outside every `node_modules`, and Node resolves bare specifiers from the
importing file's real directory. That walk ends at the repository root and finds
nothing.

`lib/dsh-runtime.js` therefore tries the normal resolution first and falls back
to the profile roots named by `DSH_HOME`. This is what lets the package stay a
plain, dependency-free directory that can be cloned, linked and started without
an install step.

## Engine choice and pinning

Tectonic is used as a **subprocess**, never linked. `scripts/lib/manifest.mjs`
records one asset per platform with its SHA-256; `fetch-runtime.mjs` downloads,
verifies, extracts into a staging directory and renames into place, and writes a
`manifest.json` recording the extracted binary's own digest.
`verify-runtime.mjs` re-checks that digest and the reported version, which is
what the portable launcher runs at every start.

The Windows GNU build is deliberately excluded: it is dynamically linked against
a MinGW runtime the release archive does not ship.

## Offline strategy

Tectonic caches resources lazily in `TECTONIC_CACHE_DIR`. The plugin pins that
to `<runtimeDir>/cache`, which keeps a portable harness from writing into the
user profile. `warm-cache.mjs` compiles representative documents once so the
cache holds what later offline compiles need, and then proves it by compiling
with `--only-cached`. The baseline document is warmed for both `10pt` and `11pt`
articles and includes the exact `standalone` class shape `latex_math` emits —
those are separate files on disk, and a cache holding one cannot compile the
other offline.

## Testing strategy

- **Unit** (`test/unit`): pure functions — argument vectors, log parsing, config
  normalization, runtime candidate ordering, path-free helpers, and in-memory
  archive round trips including traversal rejection. No engine, no network.
- **Integration** (`test/integration`): boots a real cordis context with the real
  `SystemPrompt` and `ToolRuntime` services, mounts the plugin through its own
  `apply()`, and dispatches through `ctx.tools.execute()`. This exercises schema
  compilation, argument validation, the engine subprocess and result rendering
  in one pass, and asserts that real PDFs land on disk. It reports a skip when
  the engine is not installed.

## Deliberate non-goals

- No client half. The harness already previews PDFs.
- No `latexmk`-style auxiliary orchestration. Tectonic reruns as needed.
- No bibliography tooling beyond what Tectonic's `bibtex` pass provides.
- No HTML/EPUB pipeline. `--outfmt html` is exposed because the engine supports
  it, but it is experimental upstream.
