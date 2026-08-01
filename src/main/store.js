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
const os = require('node:os');
const Store = require('electron-store');
const secure = require('./secure');

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

/** Returns the startup profile ID (auto-select on launch) or undefined.
 * @deprecated Prefer getStartupSettings().profileId
 */
function getStartupProfileId() {
  return getStartupSettings().profileId ?? store.get('startupProfileId');
}

/** Sets the startup profile ID. Pass null/undefined to clear.
 * @deprecated Prefer setStartupSettings({ profileId })
 */
function setStartupProfileId(id) {
  const current = getStartupSettings();
  setStartupSettings({ ...current, profileId: id || null });
}

// ── Global startup settings ────────────────────────────────────────────────────

/**
 * Returns the global startup settings object.
 * @returns {{ profileId: string|null, fullscreen: boolean, displayIndex: number }}
 */
function getStartupSettings() {
  return store.get('startupSettings', {
    profileId: null,
    fullscreen: false,
    displayIndex: 0,
  });
}

/**
 * Persists the global startup settings object.
 * Merges the provided partial object with the current settings.
 * @param {{ profileId?: string|null, fullscreen?: boolean, displayIndex?: number }} settings
 */
function setStartupSettings(settings) {
  const current = store.get('startupSettings', {
    profileId: null,
    fullscreen: false,
    displayIndex: 0,
  });
  const merged = { ...current, ...settings };
  store.set('startupSettings', merged);
  // Keep legacy key in sync for any code that still reads 'startupProfileId' directly
  if (merged.profileId) {
    store.set('startupProfileId', merged.profileId);
  } else {
    store.delete('startupProfileId');
  }
}

// ── Viewport mode ──────────────────────────────────────────────────────────────

const VIEWPORT_DEFAULTS = Object.freeze({
  enabled: false,
  name: '',
  url: '',
  username: '',
  password: '', // stored form: encryptSecret(...) output ('' = not set)
  fallbackProfileId: null,
});

/** Default device name shown as a placeholder and used when name is empty. */
function defaultViewportName() {
  return `${os.hostname().toUpperCase()}_VIEWPORT`;
}

/**
 * One-time migration of the legacy manual seed keys:
 *   adoptUser → username, adoptPass → encrypted password, adopt → implied.
 * Legacy adopt mode had no dedicated URL — it rode the active profile's URL,
 * so `url` is backfilled from the active profile to preserve adopting behavior.
 */
function migrateViewportIfNeeded() {
  const raw = store.get('viewport');
  if (!raw) return;
  if (!('adopt' in raw) && !('adoptUser' in raw) && !('adoptPass' in raw)) return;
  const migrated = {
    enabled: !!raw.enabled,
    name: raw.name || '',
    url: raw.url || (raw.adopt ? (getActiveProfile() || {}).url || '' : ''),
    username: raw.username || raw.adoptUser || '',
    password: raw.password || (raw.adoptPass ? secure.encryptSecret(raw.adoptPass) : ''),
    fallbackProfileId: raw.fallbackProfileId ?? null,
  };
  store.set('viewport', migrated);
}

/** Stored (ciphertext) form, defaults merged. Internal. */
function getStoredViewport() {
  migrateViewportIfNeeded();
  return { ...VIEWPORT_DEFAULTS, ...store.get('viewport', {}) };
}

/**
 * MAIN-PROCESS ONLY: returns the viewport config with the password DECRYPTED
 * for launch use (adoption + render auto-login). Never ship this to a renderer
 * settings surface — use getViewportConfigRedacted() there.
 * @returns {{ enabled:boolean, name:string, url:string, username:string,
 *             password:string, fallbackProfileId:string|null }}
 */
function getViewportConfig() {
  const stored = getStoredViewport();
  return { ...stored, password: secure.decryptSecret(stored.password) };
}

/**
 * Renderer-safe view of the viewport config: everything EXCEPT the password,
 * plus hasPassword / encryptionAvailable / defaultName for the settings card.
 */
function getViewportConfigRedacted() {
  const stored = getStoredViewport();
  return {
    enabled: stored.enabled,
    name: stored.name,
    url: stored.url,
    username: stored.username,
    fallbackProfileId: stored.fallbackProfileId,
    hasPassword: !!stored.password,
    encryptionAvailable: secure.isSecretEncryptionAvailable(),
    defaultName: defaultViewportName(),
  };
}

/**
 * Merges and persists the viewport config. Password handling mirrors the
 * profile form's "unchanged" pattern (config.html:1747): only when
 * `settings.passwordChanged === true` is the incoming password (re-)encrypted;
 * otherwise the stored ciphertext is retained and any incoming value ignored.
 * @param {{ enabled?:boolean, name?:string, url?:string, username?:string,
 *           password?:string, passwordChanged?:boolean,
 *           fallbackProfileId?:string|null }} settings
 * @returns {object} the merged stored-form (ciphertext) config
 */
function setViewportConfig(settings) {
  const stored = getStoredViewport();
  const { password, passwordChanged, ...rest } = settings || {};
  const merged = { ...stored, ...rest };
  merged.password = passwordChanged ? secure.encryptSecret(password || '') : stored.password;
  store.set('viewport', merged);
  return merged;
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
  getStartupSettings,
  setStartupSettings,
  getViewportConfig,
  getViewportConfigRedacted,
  setViewportConfig,
  getActiveProfile,
  getWindowBounds,
  saveWindowBounds,
  isInitialised,
  markInitialised,
  clearAll,
};
