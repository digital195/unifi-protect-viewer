'use strict';

/**
 * @file release.js
 * @description Release helper for Unifi Protect Viewer.
 *
 * Usage:
 *   node scripts/release.js <version>
 *   npm run release -- <version>
 *
 * What it does:
 *   1. Validates the version string (semver, optionally with pre-release label).
 *   2. Updates "version" in package.json and package-lock.json.
 *   3. git add -A
 *   4. git commit -m "release version <version>"
 *   5. git tag -a v<version> -m "release version <version>"
 *   6. git push origin <current-branch>
 *   7. git push origin v<version>
 *
 * Works on macOS, Linux and Windows (PowerShell / CMD) – only Node.js required.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');

function run(cmd) {
  console.log(`  > ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  // Preserve trailing newline that npm writes
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function step(title) {
  console.log(`\n== ${title} ==`);
}

// ── Validate input ────────────────────────────────────────────────────────────

const version = process.argv[2];

if (!version) {
  console.error('Usage: node scripts/release.js <version>');
  console.error('       npm run release -- <version>');
  console.error('');
  console.error('Examples:');
  console.error('  node scripts/release.js 1.2.0');
  console.error('  node scripts/release.js 1.2.0-rc1');
  console.error('  node scripts/release.js 2.0.0-beta.3');
  process.exit(1);
}

// Accept standard semver + optional pre-release / build-metadata suffixes
const SEMVER_RE = /^\d+\.\d+\.\d+([.-][a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?$/;
if (!SEMVER_RE.test(version)) {
  console.error(`[release] ERROR: "${version}" is not a valid version string.`);
  console.error('[release]        Expected format: MAJOR.MINOR.PATCH[-prerelease]');
  console.error('[release]        Examples: 1.2.3  |  1.2.3-rc1  |  2.0.0-beta.1');
  process.exit(1);
}

const tag = `v${version}`;

// ── Check for uncommitted changes (warn, don't abort) ────────────────────────

step('pre-flight checks');

try {
  const status = execSync('git status --porcelain', { cwd: ROOT }).toString().trim();
  if (status) {
    console.log(
      '[release] Working tree has uncommitted changes – they will be included in the release commit:',
    );
    console.log(
      status
        .split('\n')
        .map((l) => `           ${l}`)
        .join('\n'),
    );
  } else {
    console.log('[release] Working tree is clean.');
  }
} catch {
  console.warn('[release] Could not check git status – continuing anyway.');
}

// Detect current branch for the push step
let currentBranch = 'main';
try {
  currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim();
} catch {
  console.warn('[release] Could not detect current branch – will push to "main".');
}

console.log(`[release] version  : ${version}`);
console.log(`[release] tag      : ${tag}`);
console.log(`[release] branch   : ${currentBranch}`);

// ── 1. Update package.json ────────────────────────────────────────────────────

step('version update');

const pkgPath = path.join(ROOT, 'package.json');
const pkg = readJson(pkgPath);
const oldVersion = pkg.version;
pkg.version = version;
writeJson(pkgPath, pkg);
console.log(`[release] package.json: ${oldVersion} → ${version}`);

// ── 2. Update package-lock.json (if present) ─────────────────────────────────

const lockPath = path.join(ROOT, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = readJson(lockPath);
  lock.version = version;
  // lockfile v2/v3: also update the root package entry
  if (lock.packages?.['']) {
    lock.packages[''].version = version;
  }
  writeJson(lockPath, lock);
  console.log(`[release] package-lock.json updated to ${version}`);
} else {
  console.log('[release] package-lock.json not found – skipping.');
}

// ── 3. Git commit ─────────────────────────────────────────────────────────────

step('git commit');
run('git add -A');
run(`git commit -m "release version ${version}"`);

// ── 4. Git tag ────────────────────────────────────────────────────────────────

step('git tag');
run(`git tag -a ${tag} -m "release version ${version}"`);

// ── 5. Git push ───────────────────────────────────────────────────────────────

step('git push');
run(`git push origin ${currentBranch}`);
run(`git push origin ${tag}`);

// ── Done ──────────────────────────────────────────────────────────────────────

console.log(`\n✓ Released ${tag} successfully.\n`);
