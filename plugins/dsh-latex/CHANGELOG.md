# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Offline compiles failed on ordinary documents with an opaque xdvipdfmx
  error.** Warming the cache only ever resolved the design sizes its warm-up
  documents happened to use, so the 9pt/8pt physical fonts stayed missing and
  any document with `\small`, a footnote containing math, or a small table died
  with `Cannot proceed without .vf or "physical" font`. `scripts/warm-cache.mjs`
  now warms a dedicated font-size sweep (`\tiny`..`\huge`, footnote math, nested
  scripts, big delimiters) and includes it in the `--only-cached` self-check, so
  an incomplete cache fails the warm-up instead of a later user document.
- **The real reason for a back-end failure was discarded.** `tailOf` dropped the
  indented `caused by:` line that xdvipdfmx prints beneath its opaque
  `something bad happened inside xdvipdfmx` one-liner, so a missing font was
  reported with no actionable detail. `caused by:` is now treated as a
  first-class diagnostic and reaches both `errors[]` and the log tail;
  per-message `warning:` chatter is dropped from the tail instead, so the
  terminal failure stays readable.

### Added

- `completeFontFiles()` in `scripts/warm-cache.mjs`: after warming, it diffs the
  cache's Unicode `.fd` declarations and Computer Modern `.tfm` metrics against
  the files present, and fetches the missing physical fonts (Latin Modern
  OpenType, CM/AMS Type 1). Warming alone reliably left both kinds of gap — for
  the shipped cache, 44 of 60 Latin Modern fonts and 22 CM/AMS outlines were
  absent.

## [0.2.0] - 2026-09-30

### Changed

- **DeepSeek Harness 0.2 support.** `peerDependencies` for
  `@deepseek-ai/dsh-llm` and `@deepseek-ai/dsh-tools` now read
  `^0.1.0-rc.6 || ^0.2.0-rc.1`, and the manifest advertises
  `dsh.engines.dsh` as `>=0.1.0-rc.6 <0.3.0`. DSH 0.2 checks every
  `@deepseek-ai/dsh*` peer range against the running runtime before it mounts a
  bundle, and skips a bundle whose range does not match; the old
  `^0.1.0-rc.6`-only declaration therefore made DSH 0.2.0-rc.2 report
  `skipping profile bundle dsh-latex` and register none of the `latex_*` tools.
  No plugin code changed: `@deepseek-ai/dsh-tools` is byte-identical between
  0.1.7-rc.2 and 0.2.0-rc.2, `HarnessError(message, code, options)` is unchanged,
  and the pinned `@deepseek-ai/cordis` 4.0.4 is the same release in both.
- `@deepseek-ai/dsh-llm` is now marked optional in `peerDependenciesMeta`: the
  plugin already works without it (`lib/harness-error.js` falls back to a plain
  `Error` prefixed with the stable `CODE:`).

### Added

- `test/unit/dsh-compat.test.mjs`: guards the manifest against exactly this
  drift. It resolves the installed DSH runtime version and asserts that every
  DSH peer range — and `dsh.engines.dsh` — still admits it, skipping (never
  failing) outside a DSH installation.

## [0.1.0] - 2026-02-14

### Added

- `latex_health`, `latex_compile` and `latex_math` tools for DeepSeek Harness.
- Pinned **Tectonic 0.17.0** engine fetched by `scripts/fetch-runtime.mjs` from
  the upstream GitHub Release, with SHA-256 verification for `win32-x64`,
  `darwin-x64`, `darwin-arm64`, `linux-x64` and `linux-arm64`.
- Dependency-free ZIP and `tar.gz` extractors that refuse absolute or
  traversing archive members.
- `scripts/warm-cache.mjs` profiles (`minimal`, `common`, `chinese`, `full`)
  that pre-populate the TeX resource cache and prove it with a `--only-cached`
  compile.
- `scripts/verify-runtime.mjs` for launcher-side runtime validation.
- Path authorization for both reads and writes, including real-path checks
  against symlink escapes and a UNC/device-path rejection before any filesystem
  call.
- Offline mode: `offline: true` in configuration, or `offline: true` per call.
- Documentation-driven defaults that treat every document as untrusted, which
  disables `\write18` shell escape unless an operator opts in.

[Unreleased]: https://github.com/ste1lifex/dsh-latex/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ste1lifex/dsh-latex/releases/tag/v0.2.0
[0.1.0]: https://github.com/ste1lifex/dsh-latex/releases/tag/v0.1.0
