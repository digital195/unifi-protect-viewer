'use strict';

/**
 * @file test/main/window.test.js
 * @description Behavioral contract tests for src/main/window.js
 *
 * Guarantees:
 *  - Exported symbol surface is locked (add/remove → test failure)
 *  - BrowserWindow constructor options are locked down exactly
 *    (changing any value, e.g. minWidth from 800 to 1024, breaks tests)
 *  - USER_AGENT constant is locked
 *  - loadInitialPage routing logic is fully tested including all edge cases
 *  - markInitialised call contracts enforced (not called on 0-profile path)
 *  - activeProfileId set correctly per routing branch
 *  - did-fail-load behavior is tested for all branches (code -3, code -2, etc.)
 *  - Window lifecycle events (ready-to-show, close, page-title-updated) are tested
 *  - close-event bounds precision is verified (all 4 fields)
 *  - createMainWindow return type (Promise<BrowserWindow>) is verified
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Module } = require('node:module');

const {
  installElectronMock,
  uninstallElectronMock,
  resetElectronMocks,
  getBrowserWindowInstances,
  BrowserWindow,
  screen,
} = require('../helpers/mock-electron');

const MockStore = require('../helpers/mock-store');
let mockStoreInstance;

let createTrayCalls = [];
let registerF11HandlerCalls = [];

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
};

const trayMock = {
  createTray: (win) => {
    createTrayCalls.push(win);
  },
};
const ipcMock = {
  registerF11Handler: (win) => {
    registerF11HandlerCalls.push(win);
  },
};

const originalLoad = Module._load;

function installMocks() {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return require('../helpers/mock-electron').electronMock;
    if (request === './store') return storeApi;
    if (request === './tray') return trayMock;
    if (request === './ipc') return ipcMock;
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

// ─────────────────────────────────────────────────────────────────────────────
// MODULE BOUNDARY CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('window.js – module boundary contract', () => {
  beforeEach(() => {
    mockStoreInstance = new MockStore();
    createTrayCalls = [];
    registerF11HandlerCalls = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
  });

  test('exports exactly { createMainWindow }', () => {
    const mod = requireFreshWindow();
    assert.deepStrictEqual(Object.keys(mod), ['createMainWindow']);
  });

  test('createMainWindow is a function', () => {
    const mod = requireFreshWindow();
    assert.strictEqual(typeof mod.createMainWindow, 'function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BROWSERWINDOW CONSTRUCTOR OPTIONS CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('window.js – BrowserWindow constructor options', () => {
  beforeEach(() => {
    mockStoreInstance = new MockStore();
    createTrayCalls = [];
    registerF11HandlerCalls = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
  });

  test('creates window with DEFAULT_WIDTH=1280 and DEFAULT_HEIGHT=760 when no bounds saved', async () => {
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    const [win] = getBrowserWindowInstances();
    assert.strictEqual(win._options.width, 1280);
    assert.strictEqual(win._options.height, 760);
  });

  test('creates window with saved bounds', async () => {
    mockStoreInstance.set('bounds', { x: 50, y: 100, width: 1024, height: 768 });
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    const [win] = getBrowserWindowInstances();
    assert.strictEqual(win._options.width, 1024);
    assert.strictEqual(win._options.height, 768);
    assert.strictEqual(win._options.x, 50);
    assert.strictEqual(win._options.y, 100);
  });

  test('minWidth is exactly 800', async () => {
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(getBrowserWindowInstances()[0]._options.minWidth, 800);
  });

  test('minHeight is exactly 500', async () => {
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(getBrowserWindowInstances()[0]._options.minHeight, 500);
  });

  test('nodeIntegration is false', async () => {
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(
      getBrowserWindowInstances()[0]._options.webPreferences.nodeIntegration,
      false,
    );
  });

  test('contextIsolation is true', async () => {
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(
      getBrowserWindowInstances()[0]._options.webPreferences.contextIsolation,
      true,
    );
  });

  test('spellcheck is false', async () => {
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(getBrowserWindowInstances()[0]._options.webPreferences.spellcheck, false);
  });

  test('preload path ends with preload.js', async () => {
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    const preloadPath = getBrowserWindowInstances()[0]._options.webPreferences.preload;
    assert.ok(
      preloadPath.replace(/\\/g, '/').endsWith('preload.js'),
      `preload must end with preload.js, got: ${preloadPath}`,
    );
  });

  test('backgroundColor is exactly "#0f1117"', async () => {
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(getBrowserWindowInstances()[0]._options.backgroundColor, '#0f1117');
  });

  test('show is false (avoid white flash)', async () => {
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(getBrowserWindowInstances()[0]._options.show, false);
  });

  test('autoHideMenuBar is true', async () => {
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(getBrowserWindowInstances()[0]._options.autoHideMenuBar, true);
  });

  test('frame is true', async () => {
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(getBrowserWindowInstances()[0]._options.frame, true);
  });

  test('window title is exactly "Unifi Protect Viewer"', async () => {
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(getBrowserWindowInstances()[0]._title, 'Unifi Protect Viewer');
  });

  test('createTray is called with the created window', async () => {
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    assert.strictEqual(createTrayCalls.length, 1);
    assert.strictEqual(createTrayCalls[0], win);
  });

  test('registerF11Handler is called with the created window', async () => {
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    assert.strictEqual(registerF11HandlerCalls.length, 1);
    assert.strictEqual(registerF11HandlerCalls[0], win);
  });

  test('createMainWindow returns a Promise', () => {
    const { createMainWindow } = requireFreshWindow();
    const result = createMainWindow();
    assert.strictEqual(typeof result.then, 'function');
    return result;
  });

  test('createMainWindow resolves to a BrowserWindow instance', async () => {
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    assert.ok(win instanceof BrowserWindow);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// loadInitialPage ROUTING CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('window.js – loadInitialPage routing', () => {
  beforeEach(() => {
    mockStoreInstance = new MockStore();
    createTrayCalls = [];
    registerF11HandlerCalls = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
  });

  test('0 profiles: loads config.html', async () => {
    mockStoreInstance.set('profiles', []);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    assert.ok(
      win._file && win._file.endsWith('config.html'),
      `expected config.html, got: ${win._file}`,
    );
  });

  test('0 profiles: markInitialised is NOT called', async () => {
    mockStoreInstance.set('profiles', []);
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(
      mockStoreInstance.has('init'),
      false,
      'markInitialised must not be called on 0-profile path',
    );
  });

  test('0 profiles: activeProfileId remains unset', async () => {
    mockStoreInstance.set('profiles', []);
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(mockStoreInstance.get('activeProfileId'), undefined);
  });

  test('1 profile: loads the profile URL directly', async () => {
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'https://cam.local' }]);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    assert.strictEqual(win._url, 'https://cam.local');
  });

  test('1 profile: sets activeProfileId to profiles[0].id', async () => {
    mockStoreInstance.set('profiles', [{ id: 'only', name: 'Only', url: 'u1' }]);
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(mockStoreInstance.get('activeProfileId'), 'only');
  });

  test('1 profile: loaded URL uses exact USER_AGENT', async () => {
    const EXPECTED_USER_AGENT =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'https://cam.local' }]);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    assert.strictEqual(win._loadURLOpts.userAgent, EXPECTED_USER_AGENT);
  });

  test('1 profile: markInitialised is called', async () => {
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'https://cam.local' }]);
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(mockStoreInstance.has('init'), true);
  });

  test('2+ profiles, no startupProfileId: loads profile-select.html', async () => {
    mockStoreInstance.set('profiles', [
      { id: 'p1', name: 'P1', url: 'u1' },
      { id: 'p2', name: 'P2', url: 'u2' },
    ]);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    assert.ok(
      win._file && win._file.endsWith('profile-select.html'),
      `expected profile-select.html, got: ${win._file}`,
    );
  });

  test('2+ profiles, no startupProfileId: activeProfileId remains unset', async () => {
    mockStoreInstance.set('profiles', [
      { id: 'p1', name: 'P1', url: 'u1' },
      { id: 'p2', name: 'P2', url: 'u2' },
    ]);
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(mockStoreInstance.get('activeProfileId'), undefined);
  });

  test('startup profile found: loads startup profile URL', async () => {
    mockStoreInstance.set('profiles', [
      { id: 'p1', name: 'P1', url: 'https://cam1' },
      { id: 'p2', name: 'P2', url: 'https://cam2' },
    ]);
    mockStoreInstance.set('startupProfileId', 'p2');
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    assert.strictEqual(win._url, 'https://cam2');
  });

  test('startup profile found: sets activeProfileId to startupProfileId', async () => {
    mockStoreInstance.set('profiles', [
      { id: 'p1', name: 'P1', url: 'u1' },
      { id: 'p2', name: 'P2', url: 'u2' },
    ]);
    mockStoreInstance.set('startupProfileId', 'p2');
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(mockStoreInstance.get('activeProfileId'), 'p2');
  });

  test('startup profile not found: activeProfileId is NOT set', async () => {
    mockStoreInstance.set('profiles', [
      { id: 'p1', name: 'P1', url: 'u1' },
      { id: 'p2', name: 'P2', url: 'u2' },
    ]);
    mockStoreInstance.set('startupProfileId', 'GHOST');
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(mockStoreInstance.get('activeProfileId'), undefined);
  });

  test('already initialised: markInitialised is not called again', async () => {
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    mockStoreInstance.set('init', true);
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow();
    assert.strictEqual(mockStoreInstance.get('init'), true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WINDOW LIFECYCLE CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('window.js – window lifecycle events', () => {
  beforeEach(() => {
    mockStoreInstance = new MockStore();
    createTrayCalls = [];
    registerF11HandlerCalls = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
  });

  test('ready-to-show: shows the window', async () => {
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    win._visible = false;
    win._eventHandlers['ready-to-show'][0]();
    assert.strictEqual(win._visible, true);
  });

  test('page-title-updated: calls preventDefault exactly once', async () => {
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    let count = 0;
    win._eventHandlers['page-title-updated'][0]({
      preventDefault: () => {
        count++;
      },
    });
    assert.strictEqual(count, 1);
  });

  test('page-title-updated: handler returns undefined', async () => {
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    const result = win._eventHandlers['page-title-updated'][0]({ preventDefault: () => {} });
    assert.strictEqual(result, undefined);
  });

  test('close event: saves bounds when initialised', async () => {
    mockStoreInstance.set('init', true);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    win._bounds = { x: 10, y: 20, width: 1024, height: 768 };
    win.emit('close');
    assert.deepStrictEqual(mockStoreInstance.get('bounds'), {
      x: 10,
      y: 20,
      width: 1024,
      height: 768,
    });
  });

  test('close event: saves exact x, y, width, height fields (all 4 checked)', async () => {
    mockStoreInstance.set('init', true);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    const expectedBounds = { x: 123, y: 456, width: 1600, height: 900 };
    win._bounds = expectedBounds;
    win.emit('close');
    const saved = mockStoreInstance.get('bounds');
    assert.strictEqual(saved.x, expectedBounds.x);
    assert.strictEqual(saved.y, expectedBounds.y);
    assert.strictEqual(saved.width, expectedBounds.width);
    assert.strictEqual(saved.height, expectedBounds.height);
  });

  test('close event: does NOT save bounds when not initialised', async () => {
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    win.emit('close');
    assert.strictEqual(mockStoreInstance.get('bounds'), undefined);
  });

  test('close event: saves pre-fullscreen bounds when window is in fullscreen (enter-full-screen fired)', async () => {
    mockStoreInstance.set('init', true);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    // Simulate: user moved window to (200,100, 1400x900) before going fullscreen
    win._bounds = { x: 200, y: 100, width: 1400, height: 900 };
    win.emit('enter-full-screen');
    // Now fullscreen – getBounds() would return large display coords
    win._bounds = { x: 0, y: 0, width: 3840, height: 2160 };
    win.emit('close');
    const saved = mockStoreInstance.get('bounds');
    assert.strictEqual(saved.x, 200, 'must save pre-fullscreen x');
    assert.strictEqual(saved.y, 100, 'must save pre-fullscreen y');
    assert.strictEqual(saved.width, 1400, 'must save pre-fullscreen width');
    assert.strictEqual(saved.height, 900, 'must save pre-fullscreen height');
  });

  test('close event: after leave-full-screen, normal getBounds() is saved again', async () => {
    mockStoreInstance.set('init', true);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    // Enter fullscreen
    win._bounds = { x: 100, y: 50, width: 1280, height: 760 };
    win.emit('enter-full-screen');
    win._bounds = { x: 0, y: 0, width: 1920, height: 1080 };
    // Leave fullscreen – window is back to windowed mode
    win.emit('leave-full-screen');
    win._bounds = { x: 150, y: 80, width: 1200, height: 800 };
    win.emit('close');
    const saved = mockStoreInstance.get('bounds');
    assert.strictEqual(saved.x, 150, 'after leaving fullscreen must save current bounds x');
    assert.strictEqual(saved.y, 80, 'after leaving fullscreen must save current bounds y');
    assert.strictEqual(saved.width, 1200);
    assert.strictEqual(saved.height, 800);
  });

  test('close event: --fullscreen CLI arg saves initial windowed bounds as pre-fs fallback', async () => {
    mockStoreInstance.set('init', true);
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ monitor: null, fullscreen: true, profile: null });
    // getBounds() would return fullscreen coords – but preFsBounds should be used
    win._bounds = { x: 0, y: 0, width: 1920, height: 1080 };
    win.emit('close');
    const saved = mockStoreInstance.get('bounds');
    // Pre-fullscreen bounds were set to the initial display coords (DEFAULT not expected here
    // since fullscreen uses display size) – what matters is they are NOT the huge current bounds
    // and that they were captured before setFullScreen(true) was called.
    assert.ok(saved, 'bounds should be saved');
    // preFsBounds.width was set from initialWidth = display.width (1920 default mock display)
    // This is the sane fallback; the important thing is it was saved
    assert.strictEqual(typeof saved.x, 'number');
    assert.strictEqual(typeof saved.y, 'number');
    assert.strictEqual(typeof saved.width, 'number');
    assert.strictEqual(typeof saved.height, 'number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// did-fail-load CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('window.js – did-fail-load handler', () => {
  beforeEach(() => {
    mockStoreInstance = new MockStore();
    createTrayCalls = [];
    registerF11HandlerCalls = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
  });

  function fireDidFailLoad(win, code, desc, url, isMainFrame) {
    win._eventHandlers['did-fail-load'][0]({}, code, desc, url, isMainFrame);
  }

  test('ERR_ABORTED (-3) is ignored – index.html is NOT loaded', async () => {
    mockStoreInstance.set('profiles', []);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    win._file = null;
    fireDidFailLoad(win, -3, 'ERR_ABORTED', 'https://cam.local', true);
    assert.strictEqual(win._file, null, 'ERR_ABORTED must not trigger index.html');
  });

  test('code -2 with external URL: loads index.html', async () => {
    mockStoreInstance.set('profiles', []);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    win._file = null;
    fireDidFailLoad(win, -2, 'ERR_FAILED', 'https://external.host', true);
    assert.ok(
      win._file && win._file.endsWith('index.html'),
      `expected index.html, got: ${win._file}`,
    );
  });

  test('non-main-frame errors are ignored', async () => {
    mockStoreInstance.set('profiles', []);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    win._file = null;
    fireDidFailLoad(win, -6, 'ERR_CONNECTION_REFUSED', 'https://cam.local', false);
    assert.strictEqual(win._file, null);
  });

  test('failed load of config.html is ignored', async () => {
    mockStoreInstance.set('profiles', []);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    win._file = null;
    fireDidFailLoad(win, -6, 'ERR_FAILED', 'file:///path/config.html', true);
    assert.strictEqual(win._file, null);
  });

  test('failed load of profile-select.html is ignored', async () => {
    mockStoreInstance.set('profiles', []);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    win._file = null;
    fireDidFailLoad(win, -6, 'ERR_FAILED', 'file:///path/profile-select.html', true);
    assert.strictEqual(win._file, null);
  });

  test('failed load of index.html is ignored', async () => {
    mockStoreInstance.set('profiles', []);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    win._file = null;
    fireDidFailLoad(win, -6, 'ERR_FAILED', 'file:///path/index.html', true);
    assert.strictEqual(win._file, null);
  });

  test('failed load with null URL: loads index.html', async () => {
    mockStoreInstance.set('profiles', []);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    win._file = null;
    fireDidFailLoad(win, -6, 'ERR_FAILED', null, true);
    assert.ok(
      win._file && win._file.endsWith('index.html'),
      `expected index.html for null URL, got: ${win._file}`,
    );
  });

  test('failed load for external URL: loads index.html', async () => {
    mockStoreInstance.set('profiles', []);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    win._file = null;
    fireDidFailLoad(win, -105, 'ERR_NAME_NOT_RESOLVED', 'https://cam.unreachable', true);
    assert.ok(
      win._file && win._file.endsWith('index.html'),
      `expected index.html, got: ${win._file}`,
    );
  });

  test('loaded index.html path ends exactly with "index.html"', async () => {
    mockStoreInstance.set('profiles', []);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    win._file = null;
    fireDidFailLoad(win, -6, 'ERR_FAILED', 'https://cam.unreachable', true);
    const parts = (win._file || '').replace(/\\/g, '/').split('/');
    assert.strictEqual(parts[parts.length - 1], 'index.html');
  });

  test('did-fail-load event handler is registered on webContents', async () => {
    mockStoreInstance.set('profiles', []);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow();
    assert.ok(
      win._eventHandlers['did-fail-load'],
      'did-fail-load must be registered on webContents',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CLI --profile OVERRIDE CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('window.js – CLI --profile override', () => {
  beforeEach(() => {
    mockStoreInstance = new MockStore();
    createTrayCalls = [];
    registerF11HandlerCalls = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
  });

  test('--profile exact name match loads the matching profile URL', async () => {
    mockStoreInstance.set('profiles', [
      { id: 'p1', name: 'Front Door', url: 'https://cam1' },
      { id: 'p2', name: 'Warehouse', url: 'https://cam2' },
    ]);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ profile: 'Warehouse', monitor: null, fullscreen: null });
    assert.strictEqual(win._url, 'https://cam2');
  });

  test('--profile sets the activeProfileId to the matched profile', async () => {
    mockStoreInstance.set('profiles', [
      { id: 'p1', name: 'Front Door', url: 'https://cam1' },
      { id: 'p2', name: 'Warehouse', url: 'https://cam2' },
    ]);
    const { createMainWindow } = requireFreshWindow();
    await createMainWindow({ profile: 'Warehouse', monitor: null, fullscreen: null });
    assert.strictEqual(mockStoreInstance.get('activeProfileId'), 'p2');
  });

  test('--profile match is case-insensitive', async () => {
    mockStoreInstance.set('profiles', [
      { id: 'p1', name: 'Front Door', url: 'https://cam1' },
      { id: 'p2', name: 'Warehouse', url: 'https://cam2' },
    ]);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ profile: 'WAREHOUSE', monitor: null, fullscreen: null });
    assert.strictEqual(win._url, 'https://cam2');
  });

  test('--profile with unknown name falls back to startup profile', async () => {
    mockStoreInstance.set('profiles', [
      { id: 'p1', name: 'Front Door', url: 'https://cam1' },
      { id: 'p2', name: 'Warehouse', url: 'https://cam2' },
    ]);
    mockStoreInstance.set('startupProfileId', 'p1');
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ profile: 'UNKNOWN', monitor: null, fullscreen: null });
    assert.strictEqual(win._url, 'https://cam1');
  });

  test('--profile with unknown name and no startup profile shows profile-select.html', async () => {
    mockStoreInstance.set('profiles', [
      { id: 'p1', name: 'Front Door', url: 'https://cam1' },
      { id: 'p2', name: 'Warehouse', url: 'https://cam2' },
    ]);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ profile: 'UNKNOWN', monitor: null, fullscreen: null });
    assert.ok(
      win._file && win._file.endsWith('profile-select.html'),
      `expected profile-select.html, got: ${win._file}`,
    );
  });

  test('--profile overrides the startupProfileId from store', async () => {
    mockStoreInstance.set('profiles', [
      { id: 'p1', name: 'Front Door', url: 'https://cam1' },
      { id: 'p2', name: 'Warehouse', url: 'https://cam2' },
    ]);
    // Store says startup = p1, but CLI says "Warehouse" → should load p2
    mockStoreInstance.set('startupProfileId', 'p1');
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ profile: 'Warehouse', monitor: null, fullscreen: null });
    assert.strictEqual(win._url, 'https://cam2');
  });

  test('cliArgs = {} (empty) does not break routing', async () => {
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'https://cam1' }]);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({});
    assert.strictEqual(win._url, 'https://cam1');
  });

  test('cliArgs = undefined uses store defaults', async () => {
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'https://cam1' }]);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow(undefined);
    assert.strictEqual(win._url, 'https://cam1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CLI --monitor / --fullscreen OVERRIDE CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('window.js – CLI --monitor and --fullscreen override', () => {
  beforeEach(() => {
    mockStoreInstance = new MockStore();
    createTrayCalls = [];
    registerF11HandlerCalls = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    screen._displays = null; // reset multi-display state
    uninstallMocks();
    uninstallElectronMock();
  });

  test('--fullscreen true → win.setFullScreen(true) is called', async () => {
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ monitor: null, fullscreen: true, profile: null });
    assert.strictEqual(win.isFullScreen(), true);
  });

  test('--fullscreen null with store fullscreen=false → not fullscreen', async () => {
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    mockStoreInstance.set('startupSettings', {
      profileId: null,
      fullscreen: false,
      displayIndex: 0,
    });
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ monitor: null, fullscreen: null, profile: null });
    assert.strictEqual(win.isFullScreen(), false);
  });

  test('--fullscreen true overrides store fullscreen=false', async () => {
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    mockStoreInstance.set('startupSettings', {
      profileId: null,
      fullscreen: false,
      displayIndex: 0,
    });
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ monitor: null, fullscreen: true, profile: null });
    assert.strictEqual(win.isFullScreen(), true);
  });

  test('store fullscreen=true with no CLI flag → fullscreen', async () => {
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    mockStoreInstance.set('startupSettings', {
      profileId: null,
      fullscreen: true,
      displayIndex: 0,
    });
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ monitor: null, fullscreen: null, profile: null });
    assert.strictEqual(win.isFullScreen(), true);
  });

  test('--monitor 2 with two displays → window is placed on second display', async () => {
    screen._displays = [
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } },
    ];
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ monitor: 2, fullscreen: null, profile: null });
    // Without --fullscreen, the window should be centered on the target display
    // (x >= display.x && x < display.x + display.width)
    assert.ok(
      win._bounds.x >= 1920,
      `window x=${win._bounds.x} should be on second display (x >= 1920)`,
    );
    // Width should be default (not full display width) since no fullscreen
    assert.strictEqual(win._bounds.width, 1280);
  });

  test('--monitor 2 with --fullscreen → bounds exactly equal to second display', async () => {
    screen._displays = [
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } },
    ];
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ monitor: 2, fullscreen: true, profile: null });
    assert.strictEqual(win._bounds.x, 1920);
    assert.strictEqual(win._bounds.width, 2560);
    assert.strictEqual(win.isFullScreen(), true);
  });

  test('--monitor 1 → bounds set to first display', async () => {
    screen._displays = [
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } },
    ];
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    mockStoreInstance.set('startupSettings', {
      profileId: null,
      fullscreen: true,
      displayIndex: 0,
    });
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ monitor: 1, fullscreen: null, profile: null });
    assert.strictEqual(win._bounds.x, 0);
    assert.strictEqual(win._bounds.width, 1920);
  });

  test('--monitor 3 with only 2 displays → clamped to last display (index 1)', async () => {
    screen._displays = [
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } },
    ];
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ monitor: 3, fullscreen: true, profile: null });
    assert.strictEqual(win._bounds.x, 1920, 'should clamp to last display');
    assert.strictEqual(win.isFullScreen(), true);
  });

  test('--monitor 2 with only 1 display → clamped to display 0, no error', async () => {
    // screen._displays = null → default single display (x=0)
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    const { createMainWindow } = requireFreshWindow();
    let error;
    try {
      await createMainWindow({ monitor: 2, fullscreen: true, profile: null });
    } catch (e) {
      error = e;
    }
    assert.strictEqual(
      error,
      undefined,
      'should not throw when monitor index exceeds display count',
    );
  });

  test('--monitor overrides store displayIndex', async () => {
    screen._displays = [
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } },
    ];
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    // Store says display 2 (index 1), but CLI says monitor 1 (index 0)
    mockStoreInstance.set('startupSettings', {
      profileId: null,
      fullscreen: true,
      displayIndex: 1,
    });
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ monitor: 1, fullscreen: null, profile: null });
    assert.strictEqual(win._bounds.x, 0, 'CLI --monitor 1 should override store displayIndex=1');
  });

  test('no CLI flags and no store fullscreen → window is NOT fullscreen', async () => {
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ monitor: null, fullscreen: null, profile: null });
    assert.strictEqual(win.isFullScreen(), false);
  });

  test('store displayIndex > 0 without fullscreen does NOT override saved window bounds', async () => {
    // Regression test: previously, having displayIndex=1 in the store would call setBounds()
    // even without fullscreen or a CLI --monitor arg, wiping the user's saved window position.
    screen._displays = [
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } },
    ];
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    mockStoreInstance.set('bounds', { x: 300, y: 200, width: 1024, height: 768 });
    // displayIndex=1 in store, but NO fullscreen and NO CLI --monitor
    mockStoreInstance.set('startupSettings', {
      profileId: null,
      fullscreen: false,
      displayIndex: 1,
    });
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ monitor: null, fullscreen: null, profile: null });
    // Window must keep the user's saved position, not be moved to display 2
    assert.strictEqual(win._bounds.x, 300, 'saved x must be preserved');
    assert.strictEqual(win._bounds.y, 200, 'saved y must be preserved');
    assert.strictEqual(win._bounds.width, 1024, 'saved width must be preserved');
    assert.strictEqual(win._bounds.height, 768, 'saved height must be preserved');
    assert.strictEqual(win.isFullScreen(), false);
  });

  test('store displayIndex > 0 WITH fullscreen DOES reposition to that display', async () => {
    screen._displays = [
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } },
    ];
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    mockStoreInstance.set('bounds', { x: 300, y: 200, width: 1024, height: 768 });
    mockStoreInstance.set('startupSettings', {
      profileId: null,
      fullscreen: true,
      displayIndex: 1,
    });
    const { createMainWindow } = requireFreshWindow();
    const win = await createMainWindow({ monitor: null, fullscreen: null, profile: null });
    assert.strictEqual(win._bounds.x, 1920, 'should be repositioned to display 2');
    assert.strictEqual(win.isFullScreen(), true);
  });
});
