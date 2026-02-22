'use strict';

/**
 * @file app.js  (main entry point)
 * @description Application bootstrap – initialises Electron, registers IPC
 *              handlers, and creates the main window.
 */

const { app, Menu } = require('electron');
const { registerIpcHandlers } = require('./ipc');
const { createMainWindow } = require('./window');

// ── Certificate handling ──────────────────────────────────────────────────────
// Unifi Protect commonly uses self-signed certificates, so we skip TLS errors.
app.commandLine.appendSwitch('ignore-certificate-errors', 'true');

// ── Remove default menu (disables native F11 accelerator and menu bar) ────────
Menu.setApplicationMenu(null);

// ── Dev: hot-reload ───────────────────────────────────────────────────────────
try {
  require('electron-reloader')(module);
} catch (_) {
  /* not available in production */
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  registerIpcHandlers();
  await createMainWindow();

  // macOS: re-create the window when the dock icon is clicked and no windows exist
  app.on('activate', async () => {
    const { BrowserWindow } = require('electron');
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, apps conventionally stay active until the user quits via Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
