/**
 * Pinned third-party runtime assets.
 *
 * The engine is Tectonic, a single-binary, self-contained TeX engine
 * (MIT licensed). Nothing here is rebuilt or repackaged: the upstream GitHub
 * Release asset is downloaded byte-for-byte and checked against the SHA-256
 * recorded below, so the plugin repository stays a few hundred kilobytes and a
 * fresh machine only needs Node to become fully capable.
 *
 * Updating the engine is a reviewed two-line change: bump `TECTONIC_VERSION`
 * and every `sha256` together. Never point this at a mutable "latest" URL.
 */

export const TECTONIC_VERSION = '0.17.0';
export const TECTONIC_RELEASE_TAG = `tectonic@${TECTONIC_VERSION}`;
export const TECTONIC_RELEASE_BASE =
  `https://github.com/tectonic-typesetting/tectonic/releases/download/${encodeURIComponent(TECTONIC_RELEASE_TAG)}`;

/**
 * @typedef {object} EngineAsset
 * @property {string} file release asset file name
 * @property {'zip' | 'tar.gz'} kind archive container
 * @property {string} sha256 lowercase hex digest of the archive
 * @property {string} binary file name inside the archive
 * @property {string} target Rust target triple, for diagnostics
 */

/** @type {Record<string, EngineAsset>} */
export const ENGINE_ASSETS = Object.freeze({
  'win32-x64': {
    file: `tectonic-${TECTONIC_VERSION}-x86_64-pc-windows-msvc.zip`,
    kind: 'zip',
    sha256: 'f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f',
    binary: 'tectonic.exe',
    target: 'x86_64-pc-windows-msvc'
  },
  'darwin-x64': {
    file: `tectonic-${TECTONIC_VERSION}-x86_64-apple-darwin.tar.gz`,
    kind: 'tar.gz',
    sha256: '7c90ef5b6ddb1eb1937e4337add5237b79338e4b9676459fa91187d24d6cdf80',
    binary: 'tectonic',
    target: 'x86_64-apple-darwin'
  },
  'darwin-arm64': {
    file: `tectonic-${TECTONIC_VERSION}-aarch64-apple-darwin.tar.gz`,
    kind: 'tar.gz',
    sha256: 'a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667',
    binary: 'tectonic',
    target: 'aarch64-apple-darwin'
  },
  'linux-x64': {
    file: `tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz`,
    kind: 'tar.gz',
    sha256: '8533d07f9ccbd7a65824b9e0459041bca34af1eb33daba48f59215593753a3b7',
    binary: 'tectonic',
    target: 'x86_64-unknown-linux-musl'
  },
  'linux-arm64': {
    file: `tectonic-${TECTONIC_VERSION}-aarch64-unknown-linux-musl.tar.gz`,
    kind: 'tar.gz',
    sha256: 'b10954a95404f3ab2328d2fa59a5ebab8e657f893fab096f98be8db7c0c979b8',
    binary: 'tectonic',
    target: 'aarch64-unknown-linux-musl'
  }
});

/**
 * Platforms upstream does not publish a usable standalone binary for. The
 * Windows GNU build is excluded on purpose: it is dynamically linked against a
 * MinGW runtime that the release archive does not ship, so it fails with
 * STATUS_DLL_NOT_FOUND on a clean machine.
 *
 * @type {Record<string, string>}
 */
export const UNSUPPORTED_PLATFORMS = Object.freeze({
  'win32-arm64': 'Tectonic publishes no aarch64-pc-windows asset. Run the harness under x64 emulation, or point enginePath at a Tectonic you built yourself.'
});

/**
 * @param {NodeJS.Platform} [platform]
 * @param {string} [arch]
 * @returns {string}
 */
export function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

/**
 * @param {NodeJS.Platform} [platform]
 * @param {string} [arch]
 * @returns {EngineAsset}
 */
export function assetFor(platform = process.platform, arch = process.arch) {
  const key = platformKey(platform, arch);
  const unsupported = UNSUPPORTED_PLATFORMS[key];
  if (unsupported !== undefined) {
    throw new Error(`No pinned Tectonic runtime for ${key}. ${unsupported}`);
  }
  const asset = ENGINE_ASSETS[key];
  if (asset === undefined) {
    throw new Error(
      `No pinned Tectonic runtime for ${key}. Supported: ${Object.keys(ENGINE_ASSETS).join(', ')}. `
      + 'You can still install Tectonic yourself and set `enginePath` in the dsh-latex loader config.'
    );
  }
  return asset;
}

/**
 * @param {EngineAsset} asset
 * @returns {string}
 */
export function assetUrl(asset) {
  return `${TECTONIC_RELEASE_BASE}/${asset.file}`;
}
