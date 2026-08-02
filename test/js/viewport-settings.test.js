'use strict';

/**
 * @file test/js/viewport-settings.test.js
 * @description Contract tests for src/html/viewport-settings.js — the pure
 * form↔config mapping used by the 2c Viewport card in config.html.
 * Evaluated in a vm sandbox (same pattern as debug-block.test.js); the
 * functions are DOM-free so the sandbox only needs a `window` object.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../src/html/viewport-settings.js'),
  'utf8',
);

function loadModule() {
  // NOTE: vm.runInNewContext() (the debug-block.test.js pattern) executes the
  // source in a brand-new V8 context/realm. Any object literals the module
  // creates at call time (e.g. the return value of viewportFormFromConfig)
  // therefore carry that realm's Object.prototype, which fails
  // assert.deepStrictEqual() against plain object literals written in this
  // file — Node reports "same structure but are not reference-equal" even
  // though the values are identical. vm.runInThisContext() runs the module
  // in THIS realm instead (still isolated from the module's internal scope
  // via its own IIFE), so returned objects compare equal by value as
  // expected, while still keeping the module free of require()/module
  // globals other than the injected `window`.
  if (!global.window) global.window = {};
  vm.runInThisContext(source, { filename: 'viewport-settings.js' });
  const api = global.window.viewportSettings;
  delete global.window.viewportSettings;
  return api;
}

const REDACTED = {
  enabled: true,
  name: 'Wall TV',
  url: 'https://nvr.local',
  username: 'admin',
  fallbackProfileId: 'p1',
  hasPassword: true,
  encryptionAvailable: true,
  defaultName: 'HOSTY_VIEWPORT',
};

describe('viewport-settings.js – viewportFormFromConfig', () => {
  test('maps every redacted field onto form state', () => {
    const vs = loadModule();
    assert.deepStrictEqual(vs.viewportFormFromConfig(REDACTED), {
      enabled: true,
      name: 'Wall TV',
      url: 'https://nvr.local',
      username: 'admin',
      fallbackProfileId: 'p1',
      namePlaceholder: 'HOSTY_VIEWPORT',
      passwordPlaceholder: 'unchanged',
      showEncWarning: false,
    });
  });

  test('empty/undefined config yields safe defaults', () => {
    const vs = loadModule();
    assert.deepStrictEqual(vs.viewportFormFromConfig(undefined), {
      enabled: false,
      name: '',
      url: '',
      username: '',
      fallbackProfileId: '',
      namePlaceholder: '',
      passwordPlaceholder: '',
      showEncWarning: false,
    });
  });

  test('encryptionAvailable:false raises the warning flag; no stored password → empty placeholder', () => {
    const vs = loadModule();
    const form = vs.viewportFormFromConfig({
      ...REDACTED,
      encryptionAvailable: false,
      hasPassword: false,
    });
    assert.equal(form.showEncWarning, true);
    assert.equal(form.passwordPlaceholder, '');
  });
});

describe('viewport-settings.js – validateViewportForm', () => {
  const base = {
    enabled: true,
    url: 'https://nvr.local',
    username: 'admin',
    passwordValue: '',
    passwordChanged: false,
  };

  test('disabled form is always valid', () => {
    const vs = loadModule();
    assert.deepStrictEqual(vs.validateViewportForm({ enabled: false }, REDACTED), { ok: true });
  });

  test('enabled without url fails on viewport-url', () => {
    const vs = loadModule();
    const r = vs.validateViewportForm({ ...base, url: '' }, REDACTED);
    assert.equal(r.ok, false);
    assert.equal(r.field, 'viewport-url');
  });

  test('url must start with http(s)://', () => {
    const vs = loadModule();
    const r = vs.validateViewportForm({ ...base, url: 'nvr.local' }, REDACTED);
    assert.equal(r.ok, false);
    assert.equal(r.field, 'viewport-url');
  });

  test('enabled without username fails on viewport-username', () => {
    const vs = loadModule();
    const r = vs.validateViewportForm({ ...base, username: '' }, REDACTED);
    assert.equal(r.ok, false);
    assert.equal(r.field, 'viewport-username');
  });

  test('no stored password and no new password fails on viewport-password', () => {
    const vs = loadModule();
    const r = vs.validateViewportForm(base, { ...REDACTED, hasPassword: false });
    assert.equal(r.ok, false);
    assert.equal(r.field, 'viewport-password');
  });

  test('stored password + unchanged passes; new password passes', () => {
    const vs = loadModule();
    assert.deepStrictEqual(vs.validateViewportForm(base, REDACTED), { ok: true });
    assert.deepStrictEqual(
      vs.validateViewportForm(
        { ...base, passwordChanged: true, passwordValue: 'new' },
        { ...REDACTED, hasPassword: false },
      ),
      { ok: true },
    );
  });

  test('passwordChanged with an empty value fails even when a password is stored', () => {
    const vs = loadModule();
    const r = vs.validateViewportForm(
      { ...base, passwordChanged: true, passwordValue: '' },
      REDACTED,
    );
    assert.equal(r.ok, false);
    assert.equal(r.field, 'viewport-password');
  });
});

describe('viewport-settings.js – buildViewportSetPayload', () => {
  test('trims fields, forwards passwordChanged with the value', () => {
    const vs = loadModule();
    assert.deepStrictEqual(
      vs.buildViewportSetPayload({
        enabled: true,
        name: '  Wall TV ',
        url: ' https://nvr.local ',
        username: ' admin ',
        passwordValue: 'hunter2',
        passwordChanged: true,
        fallbackProfileId: 'p1',
      }),
      {
        enabled: true,
        name: 'Wall TV',
        url: 'https://nvr.local',
        username: 'admin',
        password: 'hunter2',
        passwordChanged: true,
        fallbackProfileId: 'p1',
      },
    );
  });

  test('unchanged password sends empty password + passwordChanged:false (retention contract)', () => {
    const vs = loadModule();
    const p = vs.buildViewportSetPayload({
      enabled: true,
      name: 'V',
      url: 'https://x',
      username: 'a',
      passwordValue: 'typed-then-cleared-should-be-ignored',
      passwordChanged: false,
      fallbackProfileId: '',
    });
    assert.equal(p.password, '');
    assert.equal(p.passwordChanged, false);
    assert.equal(p.fallbackProfileId, null, 'empty dropdown value maps to null');
  });

  test("adoptionErrorBanner('auth') explains bad admin credentials", () => {
    const vs = loadModule();
    const b = vs.adoptionErrorBanner('auth');
    assert.ok(b, 'auth code must return a banner');
    assert.match(b.title, /registration failed/i);
    assert.match(b.detail, /username or password/i);
    assert.match(b.detail, /Save & Restart/);
  });

  test("adoptionErrorBanner('failed') is a generic registration failure", () => {
    const vs = loadModule();
    const b = vs.adoptionErrorBanner('failed');
    assert.ok(b, 'failed code must return a banner');
    assert.match(b.title, /registration failed/i);
    assert.match(b.detail, /credentials|address/i);
  });

  test('adoptionErrorBanner returns null for absent/unknown codes', () => {
    const vs = loadModule();
    assert.equal(vs.adoptionErrorBanner(''), null);
    assert.equal(vs.adoptionErrorBanner(undefined), null);
    assert.equal(vs.adoptionErrorBanner('something-else'), null);
  });
});
