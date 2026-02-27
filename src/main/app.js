'use strict';

/**
 * @file app.js  (main entry point)
 * @description Application bootstrap – initialises Electron, registers IPC
 *              handlers, and creates the main window.
 */

const { app, Menu } = require('electron');
const { registerIpcHandlers } = require('./ipc');
const { createMainWindow } = require('./window');
const { createLogger, LOG_SOURCE_APP } = require('./logger');

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

// Logger is created once the app is ready (userData path available then).
let _logger = null;
function getLogger() {
  return _logger;
}

app.whenReady().then(async () => {
  // Initialise persistent logger (requires userData path → must be inside whenReady)
  _logger = createLogger({ app });
  _logger.log(LOG_SOURCE_APP, 'app ready – starting up');

  registerIpcHandlers(getLogger);
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
