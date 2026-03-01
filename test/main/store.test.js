'use strict';

/**
 * @file test/main/store.test.js
 * @description Behavioral contract tests for src/main/store.js
 *
 * store.js executes side effects on import (reads build-config.json,
 * creates electron-store instance). We mock fs and electron-store via
 * Module._load before the file is loaded for the first time.
 *
 * Guarantees:
 *  - Exported symbol surface is locked (add/remove → test failure)
 *  - Portable detection via build-config.json and env var is tested
 *  - All store API methods are covered with positive, negative, and edge tests
 *  - Migration logic (old config format → profiles) is fully tested
 *  - Mutation-style changes would cause test failures
 *  - process.env is restored after each test group
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Module } = require('node:module');
const MockStore = require('../helpers/mock-store');

// ── Module mocks ──────────────────────────────────────────────────────────────

let mockStoreInstance;
let mockFsExistsSync;
let mockFsReadFileSync;
let mockFsMkdirSync;
let buildConfigContent = null; // null = file does not exist

const originalLoad = Module._load;

function installMocks() {
  mockStoreInstance = new MockStore();
  mockFsExistsSync = (p) => {
    if (p.endsWith('build-config.json')) return buildConfigContent !== null;
    return false;
  };
  mockFsReadFileSync = (p) => {
    if (p.endsWith('build-config.json')) return JSON.stringify(buildConfigContent);
    throw new Error(`Unknown path: ${p}`);
  };
  mockFsMkdirSync = () => {};

  Module._load = function (request, parent, isMain) {
    if (request === 'electron-store') {
      return class {
        constructor() {
          return mockStoreInstance;
        }
      };
    }
    if (request === 'node:fs') {
      return {
        existsSync: mockFsExistsSync,
        readFileSync: mockFsReadFileSync,
        mkdirSync: mockFsMkdirSync,
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

function uninstallMocks() {
  Module._load = originalLoad;
}

function requireFreshStore() {
  const storePath = require.resolve('../../src/main/store');
  delete require.cache[storePath];
  return require('../../src/main/store');
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE BOUNDARY CONTRACT
// Any added or removed export causes this test to fail.
// ─────────────────────────────────────────────────────────────────────────────

describe('store.js – module boundary contract', () => {
  beforeEach(() => {
    buildConfigContent = null;
    delete process.env.UPV_PORTABLE;
    delete process.env.UPV_ENCRYPTION_KEY;
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    delete require.cache[require.resolve('../../src/main/store')];
  });

  test('exports exactly the expected public API symbols', () => {
    const store = requireFreshStore();
    const expectedExports = [
      'clearAll',
      'getActiveProfile',
      'getActiveProfileId',
      'getConfig',
      'getProfiles',
      'getStartupProfileId',
      'getStartupSettings',
      'getWindowBounds',
      'hasConfig',
      'isInitialised',
      'isPortable',
      'markInitialised',
      'saveConfig',
      'saveProfiles',
      'saveWindowBounds',
      'setActiveProfileId',
      'setStartupProfileId',
      'setStartupSettings',
    ].sort();
    assert.deepStrictEqual(Object.keys(store).sort(), expectedExports);
  });

  test('isPortable is a boolean', () => {
    const store = requireFreshStore();
    assert.strictEqual(typeof store.isPortable, 'boolean');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STANDARD MODE (non-portable)
// ─────────────────────────────────────────────────────────────────────────────

describe('store.js – standard mode (non-portable)', () => {
  beforeEach(() => {
    buildConfigContent = null;
    delete process.env.UPV_PORTABLE;
    delete process.env.UPV_ENCRYPTION_KEY;
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    delete require.cache[require.resolve('../../src/main/store')];
  });

  test('isPortable is false when no build-config.json and no env var', () => {
    const store = requireFreshStore();
    assert.strictEqual(store.isPortable, false);
  });

  test('hasConfig returns false when no profiles stored', () => {
    const store = requireFreshStore();
    assert.strictEqual(store.hasConfig(), false);
  });

  test('hasConfig returns false after saveProfiles([])', () => {
    const store = requireFreshStore();
    store.saveProfiles([]);
    assert.strictEqual(store.hasConfig(), false);
  });

  test('hasConfig returns false after clearAll', () => {
    const store = requireFreshStore();
    store.saveProfiles([{ id: 'x', name: 'P', url: 'u', username: '', password: '' }]);
    store.clearAll();
    assert.strictEqual(store.hasConfig(), false);
  });

  test('hasConfig returns true after saveConfig', () => {
    const store = requireFreshStore();
    store.saveConfig({ url: 'u', username: 'u', password: 'p' });
    assert.strictEqual(store.hasConfig(), true);
  });

  test('getProfiles returns empty array when nothing stored', () => {
    const store = requireFreshStore();
    assert.deepStrictEqual(store.getProfiles(), []);
  });

  test('getProfiles: always returns an array – never undefined', () => {
    const store = requireFreshStore();
    const result = store.getProfiles();
    assert.ok(Array.isArray(result), 'getProfiles must always return an array');
  });

  test('getProfiles after clearAll: returns empty array (not undefined)', () => {
    const store = requireFreshStore();
    store.saveProfiles([{ id: 'x', name: 'P', url: 'u', username: '', password: '' }]);
    store.clearAll();
    const result = store.getProfiles();
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 0);
  });

  test('saveProfiles and getProfiles – round-trip', () => {
    const store = requireFreshStore();
    const profiles = [{ id: 'a1', name: 'Test', url: 'https://x', username: 'u', password: 'p' }];
    store.saveProfiles(profiles);
    assert.deepStrictEqual(store.getProfiles(), profiles);
  });

  test('saveProfiles with empty array – round-trip', () => {
    const store = requireFreshStore();
    store.saveProfiles([]);
    assert.deepStrictEqual(store.getProfiles(), []);
  });

  test('hasConfig returns true after saveProfiles with at least one profile', () => {
    const store = requireFreshStore();
    store.saveProfiles([{ id: 'x', name: 'P1', url: 'u', username: '', password: '' }]);
    assert.strictEqual(store.hasConfig(), true);
  });

  test('getActiveProfileId returns undefined when not set', () => {
    const store = requireFreshStore();
    assert.strictEqual(store.getActiveProfileId(), undefined);
  });

  test('setActiveProfileId and getActiveProfileId – round-trip', () => {
    const store = requireFreshStore();
    store.setActiveProfileId('prof-42');
    assert.strictEqual(store.getActiveProfileId(), 'prof-42');
  });

  test('setActiveProfileId with empty string: stores empty string (no guard)', () => {
    const store = requireFreshStore();
    store.setActiveProfileId('');
    assert.strictEqual(store.getActiveProfileId(), '');
  });

  test('setActiveProfileId with a number: stores the number', () => {
    const store = requireFreshStore();
    store.setActiveProfileId(42);
    assert.strictEqual(store.getActiveProfileId(), 42);
  });

  test('getStartupProfileId returns undefined when not set', () => {
    const store = requireFreshStore();
    assert.strictEqual(store.getStartupProfileId(), undefined);
  });

  test('setStartupProfileId and getStartupProfileId – round-trip', () => {
    const store = requireFreshStore();
    store.setStartupProfileId('startup-1');
    assert.strictEqual(store.getStartupProfileId(), 'startup-1');
  });

  test('setStartupProfileId with null: deletes the value', () => {
    const store = requireFreshStore();
    store.setStartupProfileId('x');
    store.setStartupProfileId(null);
    assert.strictEqual(store.getStartupProfileId(), undefined);
  });

  test('setStartupProfileId with undefined: deletes the value', () => {
    const store = requireFreshStore();
    store.setStartupProfileId('x');
    store.setStartupProfileId(undefined);
    assert.strictEqual(store.getStartupProfileId(), undefined);
  });

  test('setStartupProfileId with 0: deletes the value (falsy)', () => {
    const store = requireFreshStore();
    store.setStartupProfileId('x');
    store.setStartupProfileId(0);
    assert.strictEqual(store.getStartupProfileId(), undefined);
  });

  test('setStartupProfileId with false: deletes the value (falsy)', () => {
    const store = requireFreshStore();
    store.setStartupProfileId('x');
    store.setStartupProfileId(false);
    assert.strictEqual(store.getStartupProfileId(), undefined);
  });

  test('setStartupProfileId with empty string: deletes the value (falsy)', () => {
    const store = requireFreshStore();
    store.setStartupProfileId('x');
    store.setStartupProfileId('');
    assert.strictEqual(store.getStartupProfileId(), undefined);
  });

  // ── getActiveProfile ──────────────────────────────────────────────────────

  test('getActiveProfile returns first profile when no activeProfileId set', () => {
    const store = requireFreshStore();
    const profiles = [
      { id: 'a', name: 'A', url: 'u1', username: '', password: '' },
      { id: 'b', name: 'B', url: 'u2', username: '', password: '' },
    ];
    store.saveProfiles(profiles);
    assert.deepStrictEqual(store.getActiveProfile(), profiles[0]);
  });

  test('getActiveProfile returns the profile matching activeProfileId', () => {
    const store = requireFreshStore();
    const profiles = [
      { id: 'a', name: 'A', url: 'u1', username: '', password: '' },
      { id: 'b', name: 'B', url: 'u2', username: '', password: '' },
    ];
    store.saveProfiles(profiles);
    store.setActiveProfileId('b');
    assert.deepStrictEqual(store.getActiveProfile(), profiles[1]);
  });

  test('getActiveProfile returns exact profile object (deepStrictEqual)', () => {
    const store = requireFreshStore();
    const profile = { id: 'z1', name: 'Z', url: 'https://z', username: 'zu', password: 'zp' };
    store.saveProfiles([profile]);
    store.setActiveProfileId('z1');
    assert.deepStrictEqual(store.getActiveProfile(), profile);
  });

  test('getActiveProfile returns undefined when no profiles exist', () => {
    const store = requireFreshStore();
    assert.strictEqual(store.getActiveProfile(), undefined);
  });

  test('getActiveProfile returns undefined when profiles array is empty', () => {
    const store = requireFreshStore();
    store.saveProfiles([]);
    assert.strictEqual(store.getActiveProfile(), undefined);
  });

  test('getActiveProfile falls back to profiles[0] when activeProfileId points to deleted profile', () => {
    const store = requireFreshStore();
    const profiles = [
      { id: 'a', name: 'A', url: 'u1', username: '', password: '' },
      { id: 'b', name: 'B', url: 'u2', username: '', password: '' },
    ];
    store.saveProfiles(profiles);
    store.setActiveProfileId('NONEXISTENT');
    assert.deepStrictEqual(store.getActiveProfile(), profiles[0]);
  });

  // ── getConfig (alias for getActiveProfile) ────────────────────────────────

  test('getConfig is an alias for getActiveProfile', () => {
    const store = requireFreshStore();
    const profiles = [{ id: 'z', name: 'Z', url: 'u', username: 'u', password: 'p' }];
    store.saveProfiles(profiles);
    store.setActiveProfileId('z');
    assert.deepStrictEqual(store.getConfig(), store.getActiveProfile());
  });

  // ── saveConfig ────────────────────────────────────────────────────────────

  test('saveConfig updates an existing active profile', () => {
    const store = requireFreshStore();
    store.saveProfiles([{ id: 'p1', name: 'Old', url: 'old', username: 'a', password: 'b' }]);
    store.setActiveProfileId('p1');
    store.saveConfig({ url: 'new-url', username: 'newuser', password: 'newpass' });
    const profiles = store.getProfiles();
    assert.strictEqual(profiles[0].url, 'new-url');
    assert.strictEqual(profiles[0].username, 'newuser');
    assert.strictEqual(profiles[0].password, 'newpass');
    assert.strictEqual(profiles[0].id, 'p1');
    assert.strictEqual(profiles.length, 1);
  });

  test('saveConfig: new profile id is a non-empty string (UUID)', () => {
    const store = requireFreshStore();
    store.saveConfig({ url: 'u', username: 'u', password: 'p' });
    const [p] = store.getProfiles();
    assert.strictEqual(typeof p.id, 'string');
    assert.ok(p.id.length > 0, 'id must not be empty');
  });

  test('saveConfig: creates exactly 1 profile on first call', () => {
    const store = requireFreshStore();
    store.saveConfig({ url: 'u', username: 'u', password: 'p' });
    assert.strictEqual(store.getProfiles().length, 1);
  });

  test('saveConfig: multiple calls on same profile do not create additional profiles', () => {
    const store = requireFreshStore();
    store.saveConfig({ url: 'u1', username: 'u', password: 'p' });
    store.saveConfig({ url: 'u2', username: 'u', password: 'p' });
    assert.strictEqual(store.getProfiles().length, 1);
    assert.strictEqual(store.getProfiles()[0].url, 'u2');
  });

  test('saveConfig: new profile name is "Profile 1"', () => {
    const store = requireFreshStore();
    store.saveConfig({ url: 'u', username: 'u', password: 'p' });
    assert.strictEqual(store.getProfiles()[0].name, 'Profile 1');
  });

  test('saveConfig: sets activeProfileId to the new profile id', () => {
    const store = requireFreshStore();
    store.saveConfig({ url: 'u', username: 'u', password: 'p' });
    const [p] = store.getProfiles();
    assert.strictEqual(store.getActiveProfileId(), p.id);
  });

  test('saveConfig: only updates the active profile, leaves others unchanged', () => {
    const store = requireFreshStore();
    const profiles = [
      { id: 'a', name: 'A', url: 'ua', username: 'ua', password: 'pa' },
      { id: 'b', name: 'B', url: 'ub', username: 'ub', password: 'pb' },
    ];
    store.saveProfiles(profiles);
    store.setActiveProfileId('a');
    store.saveConfig({ url: 'new-a', username: 'new-ua', password: 'new-pa' });
    const updated = store.getProfiles();
    assert.strictEqual(updated.length, 2);
    assert.strictEqual(updated[0].url, 'new-a');
    assert.strictEqual(updated[1].url, 'ub');
  });

  test('saveConfig creates new profile when no active profile exists', () => {
    const store = requireFreshStore();
    store.saveConfig({ url: 'https://new', username: 'usr', password: 'pw' });
    const profiles = store.getProfiles();
    assert.strictEqual(profiles.length, 1);
    assert.strictEqual(profiles[0].url, 'https://new');
    assert.strictEqual(profiles[0].username, 'usr');
    assert.strictEqual(profiles[0].password, 'pw');
    assert.strictEqual(profiles[0].name, 'Profile 1');
    assert.ok(typeof profiles[0].id === 'string' && profiles[0].id.length > 0);
  });

  test('saveConfig with empty object creates profile with empty strings', () => {
    const store = requireFreshStore();
    store.saveConfig({});
    const profiles = store.getProfiles();
    assert.strictEqual(profiles.length, 1);
    assert.strictEqual(profiles[0].url, '');
    assert.strictEqual(profiles[0].username, '');
    assert.strictEqual(profiles[0].password, '');
  });

  test('saveConfig with partial object (only url) fills remaining fields with empty strings', () => {
    const store = requireFreshStore();
    store.saveConfig({ url: 'https://partial' });
    const profiles = store.getProfiles();
    assert.strictEqual(profiles[0].url, 'https://partial');
    assert.strictEqual(profiles[0].username, '');
    assert.strictEqual(profiles[0].password, '');
  });

  // ── saveWindowBounds / getWindowBounds ────────────────────────────────────

  test('saveWindowBounds stores bounds in standard mode', () => {
    const store = requireFreshStore();
    const bounds = { x: 10, y: 20, width: 800, height: 600 };
    store.saveWindowBounds(bounds);
    assert.deepStrictEqual(store.getWindowBounds(), bounds);
  });

  test('saveWindowBounds: second call overwrites first', () => {
    const store = requireFreshStore();
    store.saveWindowBounds({ x: 0, y: 0, width: 800, height: 600 });
    store.saveWindowBounds({ x: 100, y: 200, width: 1920, height: 1080 });
    assert.deepStrictEqual(store.getWindowBounds(), { x: 100, y: 200, width: 1920, height: 1080 });
  });

  test('getWindowBounds returns undefined when nothing stored', () => {
    const store = requireFreshStore();
    assert.strictEqual(store.getWindowBounds(), undefined);
  });

  // ── isInitialised / markInitialised ───────────────────────────────────────

  test('isInitialised returns false before markInitialised', () => {
    const store = requireFreshStore();
    assert.strictEqual(store.isInitialised(), false);
  });

  test('markInitialised sets the init flag', () => {
    const store = requireFreshStore();
    store.markInitialised();
    assert.strictEqual(store.isInitialised(), true);
  });

  // ── clearAll ──────────────────────────────────────────────────────────────

  test('clearAll empties the store', () => {
    const store = requireFreshStore();
    store.saveProfiles([{ id: 'x', name: 'P', url: 'u', username: '', password: '' }]);
    store.markInitialised();
    store.clearAll();
    assert.strictEqual(store.hasConfig(), false);
    assert.strictEqual(store.isInitialised(), false);
  });

  test('clearAll makes getProfiles return empty array', () => {
    const store = requireFreshStore();
    store.saveProfiles([{ id: 'x', name: 'P', url: 'u', username: '', password: '' }]);
    store.clearAll();
    assert.deepStrictEqual(store.getProfiles(), []);
  });

  test('clearAll resets activeProfileId to undefined', () => {
    const store = requireFreshStore();
    store.saveProfiles([{ id: 'x', name: 'P', url: 'u', username: '', password: '' }]);
    store.setActiveProfileId('x');
    store.clearAll();
    assert.strictEqual(store.getActiveProfileId(), undefined);
  });

  test('clearAll resets startupProfileId to undefined', () => {
    const store = requireFreshStore();
    store.setStartupProfileId('some-id');
    store.clearAll();
    assert.strictEqual(store.getStartupProfileId(), undefined);
  });

  test('clearAll resets getWindowBounds to undefined', () => {
    const store = requireFreshStore();
    store.saveWindowBounds({ x: 0, y: 0, width: 1280, height: 760 });
    store.clearAll();
    assert.strictEqual(store.getWindowBounds(), undefined);
  });

  // ── Migration tests ───────────────────────────────────────────────────────

  test('migrateIfNeeded: migrates old config format to profiles array', () => {
    const store = requireFreshStore();
    mockStoreInstance._seed({
      config: { url: 'https://old', username: 'legacy', password: 'legacy-pw' },
    });
    const profiles = store.getProfiles();
    assert.strictEqual(profiles.length, 1);
    assert.strictEqual(profiles[0].url, 'https://old');
    assert.strictEqual(profiles[0].username, 'legacy');
    assert.strictEqual(profiles[0].name, 'Profile 1');
    assert.strictEqual(mockStoreInstance.has('config'), false);
  });

  test('migrateIfNeeded: migrated profile id is a non-empty string', () => {
    const store = requireFreshStore();
    mockStoreInstance._seed({
      config: { url: 'https://old', username: 'u', password: 'p' },
    });
    const [p] = store.getProfiles();
    assert.strictEqual(typeof p.id, 'string');
    assert.ok(p.id.length > 0);
  });

  test('migrateIfNeeded: sets activeProfileId to the migrated profile id', () => {
    const store = requireFreshStore();
    mockStoreInstance._seed({
      config: { url: 'https://old', username: 'u', password: 'p' },
    });
    const [p] = store.getProfiles();
    assert.strictEqual(store.getActiveProfileId(), p.id);
  });

  test('migrateIfNeeded: deletes the old "config" key', () => {
    const store = requireFreshStore();
    mockStoreInstance._seed({
      config: { url: 'https://old', username: 'u', password: 'p' },
    });
    store.getProfiles();
    assert.strictEqual(mockStoreInstance.has('config'), false);
  });

  test('migrateIfNeeded: migrates old config with missing fields (url/username/password undefined)', () => {
    const store = requireFreshStore();
    mockStoreInstance._seed({ config: {} });
    const profiles = store.getProfiles();
    assert.strictEqual(profiles.length, 1);
    assert.strictEqual(profiles[0].url, '');
    assert.strictEqual(profiles[0].username, '');
    assert.strictEqual(profiles[0].password, '');
  });

  test('migrateIfNeeded: does NOT re-run when profiles already exist', () => {
    const store = requireFreshStore();
    const existingProfiles = [{ id: 'existing', name: 'E', url: 'u', username: '', password: '' }];
    mockStoreInstance._seed({
      profiles: existingProfiles,
      config: { url: 'SHOULD_NOT_MIGRATE', username: 'x', password: 'y' },
    });
    const profiles = store.getProfiles();
    assert.strictEqual(profiles.length, 1);
    assert.strictEqual(profiles[0].id, 'existing');
  });

  test('migrateIfNeeded: is idempotent – running twice does not corrupt data', () => {
    const store = requireFreshStore();
    mockStoreInstance._seed({
      config: { url: 'https://old', username: 'u', password: 'p' },
    });
    store.getProfiles(); // triggers migration
    const profiles1 = store.getProfiles(); // second call – profiles already exist
    assert.strictEqual(profiles1.length, 1);
    assert.strictEqual(profiles1[0].url, 'https://old');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTABLE MODE via env var
// ─────────────────────────────────────────────────────────────────────────────

describe('store.js – portable mode via env var', () => {
  beforeEach(() => {
    buildConfigContent = null;
    process.env.UPV_PORTABLE = 'true';
    installMocks();
    mockFsExistsSync = (p) => {
      if (p.endsWith('build-config.json')) return false;
      return false;
    };
    mockFsMkdirSync = () => {};
    Module._load = function (request, parent, isMain) {
      if (request === 'electron-store') {
        return class {
          constructor() {
            return mockStoreInstance;
          }
        };
      }
      if (request === 'node:fs') {
        return {
          existsSync: mockFsExistsSync,
          readFileSync: mockFsReadFileSync,
          mkdirSync: mockFsMkdirSync,
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
  });

  afterEach(() => {
    uninstallMocks();
    delete process.env.UPV_PORTABLE;
    delete require.cache[require.resolve('../../src/main/store')];
  });

  test('isPortable is true when UPV_PORTABLE=true is set', () => {
    const store = requireFreshStore();
    assert.strictEqual(store.isPortable, true);
  });

  test('saveWindowBounds does nothing in portable mode', () => {
    const store = requireFreshStore();
    const bounds = { x: 5, y: 5, width: 100, height: 100 };
    store.saveWindowBounds(bounds);
    assert.strictEqual(store.getWindowBounds(), undefined);
  });

  test('UPV_PORTABLE=false (string) does not enable portable mode', () => {
    delete process.env.UPV_PORTABLE;
    process.env.UPV_PORTABLE = 'false';
    const store = requireFreshStore();
    assert.strictEqual(store.isPortable, false);
    delete process.env.UPV_PORTABLE;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTABLE MODE via build-config.json
// ─────────────────────────────────────────────────────────────────────────────

describe('store.js – portable mode via build-config.json', () => {
  beforeEach(() => {
    buildConfigContent = { portable: true, encryptionKey: 'test-key-123' };
    delete process.env.UPV_PORTABLE;
    installMocks();
    mockFsExistsSync = (p) => {
      if (p.endsWith('build-config.json')) return true;
      return false;
    };
    Module._load = function (request, parent, isMain) {
      if (request === 'electron-store') {
        return class {
          constructor() {
            return mockStoreInstance;
          }
        };
      }
      if (request === 'node:fs') {
        return {
          existsSync: mockFsExistsSync,
          readFileSync: mockFsReadFileSync,
          mkdirSync: mockFsMkdirSync,
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
  });

  afterEach(() => {
    uninstallMocks();
    delete require.cache[require.resolve('../../src/main/store')];
  });

  test('isPortable is true when build-config.json contains portable=true', () => {
    const store = requireFreshStore();
    assert.strictEqual(store.isPortable, true);
  });

  test('isPortable is false when build-config.json contains portable=false', () => {
    buildConfigContent = { portable: false, encryptionKey: 'key' };
    const store = requireFreshStore();
    assert.strictEqual(store.isPortable, false);
  });

  test('isPortable is false when build-config.json omits portable key', () => {
    buildConfigContent = { encryptionKey: 'key' };
    const store = requireFreshStore();
    assert.strictEqual(store.isPortable, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MALFORMED build-config.json – fallback to env var
// ─────────────────────────────────────────────────────────────────────────────

describe('store.js – malformed build-config.json falls back to env var', () => {
  beforeEach(() => {
    buildConfigContent = null;
    installMocks();
    mockFsExistsSync = (p) => p.endsWith('build-config.json');
    mockFsReadFileSync = () => 'NOT VALID JSON!!!{{{';
    Module._load = function (request, parent, isMain) {
      if (request === 'electron-store') {
        return class {
          constructor() {
            return mockStoreInstance;
          }
        };
      }
      if (request === 'node:fs') {
        return {
          existsSync: mockFsExistsSync,
          readFileSync: mockFsReadFileSync,
          mkdirSync: mockFsMkdirSync,
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
  });

  afterEach(() => {
    uninstallMocks();
    delete process.env.UPV_PORTABLE;
    delete require.cache[require.resolve('../../src/main/store')];
  });

  test('falls back to env var when build-config.json is invalid (no UPV_PORTABLE → false)', () => {
    delete process.env.UPV_PORTABLE;
    const store = requireFreshStore();
    assert.strictEqual(store.isPortable, false);
  });

  test('falls back to env var when build-config.json is invalid (UPV_PORTABLE=true → true)', () => {
    process.env.UPV_PORTABLE = 'true';
    const store = requireFreshStore();
    assert.strictEqual(store.isPortable, true);
    delete process.env.UPV_PORTABLE;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL STARTUP SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

describe('store.js – getStartupSettings / setStartupSettings', () => {
  beforeEach(() => {
    buildConfigContent = null;
    delete process.env.UPV_PORTABLE;
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    delete require.cache[require.resolve('../../src/main/store')];
  });

  test('getStartupSettings returns default when nothing stored', () => {
    const store = requireFreshStore();
    const settings = store.getStartupSettings();
    assert.deepStrictEqual(settings, { profileId: null, fullscreen: false, displayIndex: 0 });
  });

  test('setStartupSettings persists all fields – round-trip', () => {
    const store = requireFreshStore();
    store.setStartupSettings({ profileId: 'abc', fullscreen: true, displayIndex: 2 });
    assert.deepStrictEqual(store.getStartupSettings(), {
      profileId: 'abc',
      fullscreen: true,
      displayIndex: 2,
    });
  });

  test('setStartupSettings merges partial objects', () => {
    const store = requireFreshStore();
    store.setStartupSettings({ profileId: 'abc', fullscreen: true, displayIndex: 1 });
    store.setStartupSettings({ fullscreen: false });
    const s = store.getStartupSettings();
    assert.strictEqual(s.profileId, 'abc');
    assert.strictEqual(s.fullscreen, false);
    assert.strictEqual(s.displayIndex, 1);
  });

  test('setStartupSettings with profileId=null clears profileId and legacy key', () => {
    const store = requireFreshStore();
    store.setStartupSettings({ profileId: 'abc', fullscreen: true, displayIndex: 0 });
    store.setStartupSettings({ profileId: null });
    const s = store.getStartupSettings();
    assert.strictEqual(s.profileId, null);
    // Legacy key must also be cleared
    assert.strictEqual(store.getStartupProfileId(), undefined);
  });

  test('setStartupSettings with profileId set also writes legacy startupProfileId', () => {
    const store = requireFreshStore();
    store.setStartupSettings({ profileId: 'xyz', fullscreen: false, displayIndex: 0 });
    assert.strictEqual(store.getStartupProfileId(), 'xyz');
  });

  test('setStartupProfileId (deprecated shim) writes through to startupSettings', () => {
    const store = requireFreshStore();
    store.setStartupProfileId('shim-profile');
    assert.strictEqual(store.getStartupSettings().profileId, 'shim-profile');
  });

  test('setStartupProfileId(null) clears profileId in startupSettings', () => {
    const store = requireFreshStore();
    store.setStartupProfileId('shim-profile');
    store.setStartupProfileId(null);
    assert.strictEqual(store.getStartupSettings().profileId, null);
  });

  test('fullscreen defaults to false', () => {
    const store = requireFreshStore();
    assert.strictEqual(store.getStartupSettings().fullscreen, false);
  });

  test('displayIndex defaults to 0', () => {
    const store = requireFreshStore();
    assert.strictEqual(store.getStartupSettings().displayIndex, 0);
  });
});
