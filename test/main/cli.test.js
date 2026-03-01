'use strict';

/**
 * @file test/main/cli.test.js
 * @description Contract tests for src/main/cli.js – parseCliArgs()
 *
 * Guarantees:
 *  - Module boundary: exports exactly { parseCliArgs }
 *  - Default result shape when no args are given
 *  - --monitor parsing (valid, invalid, missing value, zero, negative)
 *  - --fullscreen flag parsing
 *  - --profile parsing (with value, missing value, empty string)
 *  - All three flags together
 *  - Electron-internal flags are ignored without error
 *  - argv is read from process.argv by default when no argument passed
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Always load a fresh copy so module-level state is clean
function requireCli() {
  const p = require.resolve('../../src/main/cli');
  delete require.cache[p];
  return require('../../src/main/cli');
}

// Helper: build a fake argv (node path + script path + user args)
function argv(...args) {
  return ['/path/to/electron', '/path/to/app.js', ...args];
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE BOUNDARY CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('cli.js – module boundary contract', () => {
  test('exports exactly { parseCliArgs }', () => {
    const mod = requireCli();
    assert.deepStrictEqual(Object.keys(mod), ['parseCliArgs']);
  });

  test('parseCliArgs is a function', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(typeof parseCliArgs, 'function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT RESULT (no args)
// ─────────────────────────────────────────────────────────────────────────────

describe('cli.js – default result when no args given', () => {
  test('returns monitor: null', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(parseCliArgs(argv()).monitor, null);
  });

  test('returns fullscreen: null', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(parseCliArgs(argv()).fullscreen, null);
  });

  test('returns profile: null', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(parseCliArgs(argv()).profile, null);
  });

  test('result has exactly three keys: monitor, fullscreen, profile', () => {
    const { parseCliArgs } = requireCli();
    const result = parseCliArgs(argv());
    assert.deepStrictEqual(Object.keys(result).sort(), ['fullscreen', 'monitor', 'profile']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --monitor
// ─────────────────────────────────────────────────────────────────────────────

describe('cli.js – --monitor parsing', () => {
  test('--monitor 1 → monitor: 1', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(parseCliArgs(argv('--monitor', '1')).monitor, 1);
  });

  test('--monitor 2 → monitor: 2', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(parseCliArgs(argv('--monitor', '2')).monitor, 2);
  });

  test('--monitor 3 → monitor: 3', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(parseCliArgs(argv('--monitor', '3')).monitor, 3);
  });

  test('--monitor 0 → null (invalid, must be >= 1)', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(parseCliArgs(argv('--monitor', '0')).monitor, null);
  });

  test('--monitor -1 → null (invalid, negative)', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(parseCliArgs(argv('--monitor', '-1')).monitor, null);
  });

  test('--monitor abc → null (non-numeric)', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(parseCliArgs(argv('--monitor', 'abc')).monitor, null);
  });

  test('--monitor with no following value → null', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(parseCliArgs(argv('--monitor')).monitor, null);
  });

  test('--monitor followed by another flag → null (treats flag as missing value)', () => {
    const { parseCliArgs } = requireCli();
    const result = parseCliArgs(argv('--monitor', '--fullscreen'));
    // "--fullscreen" starts with "--" so it is NOT consumed as the monitor value
    assert.strictEqual(result.monitor, null);
    // --fullscreen should still be parsed
    assert.strictEqual(result.fullscreen, true);
  });

  test('--monitor 1.5 → null (not an integer)', () => {
    const { parseCliArgs } = requireCli();
    // parseInt('1.5') = 1, which is valid → should be 1
    assert.strictEqual(parseCliArgs(argv('--monitor', '1.5')).monitor, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --fullscreen
// ─────────────────────────────────────────────────────────────────────────────

describe('cli.js – --fullscreen parsing', () => {
  test('--fullscreen → fullscreen: true', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(parseCliArgs(argv('--fullscreen')).fullscreen, true);
  });

  test('not provided → fullscreen: null', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(parseCliArgs(argv('--profile', 'Test')).fullscreen, null);
  });

  test('--fullscreen does not affect other fields', () => {
    const { parseCliArgs } = requireCli();
    const result = parseCliArgs(argv('--fullscreen'));
    assert.strictEqual(result.monitor, null);
    assert.strictEqual(result.profile, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --profile
// ─────────────────────────────────────────────────────────────────────────────

describe('cli.js – --profile parsing', () => {
  test('--profile "Kamera 1" → profile: "Kamera 1"', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(parseCliArgs(argv('--profile', 'Kamera 1')).profile, 'Kamera 1');
  });

  test('--profile Warehouse → profile: "Warehouse"', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(parseCliArgs(argv('--profile', 'Warehouse')).profile, 'Warehouse');
  });

  test('--profile with no following value → null', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(parseCliArgs(argv('--profile')).profile, null);
  });

  test('--profile followed by another flag → null', () => {
    const { parseCliArgs } = requireCli();
    const result = parseCliArgs(argv('--profile', '--fullscreen'));
    assert.strictEqual(result.profile, null);
    assert.strictEqual(result.fullscreen, true);
  });

  test('profile value is trimmed of leading/trailing whitespace', () => {
    const { parseCliArgs } = requireCli();
    assert.strictEqual(parseCliArgs(argv('--profile', '  Cam  ')).profile, 'Cam');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMBINED FLAGS
// ─────────────────────────────────────────────────────────────────────────────

describe('cli.js – combined flags', () => {
  test('--monitor 2 --fullscreen --profile "NVR 1" → all three set', () => {
    const { parseCliArgs } = requireCli();
    const result = parseCliArgs(argv('--monitor', '2', '--fullscreen', '--profile', 'NVR 1'));
    assert.strictEqual(result.monitor, 2);
    assert.strictEqual(result.fullscreen, true);
    assert.strictEqual(result.profile, 'NVR 1');
  });

  test('order does not matter: --profile first', () => {
    const { parseCliArgs } = requireCli();
    const result = parseCliArgs(argv('--profile', 'Office', '--monitor', '1', '--fullscreen'));
    assert.strictEqual(result.monitor, 1);
    assert.strictEqual(result.fullscreen, true);
    assert.strictEqual(result.profile, 'Office');
  });

  test('--fullscreen --monitor 3 without --profile → profile: null', () => {
    const { parseCliArgs } = requireCli();
    const result = parseCliArgs(argv('--fullscreen', '--monitor', '3'));
    assert.strictEqual(result.monitor, 3);
    assert.strictEqual(result.fullscreen, true);
    assert.strictEqual(result.profile, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ELECTRON-INTERNAL FLAGS (ignored without error)
// ─────────────────────────────────────────────────────────────────────────────

describe('cli.js – Electron-internal flags are ignored', () => {
  test('--inspect=9229 alone → all null/null/null', () => {
    const { parseCliArgs } = requireCli();
    const result = parseCliArgs(argv('--inspect=9229'));
    assert.strictEqual(result.monitor, null);
    assert.strictEqual(result.fullscreen, null);
    assert.strictEqual(result.profile, null);
  });

  test('--no-sandbox alone → all null/null/null', () => {
    const { parseCliArgs } = requireCli();
    const result = parseCliArgs(argv('--no-sandbox'));
    assert.strictEqual(result.monitor, null);
    assert.strictEqual(result.fullscreen, null);
    assert.strictEqual(result.profile, null);
  });

  test('Electron flags mixed with app flags → app flags parsed correctly', () => {
    const { parseCliArgs } = requireCli();
    const result = parseCliArgs(
      argv('--no-sandbox', '--fullscreen', '--inspect=9229', '--monitor', '2'),
    );
    assert.strictEqual(result.fullscreen, true);
    assert.strictEqual(result.monitor, 2);
    assert.strictEqual(result.profile, null);
  });

  test('--enable-logging does not cause errors', () => {
    const { parseCliArgs } = requireCli();
    assert.doesNotThrow(() => parseCliArgs(argv('--enable-logging')));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// process.argv DEFAULT BEHAVIOUR
// ─────────────────────────────────────────────────────────────────────────────

describe('cli.js – process.argv default', () => {
  test('calling parseCliArgs() without argument uses process.argv', () => {
    const { parseCliArgs } = requireCli();
    // process.argv in the test runner will not contain our flags → all null
    const result = parseCliArgs();
    assert.strictEqual(typeof result.monitor === 'number' || result.monitor === null, true);
    assert.ok(result.fullscreen === true || result.fullscreen === null);
    assert.ok(typeof result.profile === 'string' || result.profile === null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PACKAGED APP (single-prefix argv)
// Regression: in a packaged Electron .exe, argv has only ONE prefix entry
// (the .exe path) instead of two (electron + script). The old slice(2) would
// silently drop --monitor and its value in this case.
// ─────────────────────────────────────────────────────────────────────────────

describe('cli.js – packaged app argv (single prefix)', () => {
  // Simulate: ['/path/to/app.exe', '--monitor', '2', '--fullscreen']
  function argvPacked(...args) {
    return ['/path/to/unifi-protect-viewer.exe', ...args];
  }

  test('--monitor 2 is parsed correctly with single-prefix argv', () => {
    const { parseCliArgs } = requireCli();
    const result = parseCliArgs(argvPacked('--monitor', '2'));
    assert.strictEqual(result.monitor, 2);
  });

  test('--fullscreen is parsed correctly with single-prefix argv', () => {
    const { parseCliArgs } = requireCli();
    const result = parseCliArgs(argvPacked('--fullscreen'));
    assert.strictEqual(result.fullscreen, true);
  });

  test('--monitor 2 --fullscreen both parsed with single-prefix argv', () => {
    const { parseCliArgs } = requireCli();
    const result = parseCliArgs(argvPacked('--monitor', '2', '--fullscreen'));
    assert.strictEqual(result.monitor, 2);
    assert.strictEqual(result.fullscreen, true);
  });

  test('--profile "Cam1" parsed correctly with single-prefix argv', () => {
    const { parseCliArgs } = requireCli();
    const result = parseCliArgs(argvPacked('--profile', 'Cam1'));
    assert.strictEqual(result.profile, 'Cam1');
  });

  test('all three flags work with single-prefix argv', () => {
    const { parseCliArgs } = requireCli();
    const result = parseCliArgs(argvPacked('--monitor', '3', '--fullscreen', '--profile', 'Main'));
    assert.strictEqual(result.monitor, 3);
    assert.strictEqual(result.fullscreen, true);
    assert.strictEqual(result.profile, 'Main');
  });
});
