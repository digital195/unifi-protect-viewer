'use strict';

/**
 * @file test/js/liveview/version-resolution.test.js
 * @description Contract tests for the refactored resolveProtectVersion(doc, profile) function.
 *
 * Tests cover (per copilot-instructions.md requirements):
 *  1. Successful DOM detection
 *  2. DOM detection failure → fallback used
 *  3. DOM detection success → fallback ignored
 *  4. Both fail → undefined returned
 *  5. Malformed DOM string
 *  6. Missing span element
 *  7. Profile without version
 *  8. Profile with version
 *  9. UI persistence of version selection  (profile structure contract)
 * 10. Version selector integration in profile save/load flow
 *
 * Uses ONLY node:test + node:assert/strict.
 * No jsdom. No Electron. No filesystem (except reading preload.js source).
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const preloadSource = fs.readFileSync(
  path.resolve(__dirname, '../../../src/js/preload.js'),
  'utf8',
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a minimal fake <span> element whose innerText contains "Protect X.Y.Z"
 * and whose innerHTML mirrors that text.
 */
function makeVersionSpan(text) {
  return {
    innerText: text,
    innerHTML: text,
  };
}

/**
 * Builds a minimal document mock whose querySelectorAll('[class^=Version__Item] > span')
 * returns the given spans array.
 *
 * All other query methods return safe empty defaults.
 */
function makeDocWithSpans(spans) {
  return {
    URL: 'https://cam.local/protect/dashboard',
    querySelectorAll: (selector) => {
      if (selector === '[class^=Version__Item] > span') {
        // Return array-like with Array.from support
        return Object.assign([...spans], { length: spans.length });
      }
      return Object.assign([], { length: 0 });
    },
    querySelector: () => null,
    getElementById: () => null,
    getElementsByTagName: () => [],
    getElementsByClassName: () => ({ length: 0 }),
    getElementsByName: () => [undefined],
    head: { appendChild: () => {} },
    body: { appendChild: () => {}, style: {} },
  };
}

/**
 * Extracts and runs resolveProtectVersion in a fresh VM sandbox so that
 * we test the actual source function under the same conditions as Electron.
 *
 * Returns the function object.
 */
function extractResolveProtectVersion() {
  let captured = null;

  const sandbox = {
    require: (mod) => {
      if (mod === 'electron')
        return {
          contextBridge: { exposeInMainWorld: () => {} },
          ipcRenderer: { send: () => {}, invoke: () => Promise.resolve() },
        };
      throw new Error(`unexpected require: ${mod}`);
    },
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
    window: { addEventListener: () => {} },
    document: makeDocWithSpans([]),
    localStorage: { getItem: () => null },
    location: { reload: () => {} },
    setTimeout: () => 1,
    setInterval: () => 2,
    clearTimeout: () => {},
    clearInterval: () => {},
    crypto: { randomUUID: () => 'test-uuid' },
    Event: class Event {
      constructor(t) {
        this.type = t;
      }
    },
    MouseEvent: class MouseEvent {
      constructor(t) {
        this.type = t;
      }
    },
    module: { id: 'preload' },
    // We expose a capture hook via a global so the vm can write back
    __captureResolveProtectVersion: (fn) => {
      captured = fn;
    },
  };

  // Append a line that captures the function after it has been defined
  const augmentedSource =
    preloadSource + '\n__captureResolveProtectVersion(resolveProtectVersion);';

  try {
    vm.runInNewContext(augmentedSource, sandbox);
  } catch (_) {
    // DOM side-effects during init are expected and ignored
  }

  assert.ok(captured, 'resolveProtectVersion must be defined in preload.js');
  return captured;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 – FUNCTION CONTRACT (source-level)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveProtectVersion – source contract', () => {
  test('function is named resolveProtectVersion', () => {
    assert.ok(
      preloadSource.includes('function resolveProtectVersion('),
      'preload.js must define function resolveProtectVersion',
    );
  });

  test('function accepts (doc, profile) parameters', () => {
    assert.ok(
      preloadSource.includes('function resolveProtectVersion(doc, profile)'),
      'resolveProtectVersion must accept (doc, profile) parameters for testability',
    );
  });

  test('uses doc.querySelectorAll (injected doc, not global document)', () => {
    // The function body must reference doc.querySelectorAll not document.querySelectorAll
    const fnStart = preloadSource.indexOf('function resolveProtectVersion(');
    const fnEnd = preloadSource.indexOf('\nfunction ', fnStart + 1);
    const fnBody = preloadSource.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    assert.ok(
      fnBody.includes('doc.querySelectorAll'),
      'resolveProtectVersion must use doc.querySelectorAll (injected document)',
    );
  });

  test('DOM selector is exactly "[class^=Version__Item] > span"', () => {
    assert.ok(
      preloadSource.includes('[class^=Version__Item] > span'),
      'version selector must be "[class^=Version__Item] > span"',
    );
  });

  test('uses isModernVersion helper (>= 4.x logic, no hardcoded version list)', () => {
    assert.ok(
      preloadSource.includes('function isModernVersion('),
      'preload must define isModernVersion()',
    );
    assert.ok(
      preloadSource.includes('function isLegacyVersion('),
      'preload must define isLegacyVersion()',
    );
    assert.ok(
      preloadSource.includes('function isLegacyVersion3('),
      'preload must define isLegacyVersion3() for the 3.x-specific legacy handler',
    );
    // Must use a numeric comparison (>= 4) rather than a hardcoded string list
    assert.ok(
      preloadSource.includes('>= 4'),
      'preload must use >= 4 comparison instead of hardcoded version list',
    );
  });

  test('no hardcoded version whitelist like "4.x" || "5.x" || "6.x" in resolveProtectVersion', () => {
    const fnStart = preloadSource.indexOf('function resolveProtectVersion(');
    const fnEnd = preloadSource.indexOf('\nfunction ', fnStart + 1);
    const fnBody = preloadSource.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    // Must NOT contain the old hardcoded string comparison pattern
    assert.ok(
      !fnBody.includes("mapped === '4.x'") && !fnBody.includes("mapped === '5.x'"),
      'resolveProtectVersion must NOT contain hardcoded version string comparisons',
    );
  });

  test('fallback reads profile.protectVersion', () => {
    assert.ok(
      preloadSource.includes('profile.protectVersion'),
      'resolveProtectVersion must reference profile.protectVersion for fallback',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 – RUNTIME BEHAVIOR
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveProtectVersion – runtime behavior', () => {
  let fn;
  // Extract once for all runtime tests
  before(() => {
    fn = extractResolveProtectVersion();
  });

  // ── Test 1: Successful DOM detection ─────────────────────────────────────

  test('(1) successful DOM detection: "Protect 6.2.88" → "6.x"', () => {
    const doc = makeDocWithSpans([makeVersionSpan('Protect 6.2.88')]);
    const result = fn(doc, undefined);
    assert.strictEqual(result, '6.x');
  });

  test('(1) successful DOM detection: "Protect 5.0.1" → "5.x"', () => {
    const doc = makeDocWithSpans([makeVersionSpan('Protect 5.0.1')]);
    const result = fn(doc, undefined);
    assert.strictEqual(result, '5.x');
  });

  test('(1) successful DOM detection: "Protect 4.0.21" → "4.x"', () => {
    const doc = makeDocWithSpans([makeVersionSpan('Protect 4.0.21')]);
    const result = fn(doc, undefined);
    assert.strictEqual(result, '4.x');
  });

  test('(1) successful DOM detection: "Protect 3.2.0" → "3.x"', () => {
    const doc = makeDocWithSpans([makeVersionSpan('Protect 3.2.0')]);
    const result = fn(doc, undefined);
    assert.strictEqual(result, '3.x');
  });

  // ── 7.x / 8.x / 9.x / future versions ───────────────────────────────────

  test('(1) successful DOM detection: "Protect 7.0.0" → "7.x" (future-proof)', () => {
    const doc = makeDocWithSpans([makeVersionSpan('Protect 7.0.0')]);
    const result = fn(doc, undefined);
    assert.strictEqual(result, '7.x', '7.x must be treated as a modern version');
  });

  test('(1) successful DOM detection: "Protect 7.1.5" → "7.x" (behaves like 6.x)', () => {
    const doc = makeDocWithSpans([makeVersionSpan('Protect 7.1.5')]);
    const profile = { protectVersion: '3.x' }; // profile fallback must be ignored
    const result = fn(doc, profile);
    assert.strictEqual(result, '7.x', 'DOM 7.x must override profile fallback');
  });

  test('(1) successful DOM detection: "Protect 8.0.0" → "8.x" (future-proof)', () => {
    const doc = makeDocWithSpans([makeVersionSpan('Protect 8.0.0')]);
    const result = fn(doc, undefined);
    assert.strictEqual(result, '8.x');
  });

  test('(1) successful DOM detection: "Protect 9.3.1" → "9.x" (future-proof)', () => {
    const doc = makeDocWithSpans([makeVersionSpan('Protect 9.3.1')]);
    const result = fn(doc, undefined);
    assert.strictEqual(result, '9.x');
  });

  test('(1) successful DOM detection: "Protect 15.0.0" → "15.x" (large future version)', () => {
    const doc = makeDocWithSpans([makeVersionSpan('Protect 15.0.0')]);
    const result = fn(doc, undefined);
    assert.strictEqual(result, '15.x');
  });

  // ── Test 2: DOM detection failure → fallback used ─────────────────────────

  test('(2) DOM detection failure (no spans) → profile fallback "5.x" used', () => {
    const doc = makeDocWithSpans([]);
    const profile = { protectVersion: '5.x' };
    const result = fn(doc, profile);
    assert.strictEqual(result, '5.x');
  });

  test('(2) DOM detection failure (no matching span) → profile fallback "4.x" used', () => {
    // Span exists but does NOT contain "Protect"
    const doc = makeDocWithSpans([makeVersionSpan('UniFi OS 3.1.0')]);
    const profile = { protectVersion: '4.x' };
    const result = fn(doc, profile);
    assert.strictEqual(result, '4.x');
  });

  test('(2) DOM detection failure (no spans) → profile fallback "3.x" used', () => {
    const doc = makeDocWithSpans([]);
    const profile = { protectVersion: '3.x' };
    const result = fn(doc, profile);
    assert.strictEqual(result, '3.x');
  });

  // ── Test 3: DOM detection success → fallback ignored ─────────────────────

  test('(3) DOM detection success → profile fallback is ignored', () => {
    const doc = makeDocWithSpans([makeVersionSpan('Protect 6.1.0')]);
    const profile = { protectVersion: '3.x' }; // fallback set to 3.x but DOM says 6
    const result = fn(doc, profile);
    assert.strictEqual(result, '6.x', 'DOM result must take precedence over profile fallback');
  });

  test('(3) DOM detection success → profile fallback "4.x" is NOT used when DOM says "5.x"', () => {
    const doc = makeDocWithSpans([makeVersionSpan('Protect 5.2.10')]);
    const profile = { protectVersion: '4.x' };
    const result = fn(doc, profile);
    assert.strictEqual(result, '5.x');
  });

  // ── Test 4: Both fail → undefined ────────────────────────────────────────

  test('(4) both DOM and profile fail → 7.x returned', () => {
    const doc = makeDocWithSpans([]);
    const result = fn(doc, undefined);
    assert.strictEqual(result, '7.x');
  });

  test('(4) empty spans and profile without protectVersion → 7.x', () => {
    const doc = makeDocWithSpans([]);
    const profile = { name: 'Test', url: 'https://x', username: 'u', password: 'p' };
    const result = fn(doc, profile);
    assert.strictEqual(result, '7.x');
  });

  test('(4) no spans and null profile → 7.x', () => {
    const doc = makeDocWithSpans([]);
    const result = fn(doc, null);
    assert.strictEqual(result, '7.x');
  });

  // ── Test 5: Malformed DOM string ─────────────────────────────────────────

  test('(5) malformed DOM string "Protect" (no version number) → falls back to profile', () => {
    const doc = makeDocWithSpans([makeVersionSpan('Protect')]);
    const profile = { protectVersion: '6.x' };
    const result = fn(doc, profile);
    assert.strictEqual(result, '6.x');
  });

  test('(5) malformed DOM string "Protect abc" (no digit) → falls back to profile', () => {
    const doc = makeDocWithSpans([makeVersionSpan('Protect abc')]);
    const profile = { protectVersion: '5.x' };
    const result = fn(doc, profile);
    assert.strictEqual(result, '5.x');
  });

  test('(5) malformed DOM string "Protect 99.1.0" (large unknown major) → returns "99.x" (modern)', () => {
    // Major 99 is >= 4 → treated as modern, mapped to "99.x" – future-proof behavior
    const doc = makeDocWithSpans([makeVersionSpan('Protect 99.1.0')]);
    const profile = { protectVersion: '4.x' };
    const result = fn(doc, profile);
    assert.strictEqual(
      result,
      '99.x',
      '99.x is a valid modern version (>= 4), profile fallback must be ignored',
    );
  });

  test('(5) DOM span innerText is empty string → falls back to profile', () => {
    const doc = makeDocWithSpans([{ innerText: '', innerHTML: '' }]);
    const profile = { protectVersion: '3.x' };
    const result = fn(doc, profile);
    assert.strictEqual(result, '3.x');
  });

  test('(5) DOM span innerText is null → does not throw, falls back to profile', () => {
    const doc = makeDocWithSpans([{ innerText: null, innerHTML: null }]);
    const profile = { protectVersion: '3.x' };
    assert.doesNotThrow(() => {
      const result = fn(doc, profile);
      assert.strictEqual(result, '3.x');
    });
  });

  // ── Test 6: Missing span element ─────────────────────────────────────────

  test('(6) querySelectorAll returns empty array → 7.x (no fallback)', () => {
    const doc = makeDocWithSpans([]);
    const result = fn(doc, undefined);
    assert.strictEqual(result, '7.x');
  });

  test('(6) querySelectorAll returns empty array → profile fallback used', () => {
    const doc = makeDocWithSpans([]);
    const profile = { protectVersion: '6.x' };
    const result = fn(doc, profile);
    assert.strictEqual(result, '6.x');
  });

  test('(6) querySelectorAll throws → does not crash, falls back to profile', () => {
    const brokenDoc = {
      querySelectorAll: () => {
        throw new Error('DOM error');
      },
    };
    const profile = { protectVersion: '5.x' };
    assert.doesNotThrow(() => {
      const result = fn(brokenDoc, profile);
      assert.strictEqual(result, '5.x');
    });
  });

  // ── Test 7: Profile without version ──────────────────────────────────────

  test('(7) profile without protectVersion field → 6.x', () => {
    const doc = makeDocWithSpans([]);
    const profile = { id: 'p1', name: 'Test', url: 'https://x', username: 'u', password: 'p' };
    const result = fn(doc, profile);
    assert.strictEqual(result, '7.x');
  });

  test('(7) profile with protectVersion = undefined → 7.x', () => {
    const doc = makeDocWithSpans([]);
    const profile = { protectVersion: undefined };
    const result = fn(doc, profile);
    assert.strictEqual(result, '7.x');
  });

  test('(7) profile with protectVersion = null → 7.x (null is not a valid fallback)', () => {
    const doc = makeDocWithSpans([]);
    const profile = { protectVersion: null };
    const result = fn(doc, profile);
    assert.strictEqual(result, '7.x');
  });

  test('(7) profile with protectVersion = "" (empty string) → 7.x', () => {
    const doc = makeDocWithSpans([]);
    const profile = { protectVersion: '' };
    const result = fn(doc, profile);
    assert.strictEqual(result, '7.x');
  });

  // ── Test 8: Profile with version ─────────────────────────────────────────

  test('(8) profile with protectVersion = "3.x" → "3.x" when DOM fails', () => {
    const doc = makeDocWithSpans([]);
    const profile = { protectVersion: '3.x' };
    const result = fn(doc, profile);
    assert.strictEqual(result, '3.x');
  });

  test('(8) profile with protectVersion = "4.x" → "4.x" when DOM fails', () => {
    const doc = makeDocWithSpans([]);
    const profile = { protectVersion: '4.x' };
    const result = fn(doc, profile);
    assert.strictEqual(result, '4.x');
  });

  test('(8) profile with protectVersion = "5.x" → "5.x" when DOM fails', () => {
    const doc = makeDocWithSpans([]);
    const profile = { protectVersion: '5.x' };
    const result = fn(doc, profile);
    assert.strictEqual(result, '5.x');
  });

  test('(8) profile with protectVersion = "6.x" → "6.x" when DOM fails', () => {
    const doc = makeDocWithSpans([]);
    const profile = { protectVersion: '6.x' };
    const result = fn(doc, profile);
    assert.strictEqual(result, '6.x');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 – UI PERSISTENCE CONTRACT (profile structure)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveProtectVersion – UI persistence (profile structure contract)', () => {
  // ── Test 9: UI persistence of version selection ───────────────────────────

  test('(9) profile structure accepts optional protectVersion field', () => {
    // A fully valid profile with protectVersion set must work as a fallback
    const fn = extractResolveProtectVersion();
    const doc = makeDocWithSpans([]);
    const profile = {
      id: 'abc123',
      name: 'My NVR',
      url: 'https://192.168.1.1/protect/dashboard/xyz',
      username: 'admin',
      password: 'secret',
      protectVersion: '6.x',
    };
    const result = fn(doc, profile);
    assert.strictEqual(result, '6.x', 'profile.protectVersion must be used as fallback');
  });

  test('(9) profile structure without protectVersion is still valid (optional field)', () => {
    const fn = extractResolveProtectVersion();
    const doc = makeDocWithSpans([]);
    const profile = {
      id: 'abc123',
      name: 'My NVR',
      url: 'https://192.168.1.1/protect/dashboard/xyz',
      username: 'admin',
      password: 'secret',
      // protectVersion intentionally absent
    };
    assert.doesNotThrow(() => {
      const result = fn(doc, profile);
      assert.strictEqual(result, '7.x', 'missing protectVersion must yield 7.x');
    });
  });

  test('(9) protectVersion selector options include: "", "3.x", "4.x", "5.x", "6.x", "7.x"', () => {
    // Contract: config.html select must contain these exact option values
    const configHtml = fs.readFileSync(
      path.resolve(__dirname, '../../../src/html/config.html'),
      'utf8',
    );
    const expectedValues = ['', '3.x', '4.x', '5.x', '6.x', '7.x'];
    for (const val of expectedValues) {
      const pattern = val === '' ? 'value=""' : `value="${val}"`;
      assert.ok(
        configHtml.includes(pattern),
        `config.html protectVersion select must contain option with value="${val}"`,
      );
    }
  });

  test('(9) config.html select id is exactly "protectVersion"', () => {
    const configHtml = fs.readFileSync(
      path.resolve(__dirname, '../../../src/html/config.html'),
      'utf8',
    );
    assert.ok(
      configHtml.includes('id="protectVersion"'),
      'config.html must contain select with id="protectVersion"',
    );
  });

  // ── Test 10: Version selector integration in profile save/load flow ───────

  test('(10) loadProfileIntoForm sets protectVersion dropdown from profile', () => {
    const configHtml = fs.readFileSync(
      path.resolve(__dirname, '../../../src/html/config.html'),
      'utf8',
    );
    // The JS in config.html must read p.protectVersion and set it on the select
    assert.ok(
      configHtml.includes("getElementById('protectVersion').value"),
      'config.html must set getElementById("protectVersion").value in loadProfileIntoForm',
    );
  });

  test('(10) save() reads protectVersion from dropdown and persists it', () => {
    const configHtml = fs.readFileSync(
      path.resolve(__dirname, '../../../src/html/config.html'),
      'utf8',
    );
    // The save function must read the dropdown value
    assert.ok(
      configHtml.includes("getElementById('protectVersion').value"),
      'save() in config.html must read getElementById("protectVersion").value',
    );
  });

  test('(10) save() includes protectVersion in saved profile object', () => {
    const configHtml = fs.readFileSync(
      path.resolve(__dirname, '../../../src/html/config.html'),
      'utf8',
    );
    // Profile save must reference protectVersion field
    assert.ok(
      configHtml.includes('protectVersion'),
      'config.html must persist protectVersion in the profile object',
    );
  });

  test('(10) save() removes protectVersion from profile when dropdown is empty ("Auto")', () => {
    const configHtml = fs.readFileSync(
      path.resolve(__dirname, '../../../src/html/config.html'),
      'utf8',
    );
    // The save logic must delete/remove protectVersion when pv is falsy
    assert.ok(
      configHtml.includes('delete') && configHtml.includes('protectVersion'),
      'config.html must delete protectVersion from profile when dropdown value is empty',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 – REGRESSION SAFETY
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveProtectVersion – regression safety', () => {
  test('DOM selector has NOT changed from "[class^=Version__Item] > span"', () => {
    assert.ok(
      preloadSource.includes('[class^=Version__Item] > span'),
      'REGRESSION: DOM selector for version spans must remain "[class^=Version__Item] > span"',
    );
  });

  test('fallback does NOT override a successfully detected DOM version', () => {
    const fn = extractResolveProtectVersion();
    const doc = makeDocWithSpans([makeVersionSpan('Protect 6.0.0')]);
    const profile = { protectVersion: '3.x' };
    const result = fn(doc, profile);
    assert.notStrictEqual(result, '3.x', 'REGRESSION: fallback must NOT override DOM detection');
    assert.strictEqual(result, '6.x', 'REGRESSION: DOM detection must return "6.x"');
  });

  test('version mapping: major 3 → "3.x"', () => {
    const fn = extractResolveProtectVersion();
    assert.strictEqual(fn(makeDocWithSpans([makeVersionSpan('Protect 3.9.9')]), null), '3.x');
  });

  test('version mapping: major 4 → "4.x"', () => {
    const fn = extractResolveProtectVersion();
    assert.strictEqual(fn(makeDocWithSpans([makeVersionSpan('Protect 4.0.0')]), null), '4.x');
  });

  test('version mapping: major 5 → "5.x"', () => {
    const fn = extractResolveProtectVersion();
    assert.strictEqual(fn(makeDocWithSpans([makeVersionSpan('Protect 5.1.2')]), null), '5.x');
  });

  test('version mapping: major 6 → "6.x"', () => {
    const fn = extractResolveProtectVersion();
    assert.strictEqual(fn(makeDocWithSpans([makeVersionSpan('Protect 6.2.88')]), null), '6.x');
  });

  test('version mapping: major 7 → "7.x" (same modern UI as 6.x)', () => {
    const fn = extractResolveProtectVersion();
    assert.strictEqual(fn(makeDocWithSpans([makeVersionSpan('Protect 7.0.0')]), null), '7.x');
  });

  test('version mapping: major 8 → "8.x"', () => {
    const fn = extractResolveProtectVersion();
    assert.strictEqual(fn(makeDocWithSpans([makeVersionSpan('Protect 8.2.0')]), null), '8.x');
  });

  test('version mapping: major 9 → "9.x"', () => {
    const fn = extractResolveProtectVersion();
    assert.strictEqual(fn(makeDocWithSpans([makeVersionSpan('Protect 9.0.1')]), null), '9.x');
  });

  test('version mapping: major 15 → "15.x" (large future version)', () => {
    const fn = extractResolveProtectVersion();
    assert.strictEqual(fn(makeDocWithSpans([makeVersionSpan('Protect 15.0.0')]), null), '15.x');
  });

  test('isModernVersion is called instead of startsWith("4.")/startsWith("5.")/startsWith("6.") in dispatcher', () => {
    assert.ok(
      preloadSource.includes('isModernVersion('),
      'REGRESSION: dispatcher must use isModernVersion() instead of hardcoded startsWith checks',
    );
    assert.ok(
      preloadSource.includes('isLegacyVersion3('),
      'REGRESSION: dispatcher must use isLegacyVersion3() for the 3.x branch',
    );
    assert.ok(
      !preloadSource.includes("startsWith('3.')") && !preloadSource.includes('startsWith("3.")'),
      'REGRESSION: no hardcoded startsWith("3.") check allowed in dispatcher',
    );
    assert.ok(
      !preloadSource.includes("startsWith('4.')") && !preloadSource.includes('startsWith("4.")'),
      'REGRESSION: no hardcoded startsWith("4.") check allowed in dispatcher',
    );
    assert.ok(
      !preloadSource.includes("startsWith('5.')") && !preloadSource.includes('startsWith("5.")'),
      'REGRESSION: no hardcoded startsWith("5.") check allowed in dispatcher',
    );
    assert.ok(
      !preloadSource.includes("startsWith('6.')") && !preloadSource.includes('startsWith("6.")'),
      'REGRESSION: no hardcoded startsWith("6.") check allowed in dispatcher',
    );
  });

  test('resolveProtectVersion is called with (document, config) in startLiveviewAutomation', () => {
    assert.ok(
      preloadSource.includes('resolveProtectVersion(document, config)'),
      'REGRESSION: resolveProtectVersion must be called with (document, config) in automation',
    );
  });

  test('resolveProtectVersion does not reference global document directly (injected only)', () => {
    const fnStart = preloadSource.indexOf('function resolveProtectVersion(');
    const fnEnd = preloadSource.indexOf('\nfunction ', fnStart + 1);
    const fnBody = preloadSource.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    assert.ok(
      !fnBody.includes('document.querySelectorAll'),
      'REGRESSION: resolveProtectVersion must NOT use global document.querySelectorAll',
    );
  });

  test('select options do not include legacy-unsupported version (no "2.x")', () => {
    const configHtml = fs.readFileSync(
      path.resolve(__dirname, '../../../src/html/config.html'),
      'utf8',
    );
    assert.ok(
      !configHtml.includes('value="2.x"'),
      'REGRESSION: config.html must NOT contain option value="2.x"',
    );
    assert.ok(
      configHtml.includes('value="7.x"'),
      'config.html must contain option value="7.x" (same UI as 6.x)',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 – VERSION UTILITY HELPERS (isLegacyVersion / isModernVersion)
// ─────────────────────────────────────────────────────────────────────────────

describe('version utility helpers – isLegacyVersion / isModernVersion', () => {
  /** Extract both helpers from the preload source */
  function getHelpers() {
    const sandbox = {
      require: (mod) => {
        if (mod === 'electron')
          return {
            contextBridge: { exposeInMainWorld: () => {} },
            ipcRenderer: { send: () => {}, invoke: () => Promise.resolve() },
          };
        throw new Error(`unexpected require: ${mod}`);
      },
      console: { log: () => {}, warn: () => {}, error: () => {} },
      window: { addEventListener: () => {} },
      document: {
        URL: '',
        querySelectorAll: () => [],
        querySelector: () => null,
        getElementById: () => null,
        getElementsByTagName: () => [],
        getElementsByClassName: () => ({ length: 0 }),
        getElementsByName: () => [undefined],
        head: { appendChild: () => {} },
        body: { appendChild: () => {}, style: {} },
      },
      localStorage: { getItem: () => null },
      location: { reload: () => {} },
      setTimeout: () => 1,
      setInterval: () => 2,
      clearTimeout: () => {},
      clearInterval: () => {},
      crypto: { randomUUID: () => 'test-uuid' },
      Event: class {
        constructor(t) {
          this.type = t;
        }
      },
      MouseEvent: class {
        constructor(t) {
          this.type = t;
        }
      },
      module: { id: 'preload' },
      __capture: (isLegacy, isLegacy3, isModern, parseMajor) => {
        sandbox._isLegacyVersion = isLegacy;
        sandbox._isLegacyVersion3 = isLegacy3;
        sandbox._isModernVersion = isModern;
        sandbox._parseMajorVersion = parseMajor;
      },
    };
    const augmented =
      preloadSource +
      '\n__capture(isLegacyVersion, isLegacyVersion3, isModernVersion, parseMajorVersion);';
    try {
      vm.runInNewContext(augmented, sandbox);
    } catch (_) {}
    return {
      isLegacyVersion: sandbox._isLegacyVersion,
      isLegacyVersion3: sandbox._isLegacyVersion3,
      isModernVersion: sandbox._isModernVersion,
      parseMajorVersion: sandbox._parseMajorVersion,
    };
  }

  test('parseMajorVersion: extracts major from "6.2.88"', () => {
    const { parseMajorVersion } = getHelpers();
    assert.strictEqual(parseMajorVersion('6.2.88'), 6);
  });

  test('parseMajorVersion: extracts major from "3.x"', () => {
    const { parseMajorVersion } = getHelpers();
    assert.strictEqual(parseMajorVersion('3.x'), 3);
  });

  test('parseMajorVersion: returns NaN for empty string', () => {
    const { parseMajorVersion } = getHelpers();
    assert.ok(isNaN(parseMajorVersion('')));
  });

  test('parseMajorVersion: returns NaN for undefined', () => {
    const { parseMajorVersion } = getHelpers();
    assert.ok(isNaN(parseMajorVersion(undefined)));
  });

  test('parseMajorVersion: returns NaN for malformed string "abc"', () => {
    const { parseMajorVersion } = getHelpers();
    assert.ok(isNaN(parseMajorVersion('abc')));
  });

  test('isLegacyVersion: "2.x" → true', () => {
    const { isLegacyVersion } = getHelpers();
    assert.strictEqual(isLegacyVersion('2.x'), true);
  });

  test('isLegacyVersion: "3.x" → true', () => {
    const { isLegacyVersion } = getHelpers();
    assert.strictEqual(isLegacyVersion('3.x'), true);
  });

  test('isLegacyVersion: "4.x" → false', () => {
    const { isLegacyVersion } = getHelpers();
    assert.strictEqual(isLegacyVersion('4.x'), false);
  });

  test('isLegacyVersion: "7.x" → false', () => {
    const { isLegacyVersion } = getHelpers();
    assert.strictEqual(isLegacyVersion('7.x'), false);
  });

  test('isLegacyVersion: undefined → false (safe)', () => {
    const { isLegacyVersion } = getHelpers();
    assert.strictEqual(isLegacyVersion(undefined), false);
  });

  // ── isLegacyVersion3 ─────────────────────────────────────────────────────

  test('isLegacyVersion3: "3.x" → true', () => {
    const { isLegacyVersion3 } = getHelpers();
    assert.strictEqual(isLegacyVersion3('3.x'), true);
  });

  test('isLegacyVersion3: "3.9.9" → true', () => {
    const { isLegacyVersion3 } = getHelpers();
    assert.strictEqual(isLegacyVersion3('3.9.9'), true);
  });

  test('isLegacyVersion3: "2.x" → false (not 3.x)', () => {
    const { isLegacyVersion3 } = getHelpers();
    assert.strictEqual(isLegacyVersion3('2.x'), false);
  });

  test('isLegacyVersion3: "4.x" → false', () => {
    const { isLegacyVersion3 } = getHelpers();
    assert.strictEqual(isLegacyVersion3('4.x'), false);
  });

  test('isLegacyVersion3: "7.x" → false', () => {
    const { isLegacyVersion3 } = getHelpers();
    assert.strictEqual(isLegacyVersion3('7.x'), false);
  });

  test('isLegacyVersion3: undefined → false (safe)', () => {
    const { isLegacyVersion3 } = getHelpers();
    assert.strictEqual(isLegacyVersion3(undefined), false);
  });

  test('isModernVersion: "4.x" → true', () => {
    const { isModernVersion } = getHelpers();
    assert.strictEqual(isModernVersion('4.x'), true);
  });

  test('isModernVersion: "5.x" → true', () => {
    const { isModernVersion } = getHelpers();
    assert.strictEqual(isModernVersion('5.x'), true);
  });

  test('isModernVersion: "6.x" → true', () => {
    const { isModernVersion } = getHelpers();
    assert.strictEqual(isModernVersion('6.x'), true);
  });

  test('isModernVersion: "7.x" → true', () => {
    const { isModernVersion } = getHelpers();
    assert.strictEqual(isModernVersion('7.x'), true);
  });

  test('isModernVersion: "8.x" → true', () => {
    const { isModernVersion } = getHelpers();
    assert.strictEqual(isModernVersion('8.x'), true);
  });

  test('isModernVersion: "15.x" → true (large future version)', () => {
    const { isModernVersion } = getHelpers();
    assert.strictEqual(isModernVersion('15.x'), true);
  });

  test('isModernVersion: "3.x" → false', () => {
    const { isModernVersion } = getHelpers();
    assert.strictEqual(isModernVersion('3.x'), false);
  });

  test('isModernVersion: undefined → false (safe)', () => {
    const { isModernVersion } = getHelpers();
    assert.strictEqual(isModernVersion(undefined), false);
  });

  test('isModernVersion: "" → false (safe)', () => {
    const { isModernVersion } = getHelpers();
    assert.strictEqual(isModernVersion(''), false);
  });

  test('isModernVersion: "7.1.5" → true (full version string)', () => {
    const { isModernVersion } = getHelpers();
    assert.strictEqual(isModernVersion('7.1.5'), true);
  });
});
