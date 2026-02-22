'use strict';

/**
 * @file tray.js
 * @description System-tray icon and context menu.
 */

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('node:path');
const store = require('./store');

const ICON_PATH = path.join(__dirname, '../img/128.png');
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let tray = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true when the window still exists and is usable. */
function isWinAlive(win) {
  return win && !win.isDestroyed();
}

function toggleWindowVisibility(win) {
  if (!isWinAlive(win)) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

function openConfigPage(win) {
  if (!isWinAlive(win)) return;
  win.show();
  win.focus();
  win.loadFile(path.join(__dirname, '../html/config.html'));
}

function restart() {
  app.relaunch();
  app.quit();
}

function resetAndRestart() {
  store.clearAll();
  restart();
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

function quit() {
  destroyTray();
  app.quit();
}

/** Switches to a specific profile by ID and loads its URL. */
function switchToProfile(win, profileId) {
  if (!isWinAlive(win)) return;
  const profiles = store.getProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) return;
  store.setActiveProfileId(profileId);
  win.show();
  win.focus();
  // Load URL directly – no intermediate index.html to avoid white flash
  win.loadURL(profile.url, { userAgent: USER_AGENT });
  // Update context menu checkmarks without recreating the tray icon
  updateTrayMenu(win);
}

/**
 * Rebuilds only the context menu (updates profile radio checkmarks).
 * Much cheaper than createTray() – no icon destruction/creation.
 * Safe to call at any time; does nothing if no tray exists yet.
 * @param {import('electron').BrowserWindow} mainWindow
 */
function updateTrayMenu(mainWindow) {
  if (!tray) return;

  const profiles = store.getProfiles();
  const activeId = store.getActiveProfileId();
  const profileMenuItems =
    profiles.length > 0
      ? [
          { type: 'separator' },
          { label: 'Switch Profile', enabled: false },
          ...profiles.map((p) => ({
            label: p.name || p.url,
            type: 'radio',
            checked: p.id === activeId,
            click: () => switchToProfile(mainWindow, p.id),
          })),
        ]
      : [];

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => toggleWindowVisibility(mainWindow) },
    { type: 'separator' },
    { label: 'Edit Configuration', click: () => openConfigPage(mainWindow) },
    ...profileMenuItems,
    { type: 'separator' },
    { label: 'Restart', click: () => restart() },
    { label: 'Reset & Restart', click: () => resetAndRestart() },
    { type: 'separator' },
    { label: 'Quit', click: () => quit() },
  ]);

  tray.setContextMenu(contextMenu);
}

// ── Tray creation ─────────────────────────────────────────────────────────────

/**
 * Creates the system-tray icon and attaches a context menu to the given window.
 * @param {import('electron').BrowserWindow} mainWindow
 */
function createTray(mainWindow) {
  // Destroy any existing tray instance before creating a new one
  destroyTray();

  let icon = nativeImage.createFromPath(ICON_PATH);
  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 16, height: 16 });
    icon.setTemplateImage(true);
  } else {
    icon = icon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(icon);
  tray.setToolTip('Unifi Protect Viewer');

  // Build the context menu using updateTrayMenu so there's a single code path
  updateTrayMenu(mainWindow);

  tray.on('double-click', () => {
    if (!isWinAlive(mainWindow)) return;
    mainWindow.show();
    mainWindow.focus();
  });

  app.once('before-quit', destroyTray);
}

module.exports = { createTray, updateTrayMenu };
