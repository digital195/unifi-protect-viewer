'use strict';

/**
 * @file app.js  (main entry point)
 * @description Application bootstrap – initialises Electron, registers IPC
 *              handlers, and creates the main window.
 */

const { app } = require('electron');
const { registerIpcHandlers } = require('./ipc');
const { installApplicationMenu } = require('./menu');
const { createMainWindow } = require('./window');
const { createLogger, LOG_SOURCE_APP } = require('./logger');
const { parseCliArgs } = require('./cli');

// ── Certificate handling ──────────────────────────────────────────────────────
// Unifi Protect commonly uses self-signed certificates, so we skip TLS errors.
app.commandLine.appendSwitch('ignore-certificate-errors', 'true');

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
  _logger.log(
    LOG_SOURCE_APP,
    `runtime: electron ${process.versions.electron} / chromium ${process.versions.chrome} on ${process.platform}`,
  );

  // The application menu carries the clipboard accelerators (select all, copy, paste).
  // Without a menu those key equivalents have no handler on macOS. The template is
  // minimal (Edit only) so the kiosk UI stays free of menu chrome.
  installApplicationMenu(getLogger);

  // Parse CLI startup arguments (runtime-only overrides, not persisted to store)
  const cliArgs = parseCliArgs();
  if (cliArgs.monitor !== null || cliArgs.fullscreen !== null || cliArgs.profile !== null) {
    _logger.log(LOG_SOURCE_APP, `CLI args: ${JSON.stringify(cliArgs)}`);
  }

  registerIpcHandlers(getLogger);
  await createMainWindow(cliArgs);

  // macOS: re-create the window when the dock icon is clicked and no windows exist.
  // Do NOT pass cliArgs here – the CLI overrides only apply to the initial launch.
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
