'use strict';

/**
 * @file build.js
 * @description Universal build script for Unifi Protect Viewer.
 *
 * Uses the @electron/packager JS API (not CLI).
 *
 * Windows icon/metadata embedding is handled by the pure-JS `resedit`
 * library, so Windows targets can be built on any host platform – no
 * Wine required.
 *
 * ── Environment variables ────────────────────────────────────────────────────
 *
 *   UPV_PLATFORM        Target platform: win32 | darwin | linux
 *   UPV_ARCH            Target CPU architecture: x64 | ia32 | arm64
 *   UPV_PORTABLE        "true" → portable build
 *   UPV_OUT_DIR         Output directory (default: "builds")
 *   UPV_ENCRYPTION_KEY  Encryption key for portable builds
 *                       Default: random 32-byte hex (set a fixed value for releases!)
 *   UPV_MAC_SIGN_IDENTITY macOS signing identity (default: "-" = ad-hoc).
 *                       Only effective for darwin builds on a macOS host;
 *                       set a "Developer ID Application: …" value for real signing.
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// ── Constants ────────────────────────────────────────────────────────────────

const appName = 'unifi-protect-viewer';
const appBundleId = 'com.digital195.unifi-protect-viewer';

const iconMap = {
  win32: path.join(__dirname, '../src/img/128.ico'),
  darwin: path.join(__dirname, '../src/img/128.icns'),
  linux: path.join(__dirname, '../src/img/128.png'),
};

// ── Packager options (exported for unit tests) ───────────────────────────────

function buildPackagerOptions(env = process.env, hostPlatform = process.platform) {
  const platform = env.UPV_PLATFORM || process.platform;
  const arch = env.UPV_ARCH || process.arch;
  const outDir = env.UPV_OUT_DIR || 'builds';

  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const appVersion = packageJson.version;
  const appAuthor =
    typeof packageJson.author === 'string'
      ? packageJson.author
      : packageJson.author?.name || 'Unknown';
  const icon = iconMap[platform] ?? iconMap.linux;

  // Ad-hoc sign darwin builds by default (valid bundle signature instead of the
  // bare linker signature, see GitHub issue #20). Override with UPV_MAC_SIGN_IDENTITY
  // (e.g. a Developer ID value) for real signing. codesign only exists on macOS
  // hosts, so non-darwin hosts skip signing entirely.
  //
  // identityValidation must stay false: while validation is active, `identity` is a
  // keychain search term and an unmatched value (including the ad-hoc `-`) throws
  // "No identity found for signing." instead of signing. With validation disabled
  // the value goes straight to `codesign --sign <hash||name>`, so `-` seals the
  // bundle ad-hoc and a Developer ID name resolves to that certificate.
  // continueOnError=false fails the build on a signing error instead of shipping an
  // unsealed bundle.
  const signDarwin = platform === 'darwin' && hostPlatform === 'darwin';
  const osxSignOptions = signDarwin
    ? {
        identity: env.UPV_MAC_SIGN_IDENTITY || '-',
        identityValidation: false,
        continueOnError: false,
      }
    : null;

  const options = {
    dir: './',
    name: appName,
    platform,
    arch,
    out: outDir,
    overwrite: true,
    asar: true,
    prune: true,
    icon,
    // Always set version + metadata – resedit embeds them into the .exe (no Wine)
    appVersion,
    ...(platform === 'win32'
      ? {
          win32metadata: {
            CompanyName: appAuthor,
            FileDescription: 'Unifi Protect Viewer',
            ProductName: 'Unifi Protect Viewer',
          },
        }
      : {}),
    // Proper bundle identifier for macOS (packager default would be com.electron.<appname>)
    ...(platform === 'darwin' ? { appBundleId } : {}),
    ...(osxSignOptions ? { osxSign: osxSignOptions } : {}),
    // Exclude files that do not belong in the distributed bundle
    ignore: [
      /^\/builds(\/|$)/,
      /^\/screenshots(\/|$)/,
      /^\/scripts(\/|$)/,
      /^\/\.gitea(\/|$)/,
      /^\/\.git(\/|$)/,
      /^\/\.husky(\/|$)/,
      /^\/(README|CHANGELOG|CONTRIBUTING)(\..*)?$/i,
    ],
  };

  return options;
}

module.exports = { buildPackagerOptions };

if (require.main === module) {
  // ── Read environment ───────────────────────────────────────────────────────

  const platform = process.env.UPV_PLATFORM || process.platform;
  const arch = process.env.UPV_ARCH || process.arch;
  const isPortable = process.env.UPV_PORTABLE === 'true';
  const outDir = process.env.UPV_OUT_DIR || 'builds';
  const encryptionKey = process.env.UPV_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

  if (isPortable && !process.env.UPV_ENCRYPTION_KEY) {
    console.warn(
      '[build] WARNING: UPV_ENCRYPTION_KEY is not set – a random key was generated for this build.',
    );
    console.warn(
      '[build]          The config store will NOT be readable by any other build of this app.',
    );
    console.warn(
      '[build]          Set UPV_ENCRYPTION_KEY to a fixed value for distributable portable releases.',
    );
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const appVersion = packageJson.version;
  const icon = iconMap[platform] ?? iconMap.linux;

  // ── Build config (baked into asar) ────────────────────────────────────────

  const BUILD_CONFIG_PATH = path.join(__dirname, '../src/build-config.json');

  function writeBuildConfig() {
    fs.writeFileSync(
      BUILD_CONFIG_PATH,
      JSON.stringify({ portable: isPortable, encryptionKey }, null, 2),
    );
    console.log(`[build] wrote build-config.json (portable=${isPortable})`);
  }

  function removeBuildConfig() {
    if (fs.existsSync(BUILD_CONFIG_PATH)) {
      fs.unlinkSync(BUILD_CONFIG_PATH);
      console.log('[build] removed build-config.json');
    }
  }

  // ── Rename helper ─────────────────────────────────────────────────────────

  function renameOutputDir() {
    const srcName = `${appName}-${platform}-${arch}`;
    const dstName = `${appName}-${platform}-${arch}-${appVersion}${isPortable ? '-portable' : ''}`;
    const srcPath = path.join(outDir, srcName);
    const dstPath = path.join(outDir, dstName);

    if (fs.existsSync(srcPath) && !fs.existsSync(dstPath)) {
      fs.renameSync(srcPath, dstPath);
      console.log(`[build] renamed: ${srcName} → ${dstName}`);
    }
  }

  // ── Execute ───────────────────────────────────────────────────────────────

  console.log(`\n[build] ────────────────────────────────────────────`);
  console.log(`[build] platform:  ${platform}`);
  console.log(`[build] arch:      ${arch}`);
  console.log(`[build] portable:  ${isPortable}`);
  console.log(`[build] version:   ${appVersion}`);
  console.log(`[build] output:    ${outDir}`);
  console.log(`[build] runner:    ${process.platform}`);
  console.log(`[build] icon:      ${icon}`);
  console.log(`[build] ────────────────────────────────────────────\n`);

  if (platform === 'darwin' && process.platform !== 'darwin') {
    console.warn(
      `[build] NOTE: skipping macOS code signing – target is darwin but host is ${process.platform} (codesign requires a macOS host).`,
    );
  }

  async function main() {
    writeBuildConfig();
    try {
      // @electron/packager is an ESM-only package – load it via dynamic import
      // so this CommonJS script works on any Node version that supports ESM.
      const { packager } = await import('@electron/packager');
      const options = buildPackagerOptions();

      const appPaths = await packager(options);
      console.log('[build] packager output:', appPaths);

      renameOutputDir();

      console.log('\n[build] ✓ Done.\n');
    } catch (err) {
      console.error('\n[build] ✗ Build failed:', err.message || err);
      process.exit(1);
    } finally {
      removeBuildConfig();
    }
  }

  main();
}
