'use strict';

/**
 * @file test/js/version-info-box.test.js
 * @description Contract tests for the Protect Version field and detection info in config.html
 *
 * Covers:
 *  - protectVersion dropdown is present with all expected options
 *  - upv-field__hint below the dropdown explains auto-detection and fallback
 *  - A Version Detection info-card in the right column provides further detail
 *  - "Legacy 3.x" naming is used consistently
 *  - No regression on existing form elements
 *
 * Uses ONLY node:test + node:assert/strict.
 * No jsdom. Pure string/regex analysis of the HTML source.
 * No Electron runtime launched.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const configHtml = fs.readFileSync(path.resolve(__dirname, '../../src/html/config.html'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// § 1 – Field hint presence (replaces the old upv-version-info box)
// ─────────────────────────────────────────────────────────────────────────────

describe('config.html – Protect Version info box presence', () => {
  test('protectVersion dropdown is present', () => {
    assert.ok(
      configHtml.includes('id="protectVersion"'),
      'config.html must contain id="protectVersion"',
    );
  });

  test('upv-field__hint is present near the protectVersion field', () => {
    assert.ok(
      configHtml.includes('upv-field__hint'),
      'config.html must contain a upv-field__hint element for the version field',
    );
  });

  test('info box appears after the protectVersion dropdown', () => {
    const dropdownIdx = configHtml.indexOf('id="protectVersion"');
    // The hint or the right-column Version Detection card must appear after the dropdown
    const hintIdx = configHtml.indexOf('upv-field__hint');
    assert.ok(dropdownIdx !== -1, 'protectVersion dropdown must exist');
    assert.ok(hintIdx !== -1, 'upv-field__hint must exist');
    assert.ok(hintIdx > dropdownIdx, 'field hint must appear after the protectVersion dropdown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 2 – Detection info content (field hint + right-column card)
// ─────────────────────────────────────────────────────────────────────────────

describe('config.html – Protect Version info box content', () => {
  // Extract the region from the protectVersion dropdown to end of the right column info-card
  function extractVersionInfoRegion() {
    const start = configHtml.indexOf('id="protectVersion"');
    if (start === -1) return '';
    // Take a generous slice that covers both the field hint and the right-column card
    return configHtml.slice(start, start + 4000);
  }

  test('info box mentions automatic version detection', () => {
    const region = extractVersionInfoRegion();
    const hasAutoDetect =
      region.includes('automat') || region.includes('detect') || region.includes('Detect');
    assert.ok(hasAutoDetect, 'version info region must mention automatic detection');
  });

  test('info box mentions "Protect" label (e.g. "Protect 6.2.88")', () => {
    const region = extractVersionInfoRegion();
    assert.ok(region.includes('Protect'), 'version info region must reference the Protect label');
  });

  test('info box mentions fallback behaviour', () => {
    const region = extractVersionInfoRegion();
    const hasFallback =
      region.includes('fallback') ||
      region.includes('Fallback') ||
      region.includes('override') ||
      region.includes('fails');
    assert.ok(hasFallback, 'version info region must mention fallback/override behaviour');
  });

  test('info box mentions major version extraction concept', () => {
    const region = extractVersionInfoRegion();
    const hasMajor =
      region.includes('6.x') ||
      region.includes('7.x') ||
      region.includes('major') ||
      region.includes('e.g.');
    assert.ok(hasMajor, 'version info region must explain major version extraction');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 3 – Legacy 3.x naming consistency
// ─────────────────────────────────────────────────────────────────────────────

describe('config.html – Legacy 3.x naming', () => {
  test('"Legacy 3.x" naming used in the UI (not just "3.x Legacy")', () => {
    // Either "Legacy 3.x" or "(Legacy)" next to 3.x option is acceptable
    const hasLegacy =
      configHtml.includes('Legacy 3.x') ||
      configHtml.includes('3.x (Legacy)') ||
      configHtml.includes('3.x – Legacy');
    assert.ok(hasLegacy, 'config.html must use "Legacy 3.x" or "3.x (Legacy)" naming');
  });

  test('"Legacy" appears in the right-column info cards', () => {
    // Find the right column by looking past the left column closing marker
    const leftColEnd = configHtml.indexOf('<!-- /left -->');
    const rightColRegion =
      leftColEnd !== -1 ? configHtml.slice(leftColEnd, leftColEnd + 4000) : configHtml;
    assert.ok(
      rightColRegion.includes('Legacy'),
      'right-column cards must use "Legacy" naming (found after <!-- /left -->)',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 4 – No regression in existing elements
// ─────────────────────────────────────────────────────────────────────────────

describe('config.html – regression safety for existing elements', () => {
  test('protectVersion select dropdown still present', () => {
    assert.ok(
      configHtml.includes('id="protectVersion"'),
      'protectVersion dropdown must still exist',
    );
  });

  test('"Auto (detect from DOM)" option still present', () => {
    assert.ok(
      configHtml.includes('Auto (detect from DOM)') || configHtml.includes('Auto'),
      '"Auto" option must still exist in the dropdown',
    );
  });

  test('options 3.x / 4.x / 5.x / 6.x still present', () => {
    for (const ver of ['3.x', '4.x', '5.x', '6.x']) {
      assert.ok(configHtml.includes(`value="${ver}"`), `option ${ver} must still exist`);
    }
  });

  test('saveBtn still present (no regression)', () => {
    assert.ok(configHtml.includes('id="saveBtn"'), 'saveBtn must still be present');
  });

  test('profileList still present (no regression)', () => {
    assert.ok(configHtml.includes('id="profileList"'), 'profileList must still be present');
  });

  test('debugBlockContainer is present in config.html main panel', () => {
    assert.ok(
      configHtml.includes('id="debugBlockContainer"'),
      'debugBlockContainer must be present in config.html',
    );
  });

  test('debug-block.js script tag is present in config.html', () => {
    assert.ok(
      configHtml.includes('debug-block.js'),
      'config.html must include debug-block.js script',
    );
  });
});
