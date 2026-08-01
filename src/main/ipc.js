'use strict';

/**
 * @file ipc.js
 * @description Registers all IPC handlers for the main process.
 */

const { ipcMain, BrowserWindow, shell, screen } = require('electron');
const path = require('node:path');
const os = require('node:os');
const store = require('./store');
const renderSession = require('./render-session');
const { LOG_IPC_CHANNEL, LOG_SOURCE_WINDOW, LOG_SOURCE_APP } = require('./logger');

// ── Handler implementations ───────────────────────────────────────────────────

function onReset() {
  store.clearAll();
  const { app } = require('electron');
  app.relaunch();
  // exit(0), not quit(): with the single-instance lock, the relaunched instance
  // must be able to acquire the lock, which requires this process to release it
  // promptly. app.exit(0) terminates immediately; app.quit() is graceful and can
  // still hold the lock when the new instance starts (→ reset would just close
  // the app). Nothing needs a graceful close here — clearAll() already ran.
  app.exit(0);
}

function onRestart(event) {
  // Save window bounds before exiting – app.exit(0) bypasses the BrowserWindow
  // 'close' event, so without this the last position/size would be lost.
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && store.isInitialised()) {
    store.saveWindowBounds(win.getBounds());
  }
  const { app } = require('electron');
  app.relaunch();
  app.exit(0);
}

function onConfigSave(_event, config) {
  store.saveConfig(config);
}

async function onConfigLoad() {
  // Render-session override: once window.js
  // has fallen back from a failed Viewport-mode adoption to a configured
  // profile, this in-memory override takes priority over everything below —
  // otherwise the viewport-connection gate stays true (the store's `enabled`
  // flag is untouched by a fallback) and the render session would keep
  // authenticating as the viewport connection even though the window has
  // navigated to the fallback profile.
  const override = renderSession.getRenderCredentialOverride();
  if (override) return override;

  // Viewport mode: the render web-session authenticates with the DEDICATED
  // viewport connection — the preload's auto-login and unexpected-URL redirect
  // both read this object, so returning the connection here switches the
  // credential source without any renderer changes.
  const vp = store.getViewportConfig();
  if (vp.enabled && vp.url) {
    // viewportName drives the "Loading Viewport" overlay sub-line (preload.js):
    // the configured name, or the same `<hostname>_VIEWPORT` default shown as
    // a placeholder in the settings UI (store.js's defaultViewportName()).
    const viewportName = vp.name || `${os.hostname().toUpperCase()}_VIEWPORT`;
    return { url: vp.url, username: vp.username, password: vp.password, viewportName };
  }
  return store.getConfig();
}

function onOpenConfig(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.loadFile(path.join(__dirname, '../html/config.html'));
}

function onOpenExternal(_event, url) {
  shell.openExternal(url);
}

// ── getLogger reference (set during registerIpcHandlers) ─────────────────────
let _getLogger = null;

/** Returns the current logger instance (or null before it is wired up). */
function currentLogger() {
  return _getLogger ? _getLogger() : null;
}

function onOpenLogFile(_event, logPath) {
  const resolvedPath = logPath || (_getLogger && _getLogger() && _getLogger().getLogPath());
  if (resolvedPath) shell.openPath(resolvedPath);
}

function onOpenDevTools(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.webContents.openDevTools();
}

/**
 * Receives a log message forwarded from the preload/renderer via IPC.
 * @param {Function} getLogger – returns the current logger instance (lazy)
 */
function makeWindowLogHandler(getLogger) {
  return function onWindowLog(_event, message) {
    const logger = getLogger ? getLogger() : null;
    if (logger) logger.log(LOG_SOURCE_WINDOW, message);
  };
}

function onToggleFullscreen(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.setFullScreen(!win.isFullScreen());
  }
}

// ── Profile handlers ──────────────────────────────────────────────────────────

async function onProfilesLoad() {
  return store.getProfiles();
}

function onProfilesSave(_event, profiles) {
  store.saveProfiles(profiles);
}

async function onActiveProfileGet() {
  return store.getActiveProfileId();
}

function onActiveProfileSet(_event, id) {
  store.setActiveProfileId(id);
}

async function onStartupProfileGet() {
  return store.getStartupProfileId();
}

function onStartupProfileSet(_event, id) {
  store.setStartupProfileId(id);
}

// ── Startup settings handlers ─────────────────────────────────────────────────

async function onStartupSettingsGet() {
  return store.getStartupSettings();
}

function onStartupSettingsSet(_event, settings) {
  store.setStartupSettings(settings);
}

// ── Viewport config handlers ──────────────────────────────────────────────────

async function onViewportConfigGet() {
  // Renderer-safe: never ships the (decrypted or ciphertext) password.
  return store.getViewportConfigRedacted();
}

function onViewportConfigSet(_event, settings) {
  // Pure pass-through: the store owns passwordChanged handling and encryption.
  store.setViewportConfig(settings);
}

/**
 * Removes this viewer from Protect and resets the local device state:
 * logs in with the stored admin credentials, finds the viewer row by the
 * on-disk identity MAC, deletes it, then clears the identity dir and disables
 * Viewport mode. The local reset runs even when no row was found (stale row
 * already gone) — but NOT on a login/reach failure OR a rejected delete
 * (non-2xx), so the identity survives for a retry while the device row may
 * still exist on the console. Wiping the identity while the row remains would
 * orphan it permanently: the next enable mints a new MAC, and the old row
 * could never be found by MAC again.
 *
 * Secrets: the password is decrypted here in the MAIN process only, passed to
 * admin-api.login, and never logged or included in the returned payload.
 *
 * @returns {Promise<{ok: boolean, removed?: boolean, message: string}>}
 */
async function onViewportRemove() {
  const vp = store.getViewportConfig(); // MAIN-process only: decrypted password
  if (!vp.url || !vp.username || !vp.password) {
    return { ok: false, message: 'Viewport not configured' };
  }
  const adminApi = require('./viewport/adoption/admin-api');
  const { httpJson } = require('./viewport/adoption/mint');
  const { buildLoginRequest } = require('./viewport/adoption/token');
  const { loadOrCreateIdentity } = require('./viewport/adoption/identity');
  const { app } = require('electron');
  const dataDir = path.join(app.getPath('userData'), 'viewport');
  const dep = { httpJson, dataDir };
  let removed = false;
  try {
    const { cookie } = await adminApi.login(vp.url, vp.username, vp.password, {
      httpJson,
      buildLoginRequest,
      dataDir,
    });
    const identity = loadOrCreateIdentity(dataDir);
    const viewer = await adminApi.findViewerByMac(vp.url, cookie, identity.mac, dep);
    if (viewer) {
      removed = await adminApi.deleteViewer(vp.url, cookie, viewer.id, dep);
      if (!removed) {
        // Delete rejected (non-2xx, e.g. 403/500): the row is still on the
        // console, so treat it like a reach-failure — keep the identity and
        // the enabled flag so a retry can find the same row by MAC.
        return {
          ok: false,
          message:
            'The console refused to delete the device. Nothing was changed locally — try again.',
        };
      }
    }
  } catch (e) {
    // Identity intentionally NOT cleared: the device row may still exist on
    // the console, and keeping the identity lets a retry find it by MAC.
    return { ok: false, message: `Could not reach the console: ${e && e.message}` };
  }
  // Full local reset regardless of whether a row existed: the identity dir
  // holds the device cert/key/MAC, so removing it makes the next enable mint
  // a brand-new device instead of resurrecting the deleted one.
  try {
    require('node:fs').rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* best-effort: a locked file must not block disabling viewport mode */
  }
  // passwordChanged:false → store.setViewportConfig retains the stored password
  // ciphertext (store.js), so only `enabled` flips and the connection settings
  // survive for a later re-enable.
  store.setViewportConfig({ enabled: false, passwordChanged: false });
  return {
    ok: true,
    removed,
    message: removed
      ? 'Viewport removed from Protect.'
      : 'No matching device found; local identity reset.',
  };
}

/**
 * Returns a simplified list of all connected displays for the config UI.
 * Electron's display objects are not fully serialisable, so we map to a plain array.
 */
async function onDisplaysGet() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return displays.map((d, i) => ({
    index: i,
    id: d.id,
    isPrimary: d.id === primary.id,
    label:
      d.id === primary.id
        ? `Primary (${d.size.width}×${d.size.height})`
        : `Display ${i + 1} (${d.size.width}×${d.size.height})`,
    width: d.size.width,
    height: d.size.height,
    x: d.bounds.x,
    y: d.bounds.y,
  }));
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * F10: navigate to profile-select (>1 profiles) or config (1 profile).
 * Never loads a liveview URL directly – avoids did-fail-load confusion.
 */
function onSwitchNextProfile(event) {
  const profiles = store.getProfiles();
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (profiles.length <= 1) {
    win.loadFile(path.join(__dirname, '../html/config.html'));
  } else {
    win.loadFile(path.join(__dirname, '../html/profile-select.html'));
  }
}

/**
 * Directly launches a profile by ID without restarting.
 * Used by profile-select.html to avoid the restart→select loop.
 */
function onLaunchProfile(event, profileId) {
  const profiles = store.getProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) return;
  store.setActiveProfileId(profileId);

  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;

  const { updateTrayMenu } = require('./tray');
  updateTrayMenu(win);

  // Paint the window dark before navigation to avoid white flash
  win.webContents
    .executeJavaScript(
      `document.body.insertAdjacentHTML('beforeend','<div style="position:fixed;inset:0;z-index:2147483647;background:#0f1117"></div>')`,
    )
    .catch(() => {})
    .finally(() => {
      win.loadURL(profile.url, { userAgent: USER_AGENT });
    });
}

// ── F11 fullscreen via before-input-event ─────────────────────────────────────
// Electron has a built-in native F11 fullscreen toggle that fires *after*
// before-input-event. We must call preventDefault() on the event to suppress
// the native handler, then toggle fullscreen ourselves.

function registerF11Handler(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault(); // block Electron's own F11 handling
      win.setFullScreen(!win.isFullScreen());
    }
  });
}

// ── Registration ──────────────────────────────────────────────────────────────

function registerIpcHandlers(getLogger) {
  _getLogger = getLogger || null;
  ipcMain.on('reset', onReset);
  ipcMain.on('restart', onRestart);
  ipcMain.on('configSave', onConfigSave);
  ipcMain.on('openConfig', onOpenConfig);
  ipcMain.on('openExternal', onOpenExternal);
  ipcMain.on('openLogFile', onOpenLogFile);
  ipcMain.on('openDevTools', onOpenDevTools);
  ipcMain.on('toggleFullscreen', onToggleFullscreen);
  ipcMain.on('profilesSave', onProfilesSave);
  ipcMain.on('activeProfileSet', onActiveProfileSet);
  ipcMain.on('startupProfileSet', onStartupProfileSet);
  ipcMain.on('startupSettingsSet', onStartupSettingsSet);
  ipcMain.on('viewportConfigSet', onViewportConfigSet);
  ipcMain.on('switchNextProfile', onSwitchNextProfile);
  ipcMain.on('launchProfile', onLaunchProfile);
  ipcMain.on(LOG_IPC_CHANNEL, makeWindowLogHandler(getLogger));

  ipcMain.handle('configLoad', onConfigLoad);
  ipcMain.handle('profilesLoad', onProfilesLoad);
  ipcMain.handle('activeProfileGet', onActiveProfileGet);
  ipcMain.handle('startupProfileGet', onStartupProfileGet);
  ipcMain.handle('startupSettingsGet', onStartupSettingsGet);
  ipcMain.handle('viewportConfigGet', onViewportConfigGet);
  ipcMain.handle('viewportRemove', onViewportRemove);
  ipcMain.handle('displaysGet', onDisplaysGet);
}

module.exports = { registerIpcHandlers, registerF11Handler, makeWindowLogHandler, currentLogger };
