'use strict';

/**
 * @file ipc.js
 * @description Registers all IPC handlers for the main process.
 */

const { ipcMain, BrowserWindow, shell, screen } = require('electron');
const path = require('node:path');
const store = require('./store');
const { LOG_IPC_CHANNEL, LOG_SOURCE_WINDOW, LOG_SOURCE_APP } = require('./logger');

// ── Handler implementations ───────────────────────────────────────────────────

function onReset() {
  store.clearAll();
  const { app } = require('electron');
  app.relaunch();
  app.quit();
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
  ipcMain.on('switchNextProfile', onSwitchNextProfile);
  ipcMain.on('launchProfile', onLaunchProfile);
  ipcMain.on(LOG_IPC_CHANNEL, makeWindowLogHandler(getLogger));

  ipcMain.handle('configLoad', onConfigLoad);
  ipcMain.handle('profilesLoad', onProfilesLoad);
  ipcMain.handle('activeProfileGet', onActiveProfileGet);
  ipcMain.handle('startupProfileGet', onStartupProfileGet);
  ipcMain.handle('startupSettingsGet', onStartupSettingsGet);
  ipcMain.handle('displaysGet', onDisplaysGet);
}

module.exports = { registerIpcHandlers, registerF11Handler, makeWindowLogHandler };
