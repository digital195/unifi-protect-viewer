'use strict';

/**
 * @file logger.js
 * @description Persistent rotating log writer for the Electron main process.
 *
 * Architecture:
 *  - createRotatingLogger(deps) returns a { log, getLogPath } object.
 *  - Rotation: when upv.log exceeds MAX_LOG_BYTES (5 MB):
 *      upv.log.2 → upv.log.3  (shift)
 *      upv.log.1 → upv.log.2  (shift)
 *      upv.log   → upv.log.1  (shift)
 *      create fresh upv.log
 *  - Maximum 3 archive files kept (upv.log.1 / .2 / .3).
 *  - All errors are swallowed – must never crash the app.
 *  - deps allows full dependency injection (fs, app) for deterministic tests.
 *
 * Legacy alias: createLogger() → createRotatingLogger()
 */

const node_path = require('node:path');
const node_fs = require('node:fs');

// ── Constants ─────────────────────────────────────────────────────────────────
const LOG_IPC_CHANNEL = 'upv:log';
const LOG_SOURCE_APP = 'app';
const LOG_SOURCE_WINDOW = 'window';
const LOG_FILE_NAME = 'upv.log';
const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ARCHIVES = 3;

/**
 * Formats a single log line.
 * @param {string} source  – 'app' | 'window'
 * @param {string} message
 * @param {Date}   [now]   – injected for deterministic tests
 * @returns {string}  e.g. "2026-03-01T12:01:22.123Z [upv app] Profile loaded"
 */
function formatLogLine(source, message, now = new Date()) {
  return `${now.toISOString()} [upv ${source}] ${message}`;
}

/**
 * Returns the absolute path to the log file.
 * @param {{ getPath: function }} electronApp
 * @returns {string}
 */
function resolveLogPath(electronApp) {
  return node_path.join(electronApp.getPath('userData'), LOG_FILE_NAME);
}

/**
 * Performs size-based log rotation.
 *
 * Rotation order (shift highest first to avoid overwrite):
 *   upv.log.2 → upv.log.3
 *   upv.log.1 → upv.log.2
 *   upv.log   → upv.log.1
 *
 * @param {string} logPath  – absolute path to upv.log
 * @param {object} fs       – fs module (real or mocked)
 */
function rotateLog(logPath, fs) {
  try {
    // Check whether rotation is needed
    let stat;
    try {
      stat = fs.statSync(logPath);
    } catch {
      return; // file does not exist yet – nothing to rotate
    }

    if (stat.size <= MAX_LOG_BYTES) return;

    // Shift archives from highest to lowest to avoid clobber
    for (let i = MAX_ARCHIVES - 1; i >= 1; i--) {
      const src = `${logPath}.${i}`;
      const dest = `${logPath}.${i + 1}`;
      try {
        fs.statSync(src); // throws if missing → skip
        try {
          fs.unlinkSync(dest);
        } catch {
          /* dest may not exist */
        }
        fs.renameSync(src, dest);
      } catch {
        /* skip missing archives silently */
      }
    }

    // Move current log → upv.log.1
    try {
      fs.unlinkSync(`${logPath}.1`);
    } catch {
      /* may not exist */
    }
    fs.renameSync(logPath, `${logPath}.1`);
  } catch {
    /* swallow all rotation errors – must not crash the app */
  }
}

/**
 * Factory that creates a rotating logger instance.
 *
 * @param {{ fs?: object, app?: object }} [deps]
 * @returns {{ log: function, getLogPath: function }}
 */
function createRotatingLogger(deps = {}) {
  const fs = deps.fs || node_fs;
  const electronApp =
    deps.app ||
    (() => {
      try {
        return require('electron').app;
      } catch {
        return null;
      }
    })();

  let logPath = null;

  function getLogPath() {
    if (logPath) return logPath;
    if (!electronApp) return null;
    try {
      logPath = resolveLogPath(electronApp);
    } catch {
      logPath = null;
    }
    return logPath;
  }

  /**
   * Writes a log entry, rotating the log file first if needed.
   * @param {string} source   – 'app' | 'window'
   * @param {string} message
   * @param {Date}   [now]
   */
  function log(source, message, now) {
    try {
      const p = getLogPath();
      if (!p) return;
      rotateLog(p, fs);
      const line = formatLogLine(source, message, now) + '\n';
      fs.appendFileSync(p, line, 'utf8');
    } catch {
      /* swallow – must not crash the app */
    }
  }

  return { log, getLogPath };
}

/** Backward-compatible alias */
const createLogger = createRotatingLogger;

module.exports = {
  createLogger,
  createRotatingLogger,
  rotateLog,
  formatLogLine,
  resolveLogPath,
  LOG_IPC_CHANNEL,
  LOG_SOURCE_APP,
  LOG_SOURCE_WINDOW,
  LOG_FILE_NAME,
  MAX_LOG_BYTES,
  MAX_ARCHIVES,
};
