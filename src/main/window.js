'use strict';

/**
 * @file window.js
 * @description Main browser window creation and lifecycle management.
 */

const { BrowserWindow, screen } = require('electron');
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
 * CLI `--profile <name>` overrides the store's startup profile (case-insensitive match by name).
 *
 * @param {BrowserWindow} win
 * @param {{ monitor: number|null, fullscreen: boolean|null, profile: string|null }} [cliArgs]
 */
async function loadInitialPage(win, cliArgs = {}) {
  const profiles = store.getProfiles();

  if (profiles.length === 0) {
    // First launch – show config
    await win.loadFile(path.join(__dirname, '../html/config.html'));
    return;
  }

  let activeProfile;

  // ── CLI --profile override (highest priority) ───────────────────────────────
  if (cliArgs.profile) {
    const needle = cliArgs.profile.toLowerCase();
    const found = profiles.find((p) => p.name.toLowerCase() === needle);
    if (found) {
      activeProfile = found;
      store.setActiveProfileId(found.id);
    }
    // If not found, fall through to normal startup logic
  }

  // ── Store startup profile ───────────────────────────────────────────────────
  if (!activeProfile) {
    const startupId = store.getStartupProfileId();
    if (startupId) {
      const found = profiles.find((p) => p.id === startupId);
      if (found) {
        activeProfile = found;
        store.setActiveProfileId(found.id);
      }
    }
  }

  // ── Single profile shortcut ─────────────────────────────────────────────────
  if (!activeProfile && profiles.length === 1) {
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
 *
 * @param {{ monitor: number|null, fullscreen: boolean|null, profile: string|null }} [cliArgs]
 *   Optional CLI startup argument overrides. These are runtime-only and do not modify the store.
 *   - `monitor`    1-based index of the display to use (overrides startupSettings.displayIndex)
 *   - `fullscreen` true → start fullscreen (overrides startupSettings.fullscreen)
 *   - `profile`    Profile name to auto-select (case-insensitive, overrides startupSettings.profileId)
 * @returns {Promise<BrowserWindow>}
 */
async function createMainWindow(cliArgs = {}) {
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

  // win.webContents.openDevTools();

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

  await loadInitialPage(win, cliArgs);

  // ── Apply display/fullscreen settings (CLI overrides take priority) ──────────
  const startupSettings = store.getStartupSettings();

  // CLI --fullscreen overrides store setting; null means "use store value"
  const effectiveFullscreen =
    cliArgs.fullscreen !== null && cliArgs.fullscreen !== undefined
      ? cliArgs.fullscreen
      : startupSettings.fullscreen;

  // Whether an explicit --monitor CLI arg was given
  const cliMonitorRequested = cliArgs.monitor !== null && cliArgs.monitor !== undefined;

  // Determine effective display index:
  //  - CLI --monitor (1-based) → subtract 1 for 0-based array index
  //  - Store displayIndex is used only when fullscreen is active (it controls which screen
  //    to go fullscreen on). Without fullscreen it must NOT override the saved window position.
  const effectiveDisplayIndex = cliMonitorRequested
    ? cliArgs.monitor - 1
    : (startupSettings.displayIndex ?? 0);

  // Reposition the window only when:
  //  - Fullscreen is requested (move to the target display first), OR
  //  - An explicit CLI --monitor arg was given (intentional monitor override)
  //
  // Importantly: store.displayIndex alone (without fullscreen) must NOT trigger a
  // setBounds() call — doing so would overwrite the user's saved window position.
  if (effectiveFullscreen || cliMonitorRequested) {
    const displays = screen.getAllDisplays();
    const idx = Math.max(0, Math.min(effectiveDisplayIndex, displays.length - 1));
    const targetDisplay = displays[idx];
    if (targetDisplay) {
      win.setBounds({
        x: targetDisplay.bounds.x,
        y: targetDisplay.bounds.y,
        width: targetDisplay.bounds.width,
        height: targetDisplay.bounds.height,
      });
    }
    if (effectiveFullscreen) {
      win.setFullScreen(true);
    }
  }

  return win;
}

module.exports = { createMainWindow };
