'use strict';

/**
 * @file window.js
 * @description Main browser window creation and lifecycle management.
 */

const { BrowserWindow, screen, app } = require('electron');
const path = require('node:path');
const os = require('node:os');
const store = require('./store');
const renderSession = require('./render-session');
const { createTray } = require('./tray');
const { registerF11Handler, currentLogger } = require('./ipc');
const { LOG_SOURCE_APP } = require('./logger');
const { ViewportBridge } = require('./viewport/bridge');
const { assignmentTargetUrl } = require('./viewport/assignment');
const { AdoptionClient } = require('./viewport/adoption');
const { startNativeViewport } = require('./viewport/native');

/** Diagnostic log helper for viewport mode → routes to upv.log. */
function vlog(msg) {
  const logger = currentLogger();
  if (logger) logger.log(LOG_SOURCE_APP, `[viewport] ${msg}`);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 760;
const ICON_PATH = path.join(__dirname, '../img/128.png');

/** Grace window: if a fallback profile is configured and the viewport never
 * comes online within this window, load the fallback instead. */
const FALLBACK_GRACE_MS = 60_000;

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

// ── Viewport mode ─────────────────────────────────────────────────────────────

/**
 * Builds a bootstrap fetcher that runs `fetch` inside the logged-in Protect page
 * (via executeJavaScript), so it uses the page's real authenticated session.
 * @param {BrowserWindow} win
 * @param {string} baseUrl - the active profile URL (origin is derived from it)
 * @returns {() => Promise<object>}
 */
function makeBootstrapFetcher(win, baseUrl) {
  const origin = new URL(baseUrl).origin;
  // Fetch from the PAGE'S authenticated context. The logged-in Protect SPA holds
  // the session (JSESSIONID/TOKEN) that the API requires; a main-process
  // net.request does not carry that auth (it only sees JSESSIONID and gets 401).
  // executeJavaScript runs in the page, so the browser attaches the page's
  // cookies exactly as the SPA's own API calls do.
  const js = `fetch(${JSON.stringify(origin + '/proxy/protect/api/bootstrap')}, { credentials: 'include' })
    .then(function (r) { if (!r.ok) { throw new Error('HTTP ' + r.status); } return r.json(); })`;
  return function fetchBootstrap() {
    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      return Promise.reject(new Error('window destroyed'));
    }
    return win.webContents.executeJavaScript(js, true);
  };
}

/** userData-based, per-app viewport data dir (identity, key, cert, pins). */
function viewportDataDir() {
  return path.join(app.getPath('userData'), 'viewport');
}

/**
 * Loads the configured fallback profile when the viewport connection cannot
 * establish (design: fatal reject / no online within the grace window).
 * A fallbackProfileId that no longer resolves is treated as "no fallback".
 * @param {BrowserWindow} win
 * @returns {boolean} true if a fallback profile was loaded
 */
function loadFallbackProfile(win) {
  const vp = store.getViewportConfig();
  if (!vp.fallbackProfileId) return false;
  const profile = store.getProfiles().find((p) => p.id === vp.fallbackProfileId);
  if (!profile) {
    vlog(
      `fallback profile ${vp.fallbackProfileId} no longer exists – staying on viewport connection`,
    );
    return false;
  }
  vlog(`viewport connection failed – falling back to profile "${profile.name}"`);
  // Make the render session actually BE the
  // fallback profile — url AND creds — not just the window's navigation
  // target. Without this, ipc.js's onConfigLoad keeps returning the viewport
  // connection (its `enabled`/`url` gate is untouched by a fallback), so
  // preload.js's unexpected-URL redirect bounces a different-origin fallback
  // straight back to the viewport, and the auto-login form fills with the
  // viewport's admin creds instead of the fallback profile's own.
  renderSession.setRenderCredentialOverride({
    url: profile.url,
    username: profile.username,
    password: profile.password,
  });
  store.setActiveProfileId(profile.id);
  if (!win.isDestroyed()) {
    win
      .loadURL(profile.url, { userAgent: USER_AGENT })
      .catch((e) => vlog(`fallback navigation failed: ${e.message}`));
  }
  return true;
}

/**
 * Starts Viewport mode for a window if enabled:
 *  - Adoption mode (dedicated `connection.url` set): runs a real UCP
 *    AdoptionClient device connection and navigates the window to the
 *    natively-assigned Live View. Adoption state is pushed to the renderer
 *    overlay via the 'viewportStatus' IPC channel
 *    ('registering' → 'online-unassigned' → 'assigned', plus 'reconnecting'
 *    whenever the adoption link drops).
 *  - Otherwise: falls back to the bootstrap poller (existing behavior,
 *    no status pushes).
 * @param {BrowserWindow} win
 * @param {{ url:string, username?:string, password?:string }} connection - the
 *   dedicated viewport connection or the active profile (bootstrap-poller path)
 * @returns {ViewportBridge|{stop:()=>void}|null}
 */
function startViewportBridge(win, connection) {
  const vp = store.getViewportConfig();
  if (!vp.enabled) return null;

  // ── Adoption mode: native UCP device connection drives navigation ────────────
  if (vp.url) {
    const client = new AdoptionClient();
    const deviceName = vp.name || `${os.hostname().toUpperCase()}_VIEWPORT`;
    // Push adoption state to the renderer overlay (preload.js listens on
    // 'viewportStatus'). Guarded so it is a no-op on a destroyed window and on
    // the main-process test mock, whose webContents has no send()/isDestroyed().
    const sendStatus = (s) => {
      if (win.isDestroyed()) return;
      const wc = win.webContents;
      if (!wc || typeof wc.send !== 'function') return;
      if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return;
      wc.send('viewportStatus', s);
    };
    const navigate = (target) => {
      if (win.isDestroyed()) return;
      vlog(`native assignment → navigating ${target}`);
      sendStatus('assigned');
      win
        .loadURL(target, { userAgent: USER_AGENT })
        .catch((e) => vlog(`navigation failed: ${e.message}`));
    };
    const handle = startNativeViewport({ client, baseUrl: connection.url, navigate, log: vlog });

    // ── Fallback plumbing: fatal error or no online within the grace
    // window → load the configured fallback profile instead. ──────────────────
    let sawOnline = false;
    let graceTimer = null;
    const clearGrace = () => {
      if (graceTimer) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
    };
    if (vp.fallbackProfileId) {
      graceTimer = setTimeout(() => {
        if (!sawOnline) {
          vlog(`no successful online within ${FALLBACK_GRACE_MS / 1000}s grace window`);
          if (loadFallbackProfile(win)) handle.stop();
        }
      }, FALLBACK_GRACE_MS);
      // Never let this timer keep the process alive on its own – real app
      // usage always clears it via 'closed'/'online'/fatal-error, but a test
      // (or an app-quit race) that never reaches those must not hang on a
      // dangling 60s handle.
      if (typeof graceTimer.unref === 'function') graceTimer.unref();
    }

    client.on('online', (v) => {
      vlog(v ? 'viewport ONLINE' : 'viewport offline');
      if (v) {
        sawOnline = true;
        clearGrace();
        sendStatus('online-unassigned');
      } else {
        // Adoption link dropped (pre-assignment the overlay is still up) —
        // don't let it linger on "assign a Live View" while offline. The
        // client reconnects on its own; a successful reconnect re-sends
        // 'online-unassigned' above.
        sendStatus('reconnecting');
      }
    });
    client.on('error', (e) => {
      // Only a STRICT `=== true` is fatal; `undefined`/`false` are transient and
      // the underlying connection already retries/reconnects on its own.
      const fatal = e && e.fatal === true;
      vlog(`adoption error${fatal ? ' (FATAL)' : ''}: ${e && e.message}`);
      if (fatal) {
        // Unrecoverable (e.g. rejected fingerprint, bad admin creds) – tear
        // down, then try the configured fallback profile (no-op when none /
        // stale).
        handle.stop();
        clearGrace();
        if (!loadFallbackProfile(win)) {
          // A fatal error with no usable fallback must
          // NEVER leave the app silently stuck on a dead Protect login page
          // – log clearly and send the user to config so they can recover
          // (fix creds, add a fallback profile, etc).
          vlog('FATAL adoption error with no usable fallback – surfacing via config page');
          if (!win.isDestroyed()) {
            win.loadFile(path.join(__dirname, '../html/config.html'));
          }
        }
      }
    });
    vlog(`adoption client starting for "${deviceName}" (dataDir ${viewportDataDir()})`);
    sendStatus('registering');
    // The dedicated connection's admin creds drive the one-time adopt; a
    // pre-adopted viewer reconnects keyless via its pinned cert (creds then
    // only serve the render auto-login, via ipc.js configLoad).
    client.start({
      url: connection.url,
      username: connection.username || undefined,
      password: connection.password || undefined,
      deviceName,
      dataDir: viewportDataDir(),
    });
    win.on('closed', () => {
      clearGrace();
      handle.stop();
    });
    return handle;
  }

  // ── Fallback: bootstrap poller (non-adoption) ─────────────────────────────────
  if (!vp.name) return null;
  const bridge = new ViewportBridge({
    name: vp.name,
    fetchBootstrap: makeBootstrapFetcher(win, connection.url),
  });
  let currentTarget = null;
  let lastOk;
  vlog(`bridge starting for "${vp.name}" (origin ${new URL(connection.url).origin})`);
  bridge.on('status', (s) => {
    // Log only on connected/disconnected transitions to keep the log readable.
    if (s.ok !== lastOk) {
      lastOk = s.ok;
      vlog(s.ok ? 'connected to Protect (bootstrap ok)' : `waiting for Protect: ${s.error}`);
    }
  });
  bridge.on('assignment', (liveviewId) => {
    // A poll can resolve after the window has been closed – never touch a
    // destroyed window.
    if (win.isDestroyed()) return;
    const target = assignmentTargetUrl(connection.url, liveviewId);
    vlog(`assignment liveviewId=${liveviewId} → target ${target}`);
    if (target === currentTarget) {
      vlog('  (same as current target – skipping navigation)');
      return;
    }
    currentTarget = target;
    win
      .loadURL(target, { userAgent: USER_AGENT })
      .catch((e) => vlog(`navigation failed: ${e.message}`));
  });
  bridge.start();
  win.on('closed', () => bridge.stop());
  return bridge;
}

// ── Initial page loading ──────────────────────────────────────────────────────

/**
 * Loads the correct initial page:
 *  - Viewport mode (dedicated connection configured) TOP-LEVEL overrides every
 *    profile path below — see the viewport branch at the top of this function.
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
  // A normal launch must never inherit a stale render-session override left
  // by a previous window's fallback in this same process (render-session
  // state is process-memory, not per-window/per-launch) — always start clean.
  // Real fallbacks are decided later, asynchronously, from AdoptionClient
  // events fired well after this point, so clearing here cannot race them.
  renderSession.clear();

  // ── Viewport mode: top-level override ───────────────────────────────────────
  // A dedicated connection beats every profile path (select/config included).
  // NOTE: the `enabled` flag is a UI-only convenience gate, not a security
  // boundary — an incomplete connection (no url) must never crash or start a
  // broken adoption; it simply falls through to the unchanged profile flow.
  const vp = store.getViewportConfig();
  if (vp.enabled && vp.url) {
    vlog(`viewport mode active – dedicated connection ${vp.url}`);
    try {
      await win.loadURL(vp.url, { userAgent: USER_AGENT });
    } catch (_) {
      // did-fail-load handler takes care of navigation to the error page
    }
    startViewportBridge(win, {
      url: vp.url,
      username: vp.username || undefined,
      password: vp.password || undefined,
    });
    if (!store.isInitialised()) {
      store.markInitialised();
    }
    return;
  }
  if (vp.enabled && !vp.url) {
    vlog(
      'viewport enabled but no dedicated URL – using profile flow (bootstrap poller if name set)',
    );
  }

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
    // Viewport mode: follow the Live View shared to this device.
    startViewportBridge(win, activeProfile);
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
