# dsh-latex

[中文说明](README.zh-CN.md) | English

**Self-contained LaTeX for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).**
Compile `.tex` documents and single formulas to PDF from an agent turn — with a
pinned [Tectonic](https://github.com/tectonic-typesetting/tectonic) engine, no
system TeX distribution, and **zero npm runtime dependencies**.

```text
latex_health    is an engine installed, and is the resource cache offline-ready?
latex_compile   .tex file or inline document -> PDF
latex_math      one formula -> tightly cropped PDF
```

The plugin repository is a few hundred kilobytes. The 20 MB engine binary and
the TeX resource cache live outside the package (in
`<DSH_HOME>/runtimes/latex-runtime-<platform>-<arch>`), are fetched by a pinned,
SHA-256-verified script, and are the only things a new machine needs to
download.

---

## Why Tectonic

| | |
| --- | --- |
| **One binary** | No TeX Live, no MiKTeX, no `kpsewhich`, no `fmtutil`, no admin rights. |
| **Lazy resources** | Only the TeX Live files a document actually loads are fetched — typically a few MB, not the ~5 GB of a full distribution. |
| **Offline after warm-up** | `scripts/warm-cache.mjs` pre-populates the cache and proves it with a `--only-cached` compile. |
| **Cross-platform** | Windows x64, macOS x64/arm64, Linux x64/arm64 musl (statically linked). |
| **MIT** | Same license family as this plugin. See [NOTICE](NOTICE). |

---

## Install

### As part of the DSH Windows portable distribution

Nothing to do. `start-dsh.ps1` verifies the engine on every launch, downloads it
on first run, and warms the `minimal`, `chinese` and `common` resource profiles
(about 5-7 minutes, once). See the portable repository's `README.md`.

### Into any other DSH profile

```bash
# 1) make the package a dependency of the profile
cd "$DSH_HOME/profiles/web"
pnpm add link:/path/to/dsh-latex          # or: pnpm add dsh-latex (once published)

# 2) list it as a bundle so its own cordis.patch.yml is applied
#    dsh.profile.bundles: [ ..., "dsh-latex" ]
```

Then fetch the engine and warm the cache:

```bash
node node_modules/dsh-latex/scripts/fetch-runtime.mjs
node node_modules/dsh-latex/scripts/warm-cache.mjs --profile=common
```

Restart the harness. `latex_health` reports exactly what was found and where.

Full details, including a from-scratch rebuild on a clean machine, are in
[INSTALL.md](INSTALL.md).

---

## Tools

### `latex_compile`

```jsonc
{
  "source": "\\documentclass{article}\\begin{document}Hello\\end{document}",
  "output_name": "hello"
}
```

| Parameter | Type | Notes |
| --- | --- | --- |
| `source_path` | string | An existing `.tex` file inside the session workspace or `allowedLocalRoots`. Mutually exclusive with `source`. |
| `source` | string | Inline LaTeX for the whole document, including `\documentclass`. |
| `output_name` | string | Base name (no extension) for the result. Defaults to the source file's stem, else `document`. |
| `output_path` | string | Explicit destination. Defaults next to the source, or in the session workspace. |
| `output_format` | enum | `pdf` (default), `xdv`, `html`, `aux`. |
| `offline` | boolean | Compile strictly from the local cache; fail instead of fetching. |
| `keep_intermediates` | boolean | Also write `.aux`/`.log`/`.toc` next to the result. |
| `synctex` | boolean | Emit a SyncTeX file. |
| `reruns` | integer | Extra engine passes for stubborn cross-references. |
| `timeout_ms` | integer | Deadline; defaults to `defaultTimeoutMs` (180000). |
| `search_paths` | string[] | Extra **authorized** directories to resolve `\input`/`\includegraphics` from. |

### `latex_math`

```jsonc
{
  "expression": "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx=\\sqrt{\\pi}",
  "packages": ["physics"],
  "border_pt": 4,
  "output_name": "gaussian"
}
```

Wraps the snippet in `\documentclass[border=<n>pt,varwidth]{standalone}` with
`amsmath`, `amssymb` and `amsfonts` preloaded, so the page is cropped to the
formula.

### `latex_health`

Reports `ready`, the engine path and version, the runtime directory and how it
was resolved, the cache directory with file count and byte size, and whether the
cache is warm enough for offline compiles.

---

## Configuration

```yaml
# dsh-home/profiles/web/cordis.patch.yml
- id: dsh-latex
  config:
    runtimeDir: !!js "process.env.DSH_HOME + '/runtimes/latex-runtime-' + process.platform + '-' + process.arch"
    allowedLocalRoots: []
    offline: false
    allowShellEscape: false
    defaultTimeoutMs: 180000
```

| Key | Default | Meaning |
| --- | --- | --- |
| `runtimeDir` | `<DSH_HOME>/runtimes/latex-runtime-<platform>-<arch>` | Where the engine binary, its `manifest.json` and the `cache/` live. |
| `enginePath` | — | Use a Tectonic you installed yourself; the directory containing it becomes the runtime. |
| `cacheDir` | `<runtimeDir>/cache` | `TECTONIC_CACHE_DIR`. Point several machines at one shared cache if you like. |
| `offline` | `false` | Make every call cached-only by default. |
| `untrusted` | `true` | Disables `\write18` in the document. |
| `allowShellEscape` | `false` | Opt in to `\write18` (needs `untrusted: false`). |
| `allowedLocalRoots` | `[]` | Extra directories whose `.tex` files may be read and written. |
| `allowWorkspaceFiles` | `true` | Also authorize the session workspace. |
| `keepIntermediates` | `false` | Keep `.aux`/`.log` by default. |
| `defaultTimeoutMs` / `maxTimeoutMs` | `180000` / `900000` | Per-call deadline and its ceiling. |
| `maxSourceBytes` | `2000000` | Largest inline source. |
| `maxOutputChars` | `20000` | Largest engine log echoed to the model. |
| `debug` | `false` | Log the exact engine argument vector. |

Environment overrides: `DSH_LATEX_RUNTIME_DIR`, `DSH_LATEX_CACHE_DIR`.

---

## Rebuilding elsewhere, cheaply

```bash
git clone https://github.com/ste1lifex/dsh-latex
cd dsh-latex
node scripts/fetch-runtime.mjs          # 20 MB, SHA-256 verified
node scripts/warm-cache.mjs             # optional: makes offline compiles work
node --test "test/unit/**/*.test.mjs"   # no engine required
```

There is no build step, no bundler and no `pnpm install`: the package is plain
ESM JavaScript. The only requirement is Node `^22.19.0 || >=24.0.0` — the same
version DSH already requires.

To move the engine instead of re-downloading it, copy the whole
`latex-runtime-<platform>-<arch>` directory and point `runtimeDir` at it; the
pinned manifest inside is re-verified at every launch.

---

## Security

- **Documents are untrusted by default.** `\write18` shell escape is off unless
  an operator sets both `untrusted: false` and `allowShellEscape: true`.
- **Reads and writes are authorized twice.** A lexical check rejects UNC shares,
  device namespaces and traversal before any filesystem call; a real-path check
  then refuses symlink escapes out of an authorized root.
- **The engine is verified, not trusted.** Every download is checked against a
  SHA-256 pinned in source, and the extracted binary's own digest is recorded in
  `manifest.json` and re-checked on each launch.
- **Archive members are sanitized.** The bundled ZIP and `tar.gz` readers refuse
  absolute and traversing names.
- **No telemetry, no network except the pinned downloads** (and the TeX resource
  fetch that Tectonic itself performs, which `offline: true` disables).

---

## Development

```bash
node --test "test/unit/**/*.test.mjs"          # 29 unit tests, engine not needed
node --test "test/integration/**/*.test.mjs"   # boots the real DSH tool registry
```

The integration suite mounts the plugin into a real
`@deepseek-ai/dsh-tools` registry on a real cordis context and dispatches calls
through `ctx.tools.execute()` — the same path a model call takes — then asserts
that actual PDFs land on disk. It reports a skip when the engine is absent.

See [docs/architecture.md](docs/architecture.md) for the module map.

## License

MIT — see [LICENSE](LICENSE). Third-party components: [NOTICE](NOTICE).
