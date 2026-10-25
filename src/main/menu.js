'use strict';

/**
 * @file menu.js
 * @description Application menu providing the clipboard accelerators.
 *
 * Electron dispatches the standard editing shortcuts (Select All, Copy, Paste)
 * through the application menu. Without a menu there is no handler for these key
 * equivalents, so they are inert on macOS.
 *
 * The template is deliberately minimal: only the Edit submenu, plus the native
 * macOS app submenu (which restores Cmd+Q). No File/View/Window submenus and no
 * togglefullscreen role - F11 is handled by registerF11Handler in ipc.js.
 */

const { Menu } = require('electron');
const { LOG_SOURCE_APP } = require('./logger');

const CLIPBOARD_ROLES = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'];

/**
 * Builds the minimal menu template.
 * @param {string} platform – process.platform value
 * @returns {Array<Object>} menu template
 */
function buildMenuTemplate(platform) {
  const template = [];

  if (platform === 'darwin') {
    // Native macOS app submenu – its Quit item restores Cmd+Q.
    template.push({ role: 'appMenu' });
  }

  template.push({ label: 'Edit', submenu: CLIPBOARD_ROLES.map((role) => ({ role })) });

  return template;
}

/**
 * Logs a menu line when a logger is available. Logging must never crash the app.
 * @param {{ log: function }|null} logger
 * @param {string} message
 */
function logMenu(logger, message) {
  if (!logger) return;
  try {
    logger.log(LOG_SOURCE_APP, message);
  } catch (_) {
    // must not crash the app
  }
}

/**
 * Installs the application menu so the clipboard shortcuts work.
 * Errors are swallowed – must not crash the app.
 * @param {Function} [getLogger] – returns the current logger instance (lazy)
 */
function installApplicationMenu(getLogger) {
  const logger = getLogger ? getLogger() : null;

  try {
    const menu = Menu.buildFromTemplate(buildMenuTemplate(process.platform));
    Menu.setApplicationMenu(menu);
    logMenu(logger, 'application menu installed – clipboard accelerators enabled');
  } catch (_) {
    // must not crash the app
    logMenu(logger, 'application menu install failed – clipboard accelerators unavailable');
  }
}

module.exports = { installApplicationMenu };
