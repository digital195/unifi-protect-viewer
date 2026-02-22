'use strict';

/**
 * @file store.js
 * @description Persistent configuration storage.
 *
 * Supports two modes:
 *  - Standard: config is stored in the OS user-data directory (default)
 *  - Portable: config is stored next to the executable (store/ directory).
 *
 * The portable flag is baked into src/build-config.json at build time by
 * scripts/build.js. This file is packaged into the asar and read at runtime,
 * so the flag is reliably available without relying on environment variables.
 *
 * Fallback: if build-config.json is absent (e.g. during development with
 * `npm start`), the UPV_PORTABLE env var is used instead.
 */

const path = require('node:path');
const fs = require('node:fs');
const Store = require('electron-store');

// ── Portable detection ────────────────────────────────────────────────────────

function loadBuildConfig() {
  // __dirname is src/main/ inside the asar, so build-config.json is one level up
  const configPath = path.join(__dirname, '..', 'build-config.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (_) {
      // malformed file – fall through to env var fallback
    }
  }
  return null;
}

const buildConfig = loadBuildConfig();
const isPortable = buildConfig
  ? buildConfig.portable === true
  : process.env.UPV_PORTABLE === 'true';
const encryptionKey = buildConfig
  ? buildConfig.encryptionKey
  : process.env.UPV_ENCRYPTION_KEY || '****';

// process.resourcesPath is only available inside Electron; fall back for safety
const resourcesPath = process.resourcesPath ?? path.join(__dirname, '..', '..');
const portableDataDir = path.join(resourcesPath, 'store');

if (isPortable && !fs.existsSync(portableDataDir)) {
  fs.mkdirSync(portableDataDir, { recursive: true });
}

// ── Store instance ────────────────────────────────────────────────────────────
const store = isPortable
  ? new Store({
      name: 'storage',
      fileExtension: 'db',
      cwd: portableDataDir,
      encryptionKey,
    })
  : new Store();

// ── API ───────────────────────────────────────────────────────────────────────

// ── Migration ─────────────────────────────────────────────────────────────────
// If an old single-config entry exists and no profiles array yet, migrate it.
function migrateIfNeeded() {
  if (!store.has('profiles') && store.has('config')) {
    const old = store.get('config');
    const profile = {
      id: crypto.randomUUID(),
      name: 'Profile 1',
      url: old.url || '',
      username: old.username || '',
      password: old.password || '',
    };
    store.set('profiles', [profile]);
    store.set('activeProfileId', profile.id);
    store.delete('config');
  }
}

// ── Profiles ──────────────────────────────────────────────────────────────────

/** Returns all saved profiles (array). */
function getProfiles() {
  migrateIfNeeded();
  return store.get('profiles', []);
}

/** Persists the profiles array. */
function saveProfiles(profiles) {
  store.set('profiles', profiles);
}

/** Returns the active profile ID or undefined. */
function getActiveProfileId() {
  migrateIfNeeded();
  return store.get('activeProfileId');
}

/** Sets the active profile ID. */
function setActiveProfileId(id) {
  store.set('activeProfileId', id);
}

/** Returns the startup profile ID (auto-select on launch) or undefined. */
function getStartupProfileId() {
  return store.get('startupProfileId');
}

/** Sets the startup profile ID. Pass null/undefined to clear. */
function setStartupProfileId(id) {
  if (id) {
    store.set('startupProfileId', id);
  } else {
    store.delete('startupProfileId');
  }
}

/** Returns the active profile object, or undefined. */
function getActiveProfile() {
  const profiles = getProfiles();
  const id = getActiveProfileId();
  return profiles.find((p) => p.id === id) || profiles[0];
}

/** Returns whether at least one profile has been saved. */
function hasConfig() {
  migrateIfNeeded();
  return getProfiles().length > 0;
}

/**
 * Compatibility shim – returns the active profile as a "config" object.
 * @deprecated Use getActiveProfile() instead.
 */
function getConfig() {
  return getActiveProfile();
}

/**
 * Compatibility shim – saves config as the active profile (or creates a new one).
 * @deprecated Use saveProfiles() instead.
 */
function saveConfig(config) {
  const profiles = getProfiles();
  const id = getActiveProfileId();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx >= 0) {
    profiles[idx] = { ...profiles[idx], ...config };
    saveProfiles(profiles);
  } else {
    const newProfile = {
      id: crypto.randomUUID(),
      name: 'Profile 1',
      url: config.url || '',
      username: config.username || '',
      password: config.password || '',
    };
    saveProfiles([newProfile]);
    setActiveProfileId(newProfile.id);
  }
}

/** Returns the saved window bounds, or undefined. */
function getWindowBounds() {
  return store.get('bounds');
}

/** Persists window bounds. Only called in non-portable mode. */
function saveWindowBounds(bounds) {
  if (!isPortable) {
    store.set('bounds', bounds);
  }
}

/** Returns whether the app has been initialised (first-run flag). */
function isInitialised() {
  return store.has('init');
}

/** Marks the app as initialised. */
function markInitialised() {
  store.set('init', true);
}

/** Clears the entire store (full reset). */
function clearAll() {
  store.clear();
}

module.exports = {
  isPortable,
  getConfig,
  saveConfig,
  hasConfig,
  getProfiles,
  saveProfiles,
  getActiveProfileId,
  setActiveProfileId,
  getStartupProfileId,
  setStartupProfileId,
  getActiveProfile,
  getWindowBounds,
  saveWindowBounds,
  isInitialised,
  markInitialised,
  clearAll,
};
