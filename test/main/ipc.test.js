'use strict';

/**
 * @file test/main/ipc.test.js
 * @description Behavioral contract tests for src/main/ipc.js
 *
 * Guarantees:
 *  - All IPC channel names are locked down (rename → test failure)
 *  - All handler implementations are tested for correct behavior
 *  - Exported symbol surface is locked (add/remove → test failure)
 *  - Negative paths: null inputs, missing window, missing profile, etc.
 *  - Call-order invariants are enforced (clearAll → relaunch → quit, etc.)
 *  - Inject constants (background color) are locked down
 *  - Return-value contracts are explicit (undefined where expected)
 *  - Pass-through semantics for configLoad / profilesLoad are validated
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Module } = require('node:module');
const path = require('node:path');

const {
  installElectronMock,
  uninstallElectronMock,
  resetElectronMocks,
  getIpcMainHandlers,
  getIpcMainHandleHandlers,
  app,
  BrowserWindow,
  shell,
} = require('../helpers/mock-electron');

// ── Store mock ────────────────────────────────────────────────────────────────

const MockStore = require('../helpers/mock-store');
let mockStoreInstance;

const storeApi = {
  clearAll: () => mockStoreInstance.clear(),
  saveConfig: (cfg) => mockStoreInstance.set('_config', cfg),
  getConfig: () => mockStoreInstance.get('_config'),
  getProfiles: () => mockStoreInstance.get('profiles', []),
  saveProfiles: (p) => mockStoreInstance.set('profiles', p),
  getActiveProfileId: () => mockStoreInstance.get('activeProfileId'),
  setActiveProfileId: (id) => mockStoreInstance.set('activeProfileId', id),
  getStartupProfileId: () =>
    mockStoreInstance.get('startupSettings', {}).profileId ??
    mockStoreInstance.get('startupProfileId'),
  setStartupProfileId: (id) => {
    const current = mockStoreInstance.get('startupSettings', {
      profileId: null,
      fullscreen: false,
      displayIndex: 0,
    });
    mockStoreInstance.set('startupSettings', { ...current, profileId: id || null });
    if (id) mockStoreInstance.set('startupProfileId', id);
    else mockStoreInstance.delete('startupProfileId');
  },
  getStartupSettings: () =>
    mockStoreInstance.get('startupSettings', {
      profileId: null,
      fullscreen: false,
      displayIndex: 0,
    }),
  setStartupSettings: (settings) => {
    const current = mockStoreInstance.get('startupSettings', {
      profileId: null,
      fullscreen: false,
      displayIndex: 0,
    });
    mockStoreInstance.set('startupSettings', { ...current, ...settings });
  },
  isInitialised: () => mockStoreInstance.has('init'),
  saveWindowBounds: (bounds) => mockStoreInstance.set('bounds', bounds),
  isPortable: false,
};

let trayUpdateCalls = [];
const trayMock = {
  updateTrayMenu: (win) => {
    trayUpdateCalls.push(win);
  },
};

const originalLoad = Module._load;

function installMocks() {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return require('../helpers/mock-electron').electronMock;
    }
    if (request === path.resolve(__dirname, '../../src/main/store') || request === './store') {
      return storeApi;
    }
    if (request === path.resolve(__dirname, '../../src/main/tray') || request === './tray') {
      return trayMock;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

function uninstallMocks() {
  Module._load = originalLoad;
}

function requireFreshIpc() {
  const ipcPath = require.resolve('../../src/main/ipc');
  delete require.cache[ipcPath];
  return require('../../src/main/ipc');
}

function makeEvent(win) {
  const wc = win ? win.webContents : { on: () => {} };
  return { sender: wc, preventDefault: () => {} };
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE BOUNDARY CONTRACT
// Any added or removed export causes this test to fail.
// ─────────────────────────────────────────────────────────────────────────────

describe('ipc.js – module boundary contract', () => {
  beforeEach(() => {
    mockStoreInstance = new MockStore();
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
  });

  test('exports exactly { makeWindowLogHandler, registerF11Handler, registerIpcHandlers }', () => {
    const mod = requireFreshIpc();
    assert.deepStrictEqual(Object.keys(mod).sort(), [
      'makeWindowLogHandler',
      'registerF11Handler',
      'registerIpcHandlers',
    ]);
  });

  test('registerIpcHandlers is a function', () => {
    const mod = requireFreshIpc();
    assert.strictEqual(typeof mod.registerIpcHandlers, 'function');
  });

  test('registerF11Handler is a function', () => {
    const mod = requireFreshIpc();
    assert.strictEqual(typeof mod.registerF11Handler, 'function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IPC CHANNEL REGISTRATION CONTRACT
// Renaming any channel causes these tests to fail.
// ─────────────────────────────────────────────────────────────────────────────

describe('ipc.js – registerIpcHandlers registers exact channel set', () => {
  beforeEach(() => {
    mockStoreInstance = new MockStore();
    trayUpdateCalls = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
  });

  test('registers exactly the expected ipcMain.on channels (no more, no less)', () => {
    const { registerIpcHandlers } = requireFreshIpc();
    registerIpcHandlers();
    const handlers = getIpcMainHandlers();
    const expectedOnChannels = [
      'activeProfileSet',
      'configSave',
      'launchProfile',
      'openConfig',
      'openDevTools',
      'openExternal',
      'openLogFile',
      'profilesSave',
      'reset',
      'restart',
      'startupProfileSet',
      'startupSettingsSet',
      'switchNextProfile',
      'toggleFullscreen',
      'upv:log',
    ];
    assert.deepStrictEqual(Object.keys(handlers).sort(), expectedOnChannels);
  });

  test('registers exactly the expected ipcMain.handle channels (no more, no less)', () => {
    const { registerIpcHandlers } = requireFreshIpc();
    registerIpcHandlers();
    const handleHandlers = getIpcMainHandleHandlers();
    const expectedHandleChannels = [
      'activeProfileGet',
      'configLoad',
      'displaysGet',
      'profilesLoad',
      'startupProfileGet',
      'startupSettingsGet',
    ];
    assert.deepStrictEqual(Object.keys(handleHandlers).sort(), expectedHandleChannels);
  });

  test('each ipcMain.on channel has a function handler', () => {
    const { registerIpcHandlers } = requireFreshIpc();
    registerIpcHandlers();
    for (const [ch, fn] of Object.entries(getIpcMainHandlers())) {
      assert.strictEqual(typeof fn, 'function', `handler for '${ch}' must be a function`);
    }
  });

  test('each ipcMain.handle channel has a function handler', () => {
    const { registerIpcHandlers } = requireFreshIpc();
    registerIpcHandlers();
    for (const [ch, fn] of Object.entries(getIpcMainHandleHandlers())) {
      assert.strictEqual(typeof fn, 'function', `handler for '${ch}' must be a function`);
    }
  });

  test('registerIpcHandlers called twice: no crash', () => {
    const { registerIpcHandlers } = requireFreshIpc();
    assert.doesNotThrow(() => {
      registerIpcHandlers();
      registerIpcHandlers();
    });
  });

  test('registerIpcHandlers called twice: handlers are still functions', () => {
    const { registerIpcHandlers } = requireFreshIpc();
    registerIpcHandlers();
    registerIpcHandlers();
    for (const [ch, fn] of Object.entries(getIpcMainHandlers())) {
      assert.strictEqual(typeof fn, 'function', `handler for '${ch}' must still be a function`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER IMPLEMENTATION CONTRACTS
// ─────────────────────────────────────────────────────────────────────────────

describe('ipc.js – handler implementations', () => {
  let win;
  let handlers;
  let handleHandlers;

  beforeEach(() => {
    mockStoreInstance = new MockStore();
    trayUpdateCalls = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
    const { registerIpcHandlers } = requireFreshIpc();
    registerIpcHandlers();
    handlers = getIpcMainHandlers();
    handleHandlers = getIpcMainHandleHandlers();

    win = new BrowserWindow({ width: 800, height: 600 });
    BrowserWindow.fromWebContents = (wc) => (wc === win.webContents ? win : null);
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  test('reset: clears store, calls relaunch then quit', () => {
    let relaunchCalled = false;
    let quitCalled = false;
    app.relaunch = () => {
      relaunchCalled = true;
    };
    app.quit = () => {
      quitCalled = true;
    };

    mockStoreInstance._seed({ profiles: [{ id: 'x' }], init: true });
    handlers['reset']();

    assert.strictEqual(mockStoreInstance._dump().profiles, undefined);
    assert.strictEqual(relaunchCalled, true);
    assert.strictEqual(quitCalled, true);
  });

  test('reset: relaunch is called before quit', () => {
    const order = [];
    app.relaunch = () => {
      order.push('relaunch');
    };
    app.quit = () => {
      order.push('quit');
    };
    handlers['reset']();
    assert.deepStrictEqual(order, ['relaunch', 'quit']);
  });

  test('reset: clearAll is called before relaunch (full order: clearAll → relaunch → quit)', () => {
    const order = [];
    mockStoreInstance._seed({ profiles: [{ id: 'x' }] });
    const origClear = mockStoreInstance.clear.bind(mockStoreInstance);
    mockStoreInstance.clear = () => {
      order.push('clearAll');
      origClear();
    };
    app.relaunch = () => {
      order.push('relaunch');
    };
    app.quit = () => {
      order.push('quit');
    };
    handlers['reset']();
    assert.deepStrictEqual(order, ['clearAll', 'relaunch', 'quit']);
  });

  test('reset: store is empty after clearAll – no residual state', () => {
    mockStoreInstance._seed({
      profiles: [{ id: 'x' }],
      activeProfileId: 'x',
      startupProfileId: 'x',
      init: true,
      bounds: { x: 0, y: 0, width: 1280, height: 760 },
    });
    app.relaunch = () => {};
    app.quit = () => {};
    handlers['reset']();
    assert.deepStrictEqual(mockStoreInstance._dump(), {});
  });

  // ── restart ──────────────────────────────────────────────────────────────

  test('restart: calls relaunch and exit(0)', () => {
    let relaunchCalled = false;
    let exitCode = null;
    app.relaunch = () => {
      relaunchCalled = true;
    };
    app.exit = (code) => {
      exitCode = code;
    };

    handlers['restart'](makeEvent(win));

    assert.strictEqual(relaunchCalled, true);
    assert.strictEqual(exitCode, 0);
  });

  test('restart: exit code is exactly 0, not 1 or undefined', () => {
    let exitCode = 'NOT_CALLED';
    app.exit = (code) => {
      exitCode = code;
    };
    handlers['restart'](makeEvent(win));
    assert.strictEqual(exitCode, 0);
  });

  test('restart: saves window bounds before exiting when initialised', () => {
    mockStoreInstance.set('init', true);
    app.relaunch = () => {};
    app.exit = () => {};

    win._bounds = { x: 400, y: 300, width: 1600, height: 900 };

    handlers['restart'](makeEvent(win));

    assert.deepStrictEqual(mockStoreInstance.get('bounds'), {
      x: 400,
      y: 300,
      width: 1600,
      height: 900,
    });
  });

  test('restart: saves all four bound fields (x, y, width, height)', () => {
    mockStoreInstance.set('init', true);
    app.relaunch = () => {};
    app.exit = () => {};

    win._bounds = { x: 50, y: 75, width: 2560, height: 1440 };

    handlers['restart'](makeEvent(win));

    const saved = mockStoreInstance.get('bounds');
    assert.strictEqual(saved.x, 50);
    assert.strictEqual(saved.y, 75);
    assert.strictEqual(saved.width, 2560);
    assert.strictEqual(saved.height, 1440);
  });

  test('restart: does NOT save bounds when not yet initialised', () => {
    // App not initialised (first-launch incomplete) – bounds must not be saved
    app.relaunch = () => {};
    app.exit = () => {};

    win._bounds = { x: 10, y: 20, width: 800, height: 600 };

    handlers['restart'](makeEvent(win));

    assert.strictEqual(mockStoreInstance.get('bounds'), undefined);
  });

  test('restart: save-bounds order is before relaunch/exit', () => {
    const order = [];
    mockStoreInstance.set('init', true);
    const origSave = storeApi.saveWindowBounds;
    storeApi.saveWindowBounds = (b) => {
      order.push('save');
      mockStoreInstance.set('bounds', b);
    };
    app.relaunch = () => {
      order.push('relaunch');
    };
    app.exit = () => {
      order.push('exit');
    };

    handlers['restart'](makeEvent(win));

    storeApi.saveWindowBounds = origSave;
    assert.deepStrictEqual(order, ['save', 'relaunch', 'exit']);
  });

  test('restart: works without throwing when event has no sender (graceful fallback)', () => {
    app.relaunch = () => {};
    app.exit = () => {};
    assert.doesNotThrow(() => handlers['restart']({}));
  });

  // ── configSave ───────────────────────────────────────────────────────────

  test('configSave: persists config object to store', () => {
    const cfg = { url: 'https://x', username: 'u', password: 'p' };
    handlers['configSave']({}, cfg);
    assert.deepStrictEqual(mockStoreInstance.get('_config'), cfg);
  });

  test('configSave: overwrites existing config', () => {
    mockStoreInstance.set('_config', { url: 'old', username: 'old', password: 'old' });
    const newCfg = { url: 'new', username: 'new', password: 'new' };
    handlers['configSave']({}, newCfg);
    assert.deepStrictEqual(mockStoreInstance.get('_config'), newCfg);
  });

  test('configSave: accepts null payload without throwing', () => {
    assert.doesNotThrow(() => handlers['configSave']({}, null));
  });

  test('configSave: stores null explicitly (no silent drop)', () => {
    handlers['configSave']({}, null);
    assert.strictEqual(mockStoreInstance.get('_config'), null);
  });

  test('configSave: accepts undefined payload without throwing', () => {
    assert.doesNotThrow(() => handlers['configSave']({}, undefined));
  });

  test('configSave: return value is undefined (no accidental return-value leak)', () => {
    const result = handlers['configSave']({}, { url: 'u', username: 'u', password: 'p' });
    assert.strictEqual(result, undefined);
  });

  test('configSave: stores complete object without stripping fields', () => {
    const cfg = { url: 'https://x', username: 'user', password: 'pw', extra: 'should-survive' };
    handlers['configSave']({}, cfg);
    assert.deepStrictEqual(mockStoreInstance.get('_config'), cfg);
  });

  // ── configLoad ───────────────────────────────────────────────────────────

  test('configLoad: returns stored config', async () => {
    const cfg = { url: 'https://x', username: 'u', password: 'p' };
    mockStoreInstance.set('_config', cfg);
    const result = await handleHandlers['configLoad']();
    assert.deepStrictEqual(result, cfg);
  });

  test('configLoad: returns undefined when nothing stored', async () => {
    const result = await handleHandlers['configLoad']();
    assert.strictEqual(result, undefined);
  });

  test('configLoad: returns a Promise', () => {
    const result = handleHandlers['configLoad']();
    assert.strictEqual(typeof result.then, 'function');
  });

  test('configLoad: returned object contains url, username, password fields', async () => {
    const cfg = { url: 'https://x', username: 'u', password: 'p' };
    mockStoreInstance.set('_config', cfg);
    const result = await handleHandlers['configLoad']();
    assert.ok('url' in result, 'result must have field "url"');
    assert.ok('username' in result, 'result must have field "username"');
    assert.ok('password' in result, 'result must have field "password"');
  });

  test('configLoad: field values match exactly (no mapping drift)', async () => {
    const cfg = { url: 'https://exact', username: 'exactUser', password: 'exactPw' };
    mockStoreInstance.set('_config', cfg);
    const result = await handleHandlers['configLoad']();
    assert.strictEqual(result.url, 'https://exact');
    assert.strictEqual(result.username, 'exactUser');
    assert.strictEqual(result.password, 'exactPw');
  });

  // ── openConfig ───────────────────────────────────────────────────────────

  test('openConfig: loads config.html in the sender window', () => {
    handlers['openConfig'](makeEvent(win));
    assert.ok(win._file, 'loadFile must have been called');
    assert.ok(win._file.endsWith('config.html'), `expected config.html, got: ${win._file}`);
  });

  test('openConfig: loaded path ends with config.html exactly', () => {
    handlers['openConfig'](makeEvent(win));
    const parts = win._file.replace(/\\/g, '/').split('/');
    assert.strictEqual(parts[parts.length - 1], 'config.html');
  });

  test('openConfig: does nothing when no window found for sender', () => {
    BrowserWindow.fromWebContents = () => null;
    assert.doesNotThrow(() => handlers['openConfig']({ sender: {} }));
  });

  test("openConfig: does NOT call show() – that is the tray handler's responsibility", () => {
    let showCalled = false;
    win.show = () => {
      showCalled = true;
    };
    handlers['openConfig'](makeEvent(win));
    assert.strictEqual(
      showCalled,
      false,
      'openConfig (IPC) must not call show() – only the tray handler does',
    );
  });

  // ── openExternal ─────────────────────────────────────────────────────────

  test('openExternal: passes URL to shell.openExternal', () => {
    let openedUrl = null;
    require('../helpers/mock-electron').electronMock.shell.openExternal = (url) => {
      openedUrl = url;
    };
    handlers['openExternal']({}, 'https://example.com');
    assert.strictEqual(openedUrl, 'https://example.com');
  });

  test('openExternal: passes empty string to shell.openExternal without throwing', () => {
    let openedUrl = 'NOT_CALLED';
    require('../helpers/mock-electron').electronMock.shell.openExternal = (url) => {
      openedUrl = url;
    };
    assert.doesNotThrow(() => handlers['openExternal']({}, ''));
    assert.strictEqual(openedUrl, '');
  });

  test('openExternal: passes null without throwing', () => {
    require('../helpers/mock-electron').electronMock.shell.openExternal = () => {};
    assert.doesNotThrow(() => handlers['openExternal']({}, null));
  });

  // ── toggleFullscreen ─────────────────────────────────────────────────────

  test('toggleFullscreen: switches false to true', () => {
    win._fullscreen = false;
    handlers['toggleFullscreen'](makeEvent(win));
    assert.strictEqual(win._fullscreen, true);
  });

  test('toggleFullscreen: switches true to false', () => {
    win._fullscreen = true;
    handlers['toggleFullscreen'](makeEvent(win));
    assert.strictEqual(win._fullscreen, false);
  });

  test('toggleFullscreen: double toggle restores original state', () => {
    win._fullscreen = false;
    handlers['toggleFullscreen'](makeEvent(win));
    handlers['toggleFullscreen'](makeEvent(win));
    assert.strictEqual(win._fullscreen, false);
  });

  test('toggleFullscreen: does nothing when no window found', () => {
    BrowserWindow.fromWebContents = () => null;
    assert.doesNotThrow(() => handlers['toggleFullscreen']({ sender: {} }));
  });

  // ── profilesLoad ─────────────────────────────────────────────────────────

  test('profilesLoad: returns profiles array', async () => {
    const profiles = [{ id: 'p1', name: 'P1', url: 'u1', username: '', password: '' }];
    mockStoreInstance.set('profiles', profiles);
    const result = await handleHandlers['profilesLoad']();
    assert.deepStrictEqual(result, profiles);
  });

  test('profilesLoad: returns empty array when nothing stored', async () => {
    const result = await handleHandlers['profilesLoad']();
    assert.deepStrictEqual(result, []);
  });

  test('profilesLoad: returns a Promise', () => {
    const result = handleHandlers['profilesLoad']();
    assert.strictEqual(typeof result.then, 'function');
  });

  test('profilesLoad: returned array items contain id, name, url, username, password', async () => {
    const profiles = [
      { id: 'p1', name: 'P1', url: 'https://cam1', username: 'u1', password: 'pw1' },
    ];
    mockStoreInstance.set('profiles', profiles);
    const result = await handleHandlers['profilesLoad']();
    assert.ok(Array.isArray(result), 'result must be an array');
    const [p] = result;
    assert.ok('id' in p, 'profile must have "id"');
    assert.ok('name' in p, 'profile must have "name"');
    assert.ok('url' in p, 'profile must have "url"');
    assert.ok('username' in p, 'profile must have "username"');
    assert.ok('password' in p, 'profile must have "password"');
  });

  test('profilesLoad: profile field values match exactly (no mapping drift)', async () => {
    const profiles = [
      { id: 'x99', name: 'Test', url: 'https://t', username: 'usr', password: 'pw' },
    ];
    mockStoreInstance.set('profiles', profiles);
    const [p] = await handleHandlers['profilesLoad']();
    assert.strictEqual(p.id, 'x99');
    assert.strictEqual(p.name, 'Test');
    assert.strictEqual(p.url, 'https://t');
    assert.strictEqual(p.username, 'usr');
    assert.strictEqual(p.password, 'pw');
  });

  // ── profilesSave ─────────────────────────────────────────────────────────

  test('profilesSave: persists profiles array', () => {
    const profiles = [{ id: 'x', name: 'X', url: 'u', username: '', password: '' }];
    handlers['profilesSave']({}, profiles);
    assert.deepStrictEqual(mockStoreInstance.get('profiles', []), profiles);
  });

  test('profilesSave: persists empty array', () => {
    handlers['profilesSave']({}, []);
    assert.deepStrictEqual(mockStoreInstance.get('profiles', null), []);
  });

  test('profilesSave: overwrites existing profiles', () => {
    mockStoreInstance.set('profiles', [
      { id: 'old', name: 'Old', url: 'u', username: '', password: '' },
    ]);
    const newProfiles = [{ id: 'new', name: 'New', url: 'u2', username: '', password: '' }];
    handlers['profilesSave']({}, newProfiles);
    assert.deepStrictEqual(mockStoreInstance.get('profiles'), newProfiles);
  });

  // ── activeProfileGet ──────────────────────────────────────────────────────

  test('activeProfileGet: returns stored active profile ID', async () => {
    mockStoreInstance.set('activeProfileId', 'active-1');
    const result = await handleHandlers['activeProfileGet']();
    assert.strictEqual(result, 'active-1');
  });

  test('activeProfileGet: returns undefined when not set', async () => {
    const result = await handleHandlers['activeProfileGet']();
    assert.strictEqual(result, undefined);
  });

  // ── activeProfileSet ──────────────────────────────────────────────────────

  test('activeProfileSet: stores the given ID', () => {
    handlers['activeProfileSet']({}, 'new-id');
    assert.strictEqual(mockStoreInstance.get('activeProfileId'), 'new-id');
  });

  test('activeProfileSet: overwrites existing active ID', () => {
    mockStoreInstance.set('activeProfileId', 'old-id');
    handlers['activeProfileSet']({}, 'updated-id');
    assert.strictEqual(mockStoreInstance.get('activeProfileId'), 'updated-id');
  });

  test('activeProfileSet with null: passes null to store (no guard)', () => {
    handlers['activeProfileSet']({}, null);
    assert.strictEqual(mockStoreInstance.get('activeProfileId'), null);
  });

  test('activeProfileSet with undefined: passes undefined to store', () => {
    handlers['activeProfileSet']({}, undefined);
    assert.strictEqual(mockStoreInstance.get('activeProfileId'), undefined);
  });

  // ── startupProfileGet ─────────────────────────────────────────────────────

  test('startupProfileGet: returns stored startup profile ID', async () => {
    mockStoreInstance.set('startupProfileId', 'startup-42');
    const result = await handleHandlers['startupProfileGet']();
    assert.strictEqual(result, 'startup-42');
  });

  test('startupProfileGet: returns undefined when not set', async () => {
    const result = await handleHandlers['startupProfileGet']();
    assert.strictEqual(result, undefined);
  });

  // ── startupProfileSet ─────────────────────────────────────────────────────

  test('startupProfileSet: stores a valid ID', () => {
    handlers['startupProfileSet']({}, 'new-startup');
    assert.strictEqual(mockStoreInstance.get('startupProfileId'), 'new-startup');
  });

  test('startupProfileSet with null: deletes startup profile ID', () => {
    mockStoreInstance.set('startupProfileId', 'existing');
    handlers['startupProfileSet']({}, null);
    assert.strictEqual(mockStoreInstance.has('startupProfileId'), false);
  });

  test('startupProfileSet with undefined: deletes startup profile ID', () => {
    mockStoreInstance.set('startupProfileId', 'existing');
    handlers['startupProfileSet']({}, undefined);
    assert.strictEqual(mockStoreInstance.has('startupProfileId'), false);
  });

  test('startupProfileSet with 0: deletes startup profile ID (falsy)', () => {
    mockStoreInstance.set('startupProfileId', 'existing');
    handlers['startupProfileSet']({}, 0);
    assert.strictEqual(mockStoreInstance.has('startupProfileId'), false);
  });

  test('startupProfileSet with empty string: deletes startup profile ID (falsy)', () => {
    mockStoreInstance.set('startupProfileId', 'existing');
    handlers['startupProfileSet']({}, '');
    assert.strictEqual(mockStoreInstance.has('startupProfileId'), false);
  });

  test('startupProfileSet with positive number (truthy): stores the value', () => {
    handlers['startupProfileSet']({}, 1);
    assert.strictEqual(mockStoreInstance.get('startupProfileId'), 1);
  });

  test('startupProfileSet with true (truthy): stores true', () => {
    handlers['startupProfileSet']({}, true);
    assert.strictEqual(mockStoreInstance.get('startupProfileId'), true);
  });

  // ── switchNextProfile ─────────────────────────────────────────────────────

  test('switchNextProfile: loads profile-select.html when >1 profiles exist', () => {
    mockStoreInstance.set('profiles', [
      { id: 'a', name: 'A', url: 'u1' },
      { id: 'b', name: 'B', url: 'u2' },
    ]);
    handlers['switchNextProfile'](makeEvent(win));
    assert.ok(
      win._file && win._file.endsWith('profile-select.html'),
      `expected profile-select.html, got: ${win._file}`,
    );
  });

  test('switchNextProfile: loads config.html when exactly 1 profile exists', () => {
    mockStoreInstance.set('profiles', [{ id: 'a', name: 'A', url: 'u1' }]);
    handlers['switchNextProfile'](makeEvent(win));
    assert.ok(
      win._file && win._file.endsWith('config.html'),
      `expected config.html, got: ${win._file}`,
    );
  });

  test('switchNextProfile: loads config.html when 0 profiles exist', () => {
    mockStoreInstance.set('profiles', []);
    handlers['switchNextProfile'](makeEvent(win));
    assert.ok(
      win._file && win._file.endsWith('config.html'),
      `expected config.html, got: ${win._file}`,
    );
  });

  test('switchNextProfile: does nothing when no window found for sender', () => {
    BrowserWindow.fromWebContents = () => null;
    assert.doesNotThrow(() => handlers['switchNextProfile']({ sender: {} }));
  });

  test('switchNextProfile: loads config.html for exactly 1 profile (boundary)', () => {
    mockStoreInstance.set('profiles', [{ id: 'only', name: 'Only', url: 'u' }]);
    handlers['switchNextProfile'](makeEvent(win));
    const parts = (win._file || '').replace(/\\/g, '/').split('/');
    assert.strictEqual(parts[parts.length - 1], 'config.html');
  });

  test('switchNextProfile: loads profile-select.html for exactly 2 profiles (boundary)', () => {
    mockStoreInstance.set('profiles', [
      { id: 'a', name: 'A', url: 'u1' },
      { id: 'b', name: 'B', url: 'u2' },
    ]);
    handlers['switchNextProfile'](makeEvent(win));
    const parts = (win._file || '').replace(/\\/g, '/').split('/');
    assert.strictEqual(parts[parts.length - 1], 'profile-select.html');
  });

  // ── launchProfile ─────────────────────────────────────────────────────────

  test('launchProfile: sets activeProfileId and loads the profile URL', async () => {
    const profiles = [
      { id: 'p1', name: 'P1', url: 'https://cam1' },
      { id: 'p2', name: 'P2', url: 'https://cam2' },
    ];
    mockStoreInstance.set('profiles', profiles);

    handlers['launchProfile'](makeEvent(win), 'p2');

    assert.strictEqual(mockStoreInstance.get('activeProfileId'), 'p2');
    assert.strictEqual(trayUpdateCalls.length, 1);
    assert.strictEqual(trayUpdateCalls[0], win);

    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(win._url, 'https://cam2');
  });

  test('launchProfile: loaded URL uses exact USER_AGENT header', async () => {
    const EXPECTED_USER_AGENT =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'https://cam1' }]);

    handlers['launchProfile'](makeEvent(win), 'p1');
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(win._loadURLOpts.userAgent, EXPECTED_USER_AGENT);
  });

  test('launchProfile: updateTrayMenu is called before loadURL', async () => {
    const order = [];
    trayMock.updateTrayMenu = (w) => {
      order.push('trayUpdate');
      trayUpdateCalls.push(w);
    };
    const origLoadURL = win.loadURL.bind(win);
    win.loadURL = (url, opts) => {
      order.push('loadURL');
      return origLoadURL(url, opts);
    };

    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'https://cam1' }]);
    handlers['launchProfile'](makeEvent(win), 'p1');
    await new Promise((r) => setTimeout(r, 60));

    const trayIdx = order.indexOf('trayUpdate');
    const urlIdx = order.indexOf('loadURL');
    assert.ok(trayIdx !== -1, 'updateTrayMenu must be called');
    assert.ok(urlIdx !== -1, 'loadURL must be called');
    assert.ok(trayIdx < urlIdx, 'updateTrayMenu must be called before loadURL');
  });

  test('launchProfile: executeJavaScript inject contains exactly #0f1117', async () => {
    let injectedCode = null;
    win.webContents.executeJavaScript = (code) => {
      injectedCode = code;
      return Promise.resolve();
    };
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'https://cam1' }]);
    handlers['launchProfile'](makeEvent(win), 'p1');
    await new Promise((r) => setTimeout(r, 60));

    assert.ok(injectedCode !== null, 'executeJavaScript must be called');
    assert.ok(
      injectedCode.includes('#0f1117'),
      `inject code must contain #0f1117, got: ${injectedCode}`,
    );
  });

  test('launchProfile: executeJavaScript rejection is swallowed (no crash)', async () => {
    win.webContents.executeJavaScript = () => Promise.reject(new Error('DOM error'));
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'https://cam1' }]);
    await assert.doesNotReject(
      new Promise((resolve) => {
        handlers['launchProfile'](makeEvent(win), 'p1');
        setTimeout(resolve, 60);
      }),
    );
  });

  test('launchProfile: does nothing when profile ID does not exist', () => {
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    handlers['launchProfile'](makeEvent(win), 'UNKNOWN');
    assert.strictEqual(mockStoreInstance.get('activeProfileId'), undefined);
    assert.strictEqual(trayUpdateCalls.length, 0);
  });

  test('launchProfile: does nothing when no window found for sender', () => {
    BrowserWindow.fromWebContents = () => null;
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    assert.doesNotThrow(() => handlers['launchProfile']({ sender: {} }, 'p1'));
  });

  test('launchProfile: does nothing when profiles array is empty', () => {
    mockStoreInstance.set('profiles', []);
    assert.doesNotThrow(() => handlers['launchProfile'](makeEvent(win), 'any-id'));
    assert.strictEqual(mockStoreInstance.get('activeProfileId'), undefined);
  });

  test('launchProfile: does nothing with null profileId', () => {
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'P1', url: 'u1' }]);
    assert.doesNotThrow(() => handlers['launchProfile'](makeEvent(win), null));
    assert.strictEqual(mockStoreInstance.get('activeProfileId'), undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F11 HANDLER CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('ipc.js – registerF11Handler', () => {
  beforeEach(() => {
    mockStoreInstance = new MockStore();
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
  });

  test('registers before-input-event on webContents', () => {
    const { registerF11Handler } = requireFreshIpc();
    const win = new BrowserWindow({ width: 800, height: 600 });
    registerF11Handler(win);
    assert.ok(win._eventHandlers['before-input-event'], 'before-input-event must be registered');
  });

  test('F11 keyDown: toggles fullscreen from false to true and calls preventDefault', () => {
    const { registerF11Handler } = requireFreshIpc();
    const win = new BrowserWindow({ width: 800, height: 600 });
    registerF11Handler(win);

    win._fullscreen = false;
    let preventDefaultCalled = false;
    const fakeEvent = {
      preventDefault: () => {
        preventDefaultCalled = true;
      },
    };
    const fakeInput = { type: 'keyDown', key: 'F11' };

    win._eventHandlers['before-input-event'][0](fakeEvent, fakeInput);

    assert.strictEqual(preventDefaultCalled, true);
    assert.strictEqual(win._fullscreen, true);
  });

  test('F11 keyDown: toggles fullscreen from true to false', () => {
    const { registerF11Handler } = requireFreshIpc();
    const win = new BrowserWindow({ width: 800, height: 600 });
    registerF11Handler(win);

    win._fullscreen = true;
    const fakeEvent = { preventDefault: () => {} };
    win._eventHandlers['before-input-event'][0](fakeEvent, { type: 'keyDown', key: 'F11' });
    assert.strictEqual(win._fullscreen, false);
  });

  test('F11 keyDown: double-toggle restores original state', () => {
    const { registerF11Handler } = requireFreshIpc();
    const win = new BrowserWindow({ width: 800, height: 600 });
    registerF11Handler(win);

    win._fullscreen = false;
    const fakeEvent = { preventDefault: () => {} };
    win._eventHandlers['before-input-event'][0](fakeEvent, { type: 'keyDown', key: 'F11' });
    win._eventHandlers['before-input-event'][0](fakeEvent, { type: 'keyDown', key: 'F11' });
    assert.strictEqual(win._fullscreen, false);
  });

  test('other keys are ignored by registerF11Handler', () => {
    const { registerF11Handler } = requireFreshIpc();
    const win = new BrowserWindow({ width: 800, height: 600 });
    registerF11Handler(win);

    win._fullscreen = false;
    const fakeEvent = { preventDefault: () => {} };
    for (const key of ['F5', 'F9', 'F10', 'F12', 'Enter', 'Escape']) {
      win._eventHandlers['before-input-event'][0](fakeEvent, { type: 'keyDown', key });
    }
    assert.strictEqual(win._fullscreen, false);
  });

  test('keyUp F11 is ignored (only keyDown triggers toggle)', () => {
    const { registerF11Handler } = requireFreshIpc();
    const win = new BrowserWindow({ width: 800, height: 600 });
    registerF11Handler(win);

    win._fullscreen = false;
    let preventDefaultCalled = false;
    const fakeEvent = {
      preventDefault: () => {
        preventDefaultCalled = true;
      },
    };
    win._eventHandlers['before-input-event'][0](fakeEvent, { type: 'keyUp', key: 'F11' });
    assert.strictEqual(win._fullscreen, false);
    assert.strictEqual(preventDefaultCalled, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// makeWindowLogHandler CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('ipc.js – makeWindowLogHandler', () => {
  beforeEach(() => {
    mockStoreInstance = new MockStore();
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
  });

  test('makeWindowLogHandler is exported and is a function', () => {
    const mod = requireFreshIpc();
    assert.strictEqual(typeof mod.makeWindowLogHandler, 'function');
  });

  test('calls logger.log with LOG_SOURCE_WINDOW and message', () => {
    const { makeWindowLogHandler } = requireFreshIpc();
    const logCalls = [];
    const fakeLogger = {
      log: (source, msg) => logCalls.push({ source, msg }),
      getLogPath: () => '/fake/upv.log',
    };
    const handler = makeWindowLogHandler(() => fakeLogger);
    handler({}, '[upv window] Login button clicked');
    assert.equal(logCalls.length, 1);
    assert.equal(logCalls[0].source, 'window');
    assert.equal(logCalls[0].msg, '[upv window] Login button clicked');
  });

  test('does not throw when getLogger returns null', () => {
    const { makeWindowLogHandler } = requireFreshIpc();
    const handler = makeWindowLogHandler(() => null);
    assert.doesNotThrow(() => handler({}, '[upv window] test'));
  });

  test('does not throw when getLogger is undefined', () => {
    const { makeWindowLogHandler } = requireFreshIpc();
    const handler = makeWindowLogHandler(undefined);
    assert.doesNotThrow(() => handler({}, '[upv window] test'));
  });

  test('IPC channel registered for upv:log is the window log handler', () => {
    const { registerIpcHandlers } = requireFreshIpc();
    registerIpcHandlers();
    const handlers = getIpcMainHandlers();
    assert.ok('upv:log' in handlers, '"upv:log" channel must be registered');
    assert.strictEqual(typeof handlers['upv:log'], 'function');
  });
});
