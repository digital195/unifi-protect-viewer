'use strict';

/**
 * @file window.js
 * @description Main browser window creation and lifecycle management.
 */

const { BrowserWindow } = require('electron');
const path = require('node:path');
const store = require('./store');
const { createTray } = require('./tray');
const { registerF11Handler } = require('./ipc');

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 760;
const ICON_PATH = path.join(__dirname, '../img/128.png');

// ── Initial page loading ──────────────────────────────────────────────────────

/**
 * Loads the correct initial page:
 *  - Config page when no profiles have been saved yet.
 *  - Profile selection page when multiple profiles exist and no startup profile set.
 *  - Directly loads the liveview when one profile or startup profile configured.
 *
 * @param {BrowserWindow} win
 */
async function loadInitialPage(win) {
  const profiles = store.getProfiles();

  if (profiles.length === 0) {
    // First launch – show config
    await win.loadFile(path.join(__dirname, '../html/config.html'));
    return;
  }

  const startupId = store.getStartupProfileId();
  let activeProfile;

  if (startupId) {
    // Auto-select startup profile
    const found = profiles.find((p) => p.id === startupId);
    if (found) {
      activeProfile = found;
      store.setActiveProfileId(found.id);
    }
  }

  if (!activeProfile && profiles.length === 1) {
    // Only one profile – use it directly
    activeProfile = profiles[0];
    store.setActiveProfileId(profiles[0].id);
  }

  if (activeProfile) {
    // Load the liveview URL directly.
    // If the URL is unreachable, did-fail-load will show index.html.
    // We swallow the rejection here so the app does not crash.
    try {
      await win.loadURL(activeProfile.url, { userAgent: USER_AGENT });
    } catch (_) {
      // did-fail-load handler takes care of navigation to the error page
    }
  } else {
    // Multiple profiles, no auto-select → show profile selection
    await win.loadFile(path.join(__dirname, '../html/profile-select.html'));
  }

  if (!store.isInitialised()) {
    store.markInitialised();
  }
}

// ── Window factory ────────────────────────────────────────────────────────────

/**
 * Creates and returns the main application window.
 * @returns {Promise<BrowserWindow>}
 */
async function createMainWindow() {
  const bounds = store.getWindowBounds();

  const win = new BrowserWindow({
    width: bounds?.width ?? DEFAULT_WIDTH,
    height: bounds?.height ?? DEFAULT_HEIGHT,
    x: bounds?.x ?? undefined,
    y: bounds?.y ?? undefined,
    minWidth: 800,
    minHeight: 500,

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
      preload: path.join(__dirname, '../js/preload.js'),
      allowDisplayingInsecureContent: true,
      allowRunningInsecureContent: true,
    },

    icon: ICON_PATH,
    frame: true,
    movable: true,
    resizable: true,
    closable: true,
    autoHideMenuBar: true,
    backgroundColor: '#0f1117',
    show: false, // shown via ready-to-show to avoid white flash
  });

  // Keep a static title – Unifi Protect updates the title dynamically
  win.setTitle('Unifi Protect Viewer');
  win.on('page-title-updated', (e) => e.preventDefault());

  // Reveal window once the renderer is ready
  win.once('ready-to-show', () => win.show());

  // Persist window geometry on close (skipped in portable mode)
  win.on('close', () => {
    if (store.isInitialised()) {
      store.saveWindowBounds(win.getBounds());
    }
  });

  createTray(win);
  registerF11Handler(win);

  // On main-frame load failure → show the error page immediately. No timers.
  // ERR_ABORTED (-3) = cancelled by our own loadURL call → ignore.
  // isMainFrame is the 5th arg (index 4) of did-fail-load.
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (code === -3) return;
    if (!isMainFrame) return;
    if (['config.html', 'profile-select.html', 'index.html'].some((p) => (url || '').includes(p)))
      return;
    console.warn(`[upv] did-fail-load ${code} → ${url}`);
    win.loadFile(path.join(__dirname, '../html/index.html'));
  });

  await loadInitialPage(win);

  return win;
}

module.exports = { createMainWindow };
