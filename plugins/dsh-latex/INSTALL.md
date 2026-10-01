# Installing dsh-latex

Three ways, cheapest first.

---

## 1. The DSH Windows portable distribution

Already wired up. `start-dsh.ps1` calls `Initialize-LatexRuntime` before booting
the harness:

1. runs `scripts/verify-runtime.mjs` against
   `dsh-home\runtimes\latex-runtime-win32-x64`;
2. on failure, quarantines the directory as `*.invalid-<timestamp>` and runs
   `scripts/fetch-runtime.mjs` to download and verify the pinned engine;
3. on first install, warms the `minimal` resource profile so offline compiles
   work immediately;
4. if the engine still cannot be recovered, writes
   `logs\startup-fallback-latex.patch.yml` disabling only `dsh-latex` for that
   launch and tells you so. Nothing else is affected.

Set `DSH_SKIP_RUNTIME_DOWNLOAD=1` to suppress the download attempt entirely
(useful on an air-gapped machine that already has the runtime directory).

To pre-warm more packages, run once:

```powershell
& node\bin\node.exe plugins\dsh-latex\scripts\warm-cache.mjs --profile=common
```

---

## 2. Any other DSH profile

```bash
# 1) Add the package to the profile's dependencies.
cd "$DSH_HOME/profiles/web"
pnpm add link:/absolute/path/to/dsh-latex
#    ...or, once published:  pnpm add dsh-latex

# 2) Register it as a bundle in the same package.json so its own
#    cordis.patch.yml is applied:
#      "dsh": { "profile": { "bundles": [ ..., "dsh-latex" ] } }

# 3) Install the engine (about 20 MB, SHA-256 verified).
node node_modules/dsh-latex/scripts/fetch-runtime.mjs

# 4) Warm the resource cache so `offline: true` works.
node node_modules/dsh-latex/scripts/warm-cache.mjs --profile=common
```

Restart the harness. Then check:

```bash
node -e "console.log(require.resolve('dsh-latex'))"   # from the profile dir
```

and call `latex_health` from a conversation.

### If you use a hand-written patch instead of a bundle

```yaml
# dsh-home/profiles/<name>/cordis.patch.yml
- insert:
    - id: dsh-latex
      name: dsh-latex
      config:
        runtimeDir: /srv/dsh/runtimes/latex-runtime-linux-x64
```

Note that the loader resolves a bare `name` from the **profile directory**, so
the package must be a dependency of the profile (or of the dsh installation).

---

## 3. From scratch on a clean machine

```bash
git clone https://github.com/ste1lifex/dsh-latex
cd dsh-latex

# Nothing to build. There is no bundler, no transpiler and no npm dependency.
node --version            # must satisfy ^22.19.0 || >=24.0.0

node scripts/fetch-runtime.mjs
node scripts/warm-cache.mjs --profile=minimal

node --test "test/unit/**/*.test.mjs"
node --test "test/integration/**/*.test.mjs"
```

Expected output from the last two commands on a working machine:

```text
ℹ tests 29
ℹ pass 29
ℹ fail 0

✔ the plugin mounts its three tools into the real registry
✔ latex_health reports the resolved runtime through the registry
✔ argument validation rejects a call that supplies both sources
✔ latex_compile and latex_math produce real PDFs
✔ a broken document fails with a structured code and the engine log
ℹ tests 5
ℹ pass 5
```

---

## Operating it

### Cache profiles

Warming is additive: each profile adds what it needs to the existing cache.

| Profile | Adds | Cache after |
| --- | --- | --- |
| *(baseline, always)* | `amsmath`, `amssymb`, `amsfonts`, `graphicx`, `hyperref`, `xcolor`, `geometry`, `standalone`, `varwidth`, both `10pt` and `11pt` articles, the exact `latex_math` template, bold math | ~35 MB |
| `minimal` | nothing beyond the baseline | ~35 MB |
| `common` | `booktabs`, `array`, `longtable`, `tabularx`, `multirow`, `makecell`, `enumitem`, `caption`, `subcaption`, `float`, `fancyhdr`, `titlesec`, `setspace`, `parskip`, `microtype`, `listings`, `ulem`, `etoolbox`, `lmodern`, `csquotes`, … | ~65 MB |
| `chinese` | `ctex` + `xeCJK` + `ctexart` **with real Chinese text**, so the Fandol font files are fetched | ~75 MB |
| `full` | `tikz`, `pgfplots`, `circuitikz`, `chemfig`, `mhchem`, `biblatex`, `glossaries`, `siunitx`, `physics`, `cleveref`, `beamer` class, … | several hundred MB |

Measured on Windows x64 in one cold run, warming `minimal` → `chinese` → `common`
in sequence: **57.9 MB across 533 cached resources**, against a 49 MB engine
binary. Timings on the same machine: `minimal` ~5 min, `chinese` ~1 min,
`common` ~0.5 min — so plan on **5-7 minutes for a first run**.

Two details are easy to get wrong and are handled explicitly:

- The baseline document is warmed for **both `10pt` and `11pt`** articles,
  because `size10.clo` and `size11.clo` are different files.
- The `chinese` warm-up typesets **actual Chinese with `\texttt`**, because the
  ctex fandol fontset maps `\ttfamily` to `FandolFang-Regular`, and a Latin-only
  warm-up leaves that font missing.

### Physical fonts are completed explicitly

Warming decides which *metrics* (`.tfm`, `.fd`) are cached, but TeX needs the
matching **physical** font as well — and warming only ever resolves the design
sizes its own documents happen to use. The two gaps this leaves are:

- a Unicode shape with no `.otf` (e.g. `lmroman9-regular` cached but not
  `lmroman9-bold`, which `\texttt`/`\textbf` at 9pt needs);
- a Computer Modern metric with no `.pfb` outline (`cmmi9.tfm` without
  `cmmi9.pfb`), which kills the PDF step with
  `Cannot proceed without .vf or "physical" font for PDF output`.

So after warming, `warm-cache.mjs` reads the cache's `tu*.fd` declarations and
its `.tfm` inventory, and fetches whichever referenced font files are absent
(CTAN: the Latin Modern OpenType tree and the bakoma CM/AMS Type 1 tree). It is
idempotent and network-tolerant: with no network it reports what it could not
fetch and leaves the `--only-cached` self-check to decide usability. A few names
(`cmbsy5`, `cmmib5`) have no standalone outline anywhere and are reported as
notes, not failures.

### Offline mode

A cache that lacks a package fails a `--only-cached` compile with
`File '<something>' not found`; a cache missing a *font* fails with
`Cannot proceed without .vf or "physical" font for PDF output`. Fixes, in order
of preference:

1. warm a bigger profile (see above), which also completes physical fonts;
2. compile once online with `offline: false` — Tectonic fetches only what is
   missing, permanently;
3. set `offline: false` and accept per-document downloads.

### Updating the engine

`TECTONIC_VERSION` and every `sha256` in `scripts/lib/manifest.mjs` are a single
reviewed change. Never point the table at a mutable "latest" URL. After
bumping, run `fetch-runtime.mjs --force`, then re-run the warm-up and both test
suites.

### Using a Tectonic you already have

```yaml
- id: dsh-latex
  config:
    enginePath: /usr/local/bin/tectonic
```

`scripts/verify-runtime.mjs` still checks the reported version against the
pinned one; if you deliberately run a different version, skip the verify step in
your launcher.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `LATEX_ENGINE_MISSING` | No engine found. Run `fetch-runtime.mjs`, or set `enginePath`. `latex_health` prints every directory that was searched. |
| `LaTeX failed to compile …: File 'x.sty' not found` with `offline: true` | The cache lacks that package. Warm a bigger profile, or compile once online. |
| `Fontconfig error: Cannot load default config file` in the engine log | Cosmetic noise from the bare Windows Tectonic build. The plugin filters it out of reported logs. |
| `LATEX_FILE_ACCESS_DENIED` | The path is outside the session workspace and `allowedLocalRoots`. Add the directory to the config. |
| `LATEX_TIMEOUT` | Raise `timeout_ms` (ceiling `maxTimeoutMs`) for TikZ-heavy documents. |
| Engine downloads on every compile | `cacheDir` is not writable or is being redirected. Check `latex_health`'s `cacheDir` and `cacheFiles`. |
| Compile succeeds but no output path | The engine produced a different stem. Pass `output_path` explicitly. |
| `dsh-latex` silently missing after an upgrade | `logs\startup-fallback-latex.patch.yml` disabled it. Read the launcher output, fix the download, restart. |
