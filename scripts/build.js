'use strict';

/**
 * @file build.js
 * @description Universal build script for Unifi Protect Viewer.
 *
 * Uses the electron-packager JS API (not CLI).
 *
 * For Windows targets built on a Linux runner, Wine is required so that
 * electron-packager (via rcedit) can embed the icon and PE metadata into
 * the .exe.  The CI workflow installs Wine before running this script.
 *
 * ── Environment variables ────────────────────────────────────────────────────
 *
 *   UPV_PLATFORM        Target platform: win32 | darwin | linux
 *   UPV_ARCH            Target CPU architecture: x64 | ia32 | arm64
 *   UPV_PORTABLE        "true" → portable build
 *   UPV_OUT_DIR         Output directory (default: "builds")
 *   UPV_ENCRYPTION_KEY  Encryption key for portable builds
 *                       Default: random 32-byte hex (set a fixed value for releases!)
 */

const packager = require('electron-packager');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// ── Read environment ──────────────────────────────────────────────────────────

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

// ── Derived values ────────────────────────────────────────────────────────────

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const appVersion = packageJson.version;
const appAuthor =
  typeof packageJson.author === 'string'
    ? packageJson.author
    : packageJson.author?.name || 'Unknown';
const appName = 'unifi-protect-viewer';

const iconMap = {
  win32: path.join(__dirname, '../src/img/128.ico'),
  darwin: path.join(__dirname, '../src/img/128.icns'),
  linux: path.join(__dirname, '../src/img/128.png'),
};
const icon = iconMap[platform] ?? iconMap.linux;

// ── Build config (baked into asar) ───────────────────────────────────────────

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

// ── Rename helper ─────────────────────────────────────────────────────────────

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

// ── Execute ───────────────────────────────────────────────────────────────────

console.log(`\n[build] ────────────────────────────────────────────`);
console.log(`[build] platform:  ${platform}`);
console.log(`[build] arch:      ${arch}`);
console.log(`[build] portable:  ${isPortable}`);
console.log(`[build] version:   ${appVersion}`);
console.log(`[build] output:    ${outDir}`);
console.log(`[build] runner:    ${process.platform}`);
console.log(`[build] icon:      ${icon}`);
console.log(`[build] ────────────────────────────────────────────\n`);

async function main() {
  writeBuildConfig();
  try {
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
      // Always set version + metadata – on Linux Wine handles the PE writes for win32
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
