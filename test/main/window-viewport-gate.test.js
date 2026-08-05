'use strict';

/**
 * @file test/main/window-viewport-gate.test.js
 * @description Behavioral contract tests for window.js's Viewport mode gate
 * inside `startViewportBridge` (adoption vs. Phase-1 poller branch selection,
 * dataDir/deviceName computation, STRICT fatal-error classification, and
 * `win.on('closed')` cleanup).
 *
 * `startViewportBridge` itself is not exported (only `createMainWindow` is), so
 * these tests drive it through the real `createMainWindow` → `loadInitialPage`
 * path, using the SAME `Module._load` mocking pattern window.test.js already
 * applies to './store'/'./tray'/'./ipc' — extended here with mocks for
 * './viewport/adoption' and './viewport/bridge' so no real network/filesystem
 * I/O ever happens. './viewport/native' is left real: it's pure/Electron-free
 * and already fully unit-tested in viewport-native.test.js, so exercising it
 * for real here also verifies the two modules wire together correctly.
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
  getViewportConfig: () => ({
    enabled: false,
    name: '',
    url: '',
    username: '',
    password: '',
    fallbackProfileId: null,
    ...mockStoreInstance.get('viewport', {}),
  }),
};

const trayMock = { createTray: () => {} };
const ipcMock = { registerF11Handler: () => {}, currentLogger: () => null };

// ── Mock AdoptionClient: records start()/stop() calls, is a real EventEmitter
// so tests can drive 'online'/'error' events exactly like the real connection
// would, without any network/filesystem I/O. ──────────────────────────────────
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

// ── Mock ViewportBridge (Phase-1 poller): just records construction/start/stop
// so adoption-vs-fallback branch selection is directly observable. ─────────────
let bridgeInstances;
class MockViewportBridge extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts;
    this.started = false;
    this.stopCalls = 0;
    bridgeInstances.push(this);
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopCalls += 1;
  }
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

function setSingleProfile(url = 'https://nvr.local/protect') {
  mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url }]);
}

describe('window.js – Viewport mode gate (adoption vs. Phase-1 poller)', () => {
  beforeEach(() => {
    mockStoreInstance = new MockStore();
    adoptionInstances = [];
    bridgeInstances = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
  });

  // ── (a) branch selection ──────────────────────────────────────────────────

  test('dedicated url set starts an AdoptionClient and does NOT start the Phase-1 poller', async () => {
    setSingleProfile();
    mockStoreInstance.set('viewport', {
      enabled: true,
      url: 'https://nvr.local/protect',
      name: 'Lobby',
    });
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.equal(adoptionInstances.length, 1, 'AdoptionClient should be constructed exactly once');
    assert.equal(bridgeInstances.length, 0, 'ViewportBridge poller should NOT be constructed');
  });

  test('no dedicated url configured falls back to the Phase-1 poller, not AdoptionClient', async () => {
    setSingleProfile();
    mockStoreInstance.set('viewport', { enabled: true, name: 'Lobby' }); // no `url` key
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.equal(
      bridgeInstances.length,
      1,
      'ViewportBridge poller should be constructed exactly once',
    );
    assert.equal(bridgeInstances[0].started, true, 'poller should be started');
    assert.equal(adoptionInstances.length, 0, 'AdoptionClient should NOT be constructed');
  });

  test('viewport disabled entirely: neither AdoptionClient nor the poller is constructed', async () => {
    setSingleProfile();
    mockStoreInstance.set('viewport', {
      enabled: false,
      url: 'https://nvr.local/protect',
      name: 'Lobby',
    });
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.equal(adoptionInstances.length, 0);
    assert.equal(bridgeInstances.length, 0);
  });

  // ── (b) dataDir + deviceName ───────────────────────────────────────────────

  test('adopt: passes dataDir = path.join(userData, "viewport") and the configured deviceName/url to client.start()', async () => {
    setSingleProfile('https://nvr.local/protect');
    mockStoreInstance.set('viewport', {
      enabled: true,
      url: 'https://nvr.local/protect',
      name: 'Lobby',
    });
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.equal(adoptionInstances.length, 1);
    const conn = adoptionInstances[0].startCalls[0];
    assert.equal(conn.dataDir, path.join('/mock/userData', 'viewport'));
    assert.equal(conn.deviceName, 'Lobby');
    assert.equal(conn.url, 'https://nvr.local/protect');
  });

  test('adopt: deviceName falls back to `<HOSTNAME>_VIEWPORT` when vp.name is unset', async () => {
    setSingleProfile();
    mockStoreInstance.set('viewport', { enabled: true, url: 'https://nvr.local/protect' }); // no name
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    const conn = adoptionInstances[0].startCalls[0];
    assert.equal(conn.deviceName, `${os.hostname().toUpperCase()}_VIEWPORT`);
  });

  test('adopt: username/password default to undefined when not configured (keyless reconnect path)', async () => {
    setSingleProfile();
    mockStoreInstance.set('viewport', {
      enabled: true,
      url: 'https://nvr.local/protect',
      name: 'Lobby',
    });
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    const conn = adoptionInstances[0].startCalls[0];
    assert.equal(conn.username, undefined);
    assert.equal(conn.password, undefined);
  });

  // ── (c) STRICT fatal-error classification ─────────────────────────────────

  test('adopt error: fatal === true stops the client (unrecoverable, surfaced)', async () => {
    setSingleProfile();
    mockStoreInstance.set('viewport', {
      enabled: true,
      url: 'https://nvr.local/protect',
      name: 'Lobby',
    });
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    const client = adoptionInstances[0];
    assert.equal(client.stopCalls, 0);
    client.emit('error', { message: 'rejected fingerprint: HTTP 403', fatal: true });
    assert.equal(client.stopCalls, 1, 'fatal === true must stop the client');
  });

  test('adopt error: fatal === false does NOT stop the client (transient, self-reconnects)', async () => {
    setSingleProfile();
    mockStoreInstance.set('viewport', {
      enabled: true,
      url: 'https://nvr.local/protect',
      name: 'Lobby',
    });
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    const client = adoptionInstances[0];
    client.emit('error', { message: 'transient network blip', fatal: false });
    assert.equal(client.stopCalls, 0, 'fatal === false must NOT stop the client');
  });

  test('adopt error: fatal undefined (field absent) does NOT stop the client (transient, self-reconnects)', async () => {
    setSingleProfile();
    mockStoreInstance.set('viewport', {
      enabled: true,
      url: 'https://nvr.local/protect',
      name: 'Lobby',
    });
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    const client = adoptionInstances[0];
    // start()'s own catch-all (e.g. identity load failure) emits {message} only,
    // with no `fatal` key at all — must not be misclassified as fatal.
    client.emit('error', { message: 'identity load failed' });
    assert.equal(client.stopCalls, 0, 'fatal undefined must NOT stop the client');
  });

  test('adopt error: repeated non-fatal errors never accumulate stop() calls', async () => {
    setSingleProfile();
    mockStoreInstance.set('viewport', {
      enabled: true,
      url: 'https://nvr.local/protect',
      name: 'Lobby',
    });
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    const client = adoptionInstances[0];
    client.emit('error', { message: 'blip 1', fatal: false });
    client.emit('error', { message: 'blip 2' });
    client.emit('error', { message: 'blip 3', fatal: false });
    assert.equal(client.stopCalls, 0);
  });

  // ── (d) win 'closed' cleanup ───────────────────────────────────────────────

  test('adopt: win "closed" event calls client.stop() for cleanup (no socket/timer leak)', async () => {
    setSingleProfile();
    mockStoreInstance.set('viewport', {
      enabled: true,
      url: 'https://nvr.local/protect',
      name: 'Lobby',
    });
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    const client = adoptionInstances[0];
    assert.equal(client.stopCalls, 0);
    win.emit('closed');
    assert.equal(client.stopCalls, 1, 'closed event must stop the AdoptionClient');
  });
});
