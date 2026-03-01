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

// ── Display helpers ───────────────────────────────────────────────────────────

/**
 * Returns all displays sorted in a predictable order that matches what the user
 * sees in Windows Display Settings: primary display first, then remaining
 * displays sorted left-to-right, then top-to-bottom by their top-left corner.
 *
 * This ensures that --monitor 1 = primary, --monitor 2 = next display to the
 * right, regardless of the arbitrary order Electron / the OS reports them in.
 *
 * @returns {Electron.Display[]}
 */
function getSortedDisplays() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();

  return [...displays].sort((a, b) => {
    // Primary always comes first
    if (a.id === primary.id) return -1;
    if (b.id === primary.id) return 1;
    // Then sort by x (left to right), break ties by y (top to bottom)
    if (a.bounds.x !== b.bounds.x) return a.bounds.x - b.bounds.x;
    return a.bounds.y - b.bounds.y;
  });
}

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
  const startupSettings = store.getStartupSettings();

  // ── Resolve effective display/fullscreen settings before creating the window ─
  // CLI always wins over store settings.

  // CLI --fullscreen overrides store setting; null means "use store value"
  const effectiveFullscreen =
    cliArgs.fullscreen !== null && cliArgs.fullscreen !== undefined
      ? cliArgs.fullscreen
      : startupSettings.fullscreen;

  // Whether an explicit --monitor CLI arg was given (1-based)
  const cliMonitorRequested = cliArgs.monitor !== null && cliArgs.monitor !== undefined;

  // Determine effective 0-based display index:
  //  - CLI --monitor (1-based) always wins → subtract 1
  //  - Store displayIndex is only respected when fullscreen is active (no CLI monitor given)
  const effectiveDisplayIndex = cliMonitorRequested
    ? cliArgs.monitor - 1
    : (startupSettings.displayIndex ?? 0);

  // ── Calculate initial window position/size ───────────────────────────────────
  // Saved bounds may contain Fullscreen coordinates from the previous session.
  // We must never use those for normal (non-fullscreen) window placement.
  //
  // Strategy:
  //   • Fullscreen requested         → target display origin + full display size
  //   • --monitor requested, no FS   → target display, centered, DEFAULT size (never stale FS bounds)
  //   • Neither                      → restore saved bounds (position + size)

  let initialX;
  let initialY;
  let initialWidth;
  let initialHeight;

  if (effectiveFullscreen || cliMonitorRequested) {
    const displays = getSortedDisplays();
    const idx = Math.max(0, Math.min(effectiveDisplayIndex, displays.length - 1));
    const targetDisplay = displays[idx];

    if (effectiveFullscreen) {
      // Full display dimensions – Electron will enter fullscreen on this display
      initialX = targetDisplay.bounds.x;
      initialY = targetDisplay.bounds.y;
      initialWidth = targetDisplay.bounds.width;
      initialHeight = targetDisplay.bounds.height;
    } else {
      // --monitor without --fullscreen: centre window on target display.
      // Always use DEFAULT size – saved bounds may be stale Fullscreen coords.
      initialWidth = DEFAULT_WIDTH;
      initialHeight = DEFAULT_HEIGHT;
      initialX =
        targetDisplay.bounds.x + Math.round((targetDisplay.bounds.width - initialWidth) / 2);
      initialY =
        targetDisplay.bounds.y + Math.round((targetDisplay.bounds.height - initialHeight) / 2);
    }
  } else {
    // Restore last saved position/size (no CLI overrides active)
    initialX = bounds?.x ?? undefined;
    initialY = bounds?.y ?? undefined;
    initialWidth = bounds?.width ?? DEFAULT_WIDTH;
    initialHeight = bounds?.height ?? DEFAULT_HEIGHT;
  }

  const win = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    x: initialX,
    y: initialY,
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

  // ── Track pre-fullscreen bounds so we never persist fullscreen coordinates ───
  // When the window enters fullscreen, getBounds() returns the display's full
  // size. We capture the windowed bounds *before* entering fullscreen so the
  // next launch always restores the correct windowed position/size.
  let preFsBounds = null;

  win.on('enter-full-screen', () => {
    preFsBounds = win.getBounds();
  });

  win.on('leave-full-screen', () => {
    // Bounds are restored by Electron automatically; clear our snapshot
    preFsBounds = null;
  });

  // Apply fullscreen after window is created
  if (effectiveFullscreen) {
    // Save the initial windowed bounds before going fullscreen so that if the
    // user quits while still in fullscreen we have a sane fallback
    preFsBounds = {
      x: initialX ?? 0,
      y: initialY ?? 0,
      width: initialWidth,
      height: initialHeight,
    };
    win.setFullScreen(true);
  }

  // Reveal window once the renderer is ready
  win.once('ready-to-show', () => win.show());

  // Persist window geometry on close – always save pre-fullscreen bounds when
  // available so the next launch opens in the correct windowed position/size.
  win.on('close', () => {
    if (store.isInitialised()) {
      const boundsToSave = preFsBounds ?? win.getBounds();
      store.saveWindowBounds(boundsToSave);
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

  return win;
}

module.exports = { createMainWindow };
