'use strict';

/**
 * @file main.js  – Electron main process entry point
 *
 * This file is intentionally kept minimal. All logic lives in src/main/:
 *   app.js    – application bootstrap & lifecycle
 *   ipc.js    – IPC handler registration
 *   store.js  – persistent storage
 *   tray.js   – system-tray icon
 *   window.js – main window factory
 */

require('./main/app');
