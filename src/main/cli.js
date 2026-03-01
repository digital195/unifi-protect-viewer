'use strict';

/**
 * @file cli.js
 * @description Parses Electron CLI startup arguments.
 *
 * Supported arguments:
 *   --monitor <n>      Launch on monitor n (1-based, e.g. 1 = primary, 2 = second monitor)
 *   --fullscreen       Start in fullscreen mode
 *   --profile <name>   Load the named profile on startup (case-insensitive)
 *
 * CLI arguments are runtime-only overrides — they do NOT modify the persisted store.
 *
 * @example
 *   // Launch on second monitor, fullscreen, with profile "Warehouse":
 *   unifi-protect-viewer.exe --monitor 2 --fullscreen --profile "Warehouse"
 */

/**
 * @typedef {Object} CliArgs
 * @property {number|null}  monitor    - 1-based monitor index, or null if not specified / invalid
 * @property {boolean|null} fullscreen - true if --fullscreen flag was given, null if not specified
 * @property {string|null}  profile    - Profile name string, or null if not specified
 */

/**
 * Parses CLI arguments from the given argv array (defaults to process.argv).
 *
 * Electron passes additional flags (e.g. --inspect, --enable-logging) in argv —
 * unknown flags are silently ignored so no compatibility issues arise.
 *
 * argv layout differs between dev and packaged:
 *   Dev (npm start):  [electron, app.js, ...userArgs]   → user args start at index 2
 *   Packaged (.exe):  [app.exe,  ...userArgs]            → user args start at index 1
 *
 * We handle both by scanning the full argv for any of our known flags rather
 * than relying on a fixed slice offset.
 *
 * @param {string[]} [argv]  Argument vector to parse. Defaults to process.argv.
 * @returns {CliArgs}
 */
function parseCliArgs(argv) {
  // Use the full argv – we search for our flags by name, so the offset doesn't matter.
  const args = argv ?? process.argv;

  /** @type {CliArgs} */
  const result = {
    monitor: null,
    fullscreen: null,
    profile: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--fullscreen') {
      result.fullscreen = true;
      continue;
    }

    if (arg === '--monitor') {
      const raw = args[i + 1];
      if (raw !== undefined && !raw.startsWith('--')) {
        const parsed = parseInt(raw, 10);
        if (!isNaN(parsed) && parsed >= 1) {
          result.monitor = parsed;
        }
        i++; // consume value token only when it was a value (not a flag)
      }
      continue;
    }

    if (arg === '--profile') {
      const raw = args[i + 1];
      if (raw !== undefined && !raw.startsWith('--') && raw.trim().length > 0) {
        result.profile = raw.trim();
        i++; // consume value token only when it was a value (not a flag)
      }
    }

    // All other flags (e.g. Electron internals like --inspect=9229, --no-sandbox) are ignored.
  }

  return result;
}

module.exports = { parseCliArgs };
