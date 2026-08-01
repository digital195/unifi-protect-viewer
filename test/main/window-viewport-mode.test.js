'use strict';

/**
 * @file test/main/window-viewport-mode.test.js
 * @description 2c contract tests: loadInitialPage's TOP-LEVEL Viewport-mode
 * override (beats profile-select/config paths), the dedicated connection fed
 * to AdoptionClient, and fallback-profile-on-fatal / grace-window behavior.
 * Same Module._load mock pattern as window-viewport-gate.test.js.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Module } = require('node:module');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const os = require('node:os');

const {
  installElectronMock,
  uninstallElectronMock,
  resetElectronMocks,
} = require('../helpers/mock-electron');

const MockStore = require('../helpers/mock-store');
let mockStoreInstance;

// render-session.js is intentionally NOT mocked here (no Electron/Node I/O
// dependency; it's the real singleton window.js writes to) so these tests can
// observe exactly what ipc.js's onConfigLoad would see in real usage.
const renderSession = require('../../src/main/render-session');

const VP_DEFAULTS = {
  enabled: false,
  name: '',
  url: '',
  username: '',
  password: '',
  fallbackProfileId: null,
};

const storeApi = {
  getProfiles: () => mockStoreInstance.get('profiles', []),
  getStartupProfileId: () => mockStoreInstance.get('startupProfileId'),
  getStartupSettings: () =>
    mockStoreInstance.get('startupSettings', {
      profileId: null,
      fullscreen: false,
      displayIndex: 0,
    }),
  setActiveProfileId: (id) => mockStoreInstance.set('activeProfileId', id),
  getWindowBounds: () => mockStoreInstance.get('bounds'),
  saveWindowBounds: (b) => mockStoreInstance.set('bounds', b),
  isInitialised: () => mockStoreInstance.has('init'),
  markInitialised: () => mockStoreInstance.set('init', true),
  getViewportConfig: () => ({ ...VP_DEFAULTS, ...mockStoreInstance.get('viewport', {}) }),
};

const trayMock = { createTray: () => {} };
const ipcMock = { registerF11Handler: () => {}, currentLogger: () => null };

let adoptionInstances;
class MockAdoptionClient extends EventEmitter {
  constructor() {
    super();
    this.startCalls = [];
    this.stopCalls = 0;
    adoptionInstances.push(this);
  }
  start(conn) {
    this.startCalls.push(conn);
    return Promise.resolve();
  }
  stop() {
    this.stopCalls += 1;
  }
}

let bridgeInstances;
class MockViewportBridge extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts;
    this.started = false;
    bridgeInstances.push(this);
  }
  start() {
    this.started = true;
  }
  stop() {}
}

const originalLoad = Module._load;
function installMocks() {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return require('../helpers/mock-electron').electronMock;
    if (request === './store') return storeApi;
    if (request === './tray') return trayMock;
    if (request === './ipc') return ipcMock;
    if (request === './viewport/adoption') return { AdoptionClient: MockAdoptionClient };
    if (request === './viewport/bridge') return { ViewportBridge: MockViewportBridge };
    return originalLoad.call(this, request, parent, isMain);
  };
}
function uninstallMocks() {
  Module._load = originalLoad;
}
function requireFreshWindow() {
  const p = require.resolve('../../src/main/window');
  delete require.cache[p];
  return require('../../src/main/window');
}

function seedViewport(overrides = {}) {
  mockStoreInstance.set('viewport', {
    enabled: true,
    name: 'Lobby',
    url: 'https://nvr.local',
    username: 'admin',
    password: 'hunter2',
    fallbackProfileId: null,
    ...overrides,
  });
}
function seedProfiles(list) {
  mockStoreInstance.set('profiles', list);
}

describe('window.js – 2c top-level Viewport-mode override', () => {
  beforeEach(() => {
    mockStoreInstance = new MockStore();
    adoptionInstances = [];
    bridgeInstances = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
    renderSession.clear();
  });
  afterEach(() => {
    renderSession.clear();
    uninstallMocks();
    uninstallElectronMock();
  });

  test('viewport mode beats the profile-select path (multiple profiles, no startup profile)', async () => {
    seedProfiles([
      { id: 'a', name: 'A', url: 'https://a.local' },
      { id: 'b', name: 'B', url: 'https://b.local' },
    ]);
    seedViewport();
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    assert.equal(win._url, 'https://nvr.local', 'must load the DEDICATED viewport URL');
    assert.equal(win._file, null, 'must NOT load profile-select.html');
    assert.equal(adoptionInstances.length, 1);
  });

  test('viewport mode works with ZERO profiles (no config.html detour)', async () => {
    seedProfiles([]);
    seedViewport();
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    assert.equal(win._url, 'https://nvr.local');
    assert.equal(win._file, null, 'must NOT load config.html');
  });

  test('AdoptionClient receives the dedicated connection (url/username/password from viewport config)', async () => {
    seedProfiles([{ id: 'a', name: 'A', url: 'https://a.local' }]);
    seedViewport();
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    const conn = adoptionInstances[0].startCalls[0];
    assert.equal(conn.url, 'https://nvr.local');
    assert.equal(conn.username, 'admin');
    assert.equal(conn.password, 'hunter2');
    assert.equal(conn.deviceName, 'Lobby');
    assert.equal(conn.dataDir, path.join('/mock/userData', 'viewport'));
  });

  test('empty creds map to undefined (keyless reconnect of a pre-adopted viewer)', async () => {
    seedViewport({ username: '', password: '' });
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    const conn = adoptionInstances[0].startCalls[0];
    assert.equal(conn.username, undefined);
    assert.equal(conn.password, undefined);
  });

  test('empty device name falls back to `<HOSTNAME>_VIEWPORT`', async () => {
    seedViewport({ name: '' });
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.equal(
      adoptionInstances[0].startCalls[0].deviceName,
      `${os.hostname().toUpperCase()}_VIEWPORT`,
    );
  });

  test('viewport enabled WITHOUT url: profile flow + Phase-1 poller (backwards compatible)', async () => {
    seedProfiles([{ id: 'a', name: 'A', url: 'https://a.local' }]);
    seedViewport({ url: '', username: '', password: '' });
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    assert.equal(win._url, 'https://a.local', 'single-profile flow unchanged');
    assert.equal(adoptionInstances.length, 0, 'no AdoptionClient without a dedicated url');
    assert.equal(bridgeInstances.length, 1, 'Phase-1 poller must still start');
    assert.equal(bridgeInstances[0].started, true);
  });

  test('viewport disabled: everything behaves as before (no client, no poller)', async () => {
    seedProfiles([{ id: 'a', name: 'A', url: 'https://a.local' }]);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    assert.equal(win._url, 'https://a.local');
    assert.equal(adoptionInstances.length, 0);
    assert.equal(bridgeInstances.length, 0);
  });

  // ── fallback profile ───────────────────────────────────────────────────────

  test('FATAL adoption error + fallback set → loads the fallback profile and activates it', async () => {
    seedProfiles([{ id: 'fb', name: 'Fallback', url: 'https://fallback.local' }]);
    seedViewport({ fallbackProfileId: 'fb' });
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    adoptionInstances[0].emit('error', { message: 'rejected fingerprint: HTTP 403', fatal: true });
    assert.equal(win._url, 'https://fallback.local');
    assert.equal(mockStoreInstance.get('activeProfileId'), 'fb');
    assert.equal(adoptionInstances[0].stopCalls, 1, 'client must be stopped on fatal');
  });

  // I#1 (Task 6 review): a fatal error with no USABLE fallback must never
  // leave the app silently stuck on a dead Protect login page – it surfaces
  // by navigating to config.html so the user can recover.

  test('FATAL error + STALE fallbackProfileId (no usable fallback) → surfaces via config.html (I#1)', async () => {
    seedProfiles([{ id: 'other', name: 'O', url: 'https://o.local' }]);
    seedViewport({ fallbackProfileId: 'deleted-id' });
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    adoptionInstances[0].emit('error', { message: 'fatal', fatal: true });
    assert.ok(
      win._file && win._file.endsWith('config.html'),
      `expected config.html, got: ${win._file}`,
    );
    assert.equal(adoptionInstances[0].stopCalls, 1, 'client must still be stopped on fatal');
  });

  test('FATAL error + NO fallback configured → surfaces via config.html (I#1)', async () => {
    seedViewport();
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    adoptionInstances[0].emit('error', { message: 'fatal', fatal: true });
    assert.ok(
      win._file && win._file.endsWith('config.html'),
      `expected config.html, got: ${win._file}`,
    );
  });

  // ── render-session override (I1 fix) ────────────────────────────────────────
  // The whole-branch review found that after a fallback fires, ipc.js's
  // onConfigLoad kept returning the viewport connection (its store-side
  // `enabled`/`url` gate is untouched by a fallback) – so the render session
  // never actually became the fallback profile. These tests assert window.js
  // now sets the render-session override to the FALLBACK PROFILE's own
  // url/username/password, which is what onConfigLoad checks first.

  test('FATAL error + fallback → render-session override becomes the fallback profile (not the viewport connection)', async () => {
    seedProfiles([
      {
        id: 'fb',
        name: 'Fallback',
        url: 'https://fallback.local',
        username: 'fbuser',
        password: 'fbpass',
      },
    ]);
    seedViewport({ fallbackProfileId: 'fb' });
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.equal(
      renderSession.getRenderCredentialOverride(),
      null,
      'no override before fallback fires',
    );
    adoptionInstances[0].emit('error', { message: 'rejected fingerprint: HTTP 403', fatal: true });
    assert.deepEqual(renderSession.getRenderCredentialOverride(), {
      url: 'https://fallback.local',
      username: 'fbuser',
      password: 'fbpass',
    });
  });

  test('grace-timeout fallback → render-session override also becomes the fallback profile', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    seedProfiles([
      {
        id: 'fb',
        name: 'Fallback',
        url: 'https://fallback.local',
        username: 'fbuser',
        password: 'fbpass',
      },
    ]);
    seedViewport({ fallbackProfileId: 'fb' });
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    t.mock.timers.tick(60_000);
    assert.deepEqual(renderSession.getRenderCredentialOverride(), {
      url: 'https://fallback.local',
      username: 'fbuser',
      password: 'fbpass',
    });
  });

  test('normal Viewport-mode launch (no fallback fired) → render-session override stays unset', async () => {
    seedProfiles([{ id: 'fb', name: 'Fallback', url: 'https://fallback.local' }]);
    seedViewport({ fallbackProfileId: 'fb' });
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    adoptionInstances[0].emit('online', true); // healthy connection, no fallback
    assert.equal(renderSession.getRenderCredentialOverride(), null);
  });

  test('a stale override from a previous window is cleared at the start of a fresh normal launch', async () => {
    renderSession.setRenderCredentialOverride({ url: 'https://stale.local' });
    seedProfiles([{ id: 'a', name: 'A', url: 'https://a.local' }]);
    seedViewport({ fallbackProfileId: null });
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    assert.equal(win._url, 'https://nvr.local', 'must load the DEDICATED viewport URL, unaffected');
    assert.equal(
      renderSession.getRenderCredentialOverride(),
      null,
      'stale override must be cleared',
    );
  });

  test('non-fatal errors never trigger the fallback', async () => {
    seedProfiles([{ id: 'fb', name: 'Fallback', url: 'https://fallback.local' }]);
    seedViewport({ fallbackProfileId: 'fb' });
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    adoptionInstances[0].emit('error', { message: 'blip' });
    adoptionInstances[0].emit('error', { message: 'blip', fatal: false });
    assert.equal(win._url, 'https://nvr.local');
  });

  // ── grace window ───────────────────────────────────────────────────────────

  test('no online within the 60s grace window + fallback set → falls back', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    seedProfiles([{ id: 'fb', name: 'Fallback', url: 'https://fallback.local' }]);
    seedViewport({ fallbackProfileId: 'fb' });
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    t.mock.timers.tick(60_000);
    assert.equal(win._url, 'https://fallback.local');
    assert.equal(adoptionInstances[0].stopCalls, 1);
  });

  test('online BEFORE the grace window expires → no fallback', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    seedProfiles([{ id: 'fb', name: 'Fallback', url: 'https://fallback.local' }]);
    seedViewport({ fallbackProfileId: 'fb' });
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    adoptionInstances[0].emit('online', true);
    t.mock.timers.tick(120_000);
    assert.equal(win._url, 'https://nvr.local', 'must stay on the viewport connection');
    assert.equal(adoptionInstances[0].stopCalls, 0);
  });

  test('no fallback configured → NO grace timer is armed (client keeps retrying forever)', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    seedViewport({ fallbackProfileId: null });
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    t.mock.timers.tick(600_000);
    assert.equal(win._url, 'https://nvr.local');
    assert.equal(adoptionInstances[0].stopCalls, 0);
  });
});
