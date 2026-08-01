'use strict';

/**
 * @file test/main/app.test.js
 * @description Behavioral contract tests for src/main/app.js
 *
 * app.js executes side effects on import (commandLine.appendSwitch,
 * Menu.setApplicationMenu, app.whenReady, etc.).
 * We test the registered lifecycle callbacks in isolation.
 *
 * Guarantees:
 *  - Certificate error suppression switch is applied with exact argument
 *  - appendSwitch is called exactly once (no extra switches)
 *  - Menu is set to null (disables native F11 accelerator)
 *  - electron-reloader failure is silently ignored
 *  - registerIpcHandlers is called BEFORE createMainWindow (order enforced)
 *  - whenReady triggers registerIpcHandlers and createMainWindow
 *  - window-all-closed quits on non-darwin, stays on darwin
 *  - activate creates a new window only when none exist
 *  - app.js exports nothing (no public API)
 *  - single-instance lock: a duplicate launch quits immediately without
 *    running whenReady startup (no second AdoptionClient/window)
 *  - single-instance lock: the holder registers a second-instance handler
 *    that surfaces (restores/shows/focuses) its existing window
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Module } = require('node:module');

const {
  installElectronMock,
  uninstallElectronMock,
  resetElectronMocks,
  getAppHandlers,
  app,
  BrowserWindow,
  Menu,
} = require('../helpers/mock-electron');

let registerIpcHandlersCalled = false;
let createMainWindowCalled = false;
let createMainWindowCount = 0;
let callOrder = [];

const ipcMock = {
  registerIpcHandlers: () => {
    registerIpcHandlersCalled = true;
    callOrder.push('registerIpcHandlers');
  },
};

const windowMock = {
  createMainWindow: async () => {
    createMainWindowCalled = true;
    createMainWindowCount++;
    callOrder.push('createMainWindow');
    return new BrowserWindow({ width: 1280, height: 760 });
  },
};

const originalLoad = Module._load;

function installMocks() {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return require('../helpers/mock-electron').electronMock;
    if (request === './ipc') return ipcMock;
    if (request === './window') return windowMock;
    if (request === 'electron-reloader') throw new Error('not available');
    return originalLoad.call(this, request, parent, isMain);
  };
}

function uninstallMocks() {
  Module._load = originalLoad;
}

function requireFreshApp() {
  const p = require.resolve('../../src/main/app');
  delete require.cache[p];
  return require('../../src/main/app');
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE BOUNDARY CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('app.js – module boundary contract', () => {
  beforeEach(() => {
    registerIpcHandlersCalled = false;
    createMainWindowCalled = false;
    createMainWindowCount = 0;
    callOrder = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
    delete require.cache[require.resolve('../../src/main/app')];
  });

  test('app.js exports nothing (empty object)', () => {
    const mod = requireFreshApp();
    assert.deepStrictEqual(Object.keys(mod), [], 'app.js must have no public exports');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STARTUP SIDE EFFECTS CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('app.js – startup side effects', () => {
  beforeEach(() => {
    registerIpcHandlersCalled = false;
    createMainWindowCalled = false;
    createMainWindowCount = 0;
    callOrder = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
    delete require.cache[require.resolve('../../src/main/app')];
  });

  test('commandLine.appendSwitch is called with "ignore-certificate-errors"', () => {
    const calls = [];
    require('../helpers/mock-electron').electronMock.app.commandLine.appendSwitch = (key, val) => {
      calls.push({ key, val });
    };
    requireFreshApp();
    assert.ok(
      calls.some((c) => c.key === 'ignore-certificate-errors'),
      'appendSwitch must be called with "ignore-certificate-errors"',
    );
  });

  test('commandLine.appendSwitch is called exactly once', () => {
    let callCount = 0;
    require('../helpers/mock-electron').electronMock.app.commandLine.appendSwitch = () => {
      callCount++;
    };
    requireFreshApp();
    assert.strictEqual(callCount, 1, 'appendSwitch must be called exactly once');
  });

  test('appendSwitch: value is exactly "true"', () => {
    const calls = [];
    require('../helpers/mock-electron').electronMock.app.commandLine.appendSwitch = (key, val) => {
      calls.push({ key, val });
    };
    requireFreshApp();
    assert.strictEqual(calls[0].val, 'true');
  });

  test('Menu.setApplicationMenu is called with null', () => {
    let lastArg = 'NOT_CALLED';
    require('../helpers/mock-electron').electronMock.Menu.setApplicationMenu = (menu) => {
      lastArg = menu;
    };
    requireFreshApp();
    assert.strictEqual(lastArg, null, 'Menu.setApplicationMenu must be called with null');
  });

  test('electron-reloader failure is silently ignored (no throw)', () => {
    assert.doesNotThrow(() => requireFreshApp());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WHENREADY / CALL ORDER CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('app.js – whenReady call order', () => {
  beforeEach(() => {
    registerIpcHandlersCalled = false;
    createMainWindowCalled = false;
    createMainWindowCount = 0;
    callOrder = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
    delete require.cache[require.resolve('../../src/main/app')];
  });

  test('registerIpcHandlers is called after whenReady', async () => {
    requireFreshApp();
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(registerIpcHandlersCalled, true);
  });

  test('createMainWindow is called after whenReady', async () => {
    requireFreshApp();
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(createMainWindowCalled, true);
  });

  test('registerIpcHandlers is called BEFORE createMainWindow', async () => {
    requireFreshApp();
    await new Promise((r) => setImmediate(r));
    const ipcIdx = callOrder.indexOf('registerIpcHandlers');
    const winIdx = callOrder.indexOf('createMainWindow');
    assert.ok(ipcIdx !== -1, 'registerIpcHandlers must be called');
    assert.ok(winIdx !== -1, 'createMainWindow must be called');
    assert.ok(ipcIdx < winIdx, 'registerIpcHandlers must be called before createMainWindow');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// window-all-closed CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('app.js – window-all-closed', () => {
  beforeEach(() => {
    registerIpcHandlersCalled = false;
    createMainWindowCalled = false;
    createMainWindowCount = 0;
    callOrder = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
    delete require.cache[require.resolve('../../src/main/app')];
    Object.defineProperty(process, 'platform', { value: process.platform, configurable: true });
  });

  test('win32: window-all-closed calls app.quit', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    let quitCalled = false;
    app.quit = () => {
      quitCalled = true;
    };
    requireFreshApp();
    app.emit('window-all-closed');
    assert.strictEqual(quitCalled, true);
  });

  test('linux: window-all-closed calls app.quit', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    let quitCalled = false;
    app.quit = () => {
      quitCalled = true;
    };
    requireFreshApp();
    app.emit('window-all-closed');
    assert.strictEqual(quitCalled, true);
  });

  test('darwin: window-all-closed does NOT call app.quit', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    let quitCalled = false;
    app.quit = () => {
      quitCalled = true;
    };
    requireFreshApp();
    app.emit('window-all-closed');
    assert.strictEqual(quitCalled, false);
  });

  test('window-all-closed on win32: each emit triggers exactly one quit', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    let quitCount = 0;
    app.quit = () => {
      quitCount++;
    };
    requireFreshApp();
    app.emit('window-all-closed');
    app.emit('window-all-closed');
    assert.strictEqual(
      quitCount,
      2,
      'each window-all-closed event must trigger exactly one app.quit call',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// activate CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('app.js – activate (macOS re-open)', () => {
  beforeEach(() => {
    registerIpcHandlersCalled = false;
    createMainWindowCalled = false;
    createMainWindowCount = 0;
    callOrder = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
    delete require.cache[require.resolve('../../src/main/app')];
  });

  test('activate with 0 windows: calls createMainWindow exactly once', async () => {
    requireFreshApp();
    await new Promise((r) => setImmediate(r));
    const countAfterStart = createMainWindowCount;

    BrowserWindow.getAllWindows = () => [];
    app.emit('activate');
    await new Promise((r) => setImmediate(r));

    assert.strictEqual(
      createMainWindowCount,
      countAfterStart + 1,
      'createMainWindow must be called exactly once on activate with 0 windows',
    );
  });

  test('activate with 1 window: does NOT call createMainWindow again', async () => {
    requireFreshApp();
    await new Promise((r) => setImmediate(r));
    const countAfterStart = createMainWindowCount;

    BrowserWindow.getAllWindows = () => [new BrowserWindow({ width: 100, height: 100 })];
    app.emit('activate');
    await new Promise((r) => setImmediate(r));

    assert.strictEqual(
      createMainWindowCount,
      countAfterStart,
      'createMainWindow must not be called when a window already exists',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE-INSTANCE LOCK CONTRACT
// ─────────────────────────────────────────────────────────────────────────────
// Viewport mode: two concurrent instances would each run their own
// AdoptionClient and adopt as the SAME MAC (derived from the shared userData
// dir), fighting each other on the NVR. requestSingleInstanceLock() must gate
// startup so a duplicate launch never reaches whenReady().

describe('app.js – single-instance lock', () => {
  beforeEach(() => {
    registerIpcHandlersCalled = false;
    createMainWindowCalled = false;
    createMainWindowCount = 0;
    callOrder = [];
    resetElectronMocks();
    installElectronMock();
    installMocks();
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
    delete require.cache[require.resolve('../../src/main/app')];
  });

  test('requestSingleInstanceLock is called exactly once, synchronously at require-time', () => {
    let callCount = 0;
    app.requestSingleInstanceLock = () => {
      callCount++;
      return true;
    };
    requireFreshApp();
    // No await/tick needed – must happen before whenReady, i.e. during require().
    assert.strictEqual(callCount, 1);
  });

  test('lock NOT acquired: app.quit is called', () => {
    app.requestSingleInstanceLock = () => false;
    let quitCalled = false;
    app.quit = () => {
      quitCalled = true;
    };
    requireFreshApp();
    assert.strictEqual(quitCalled, true, 'a duplicate launch must call app.quit()');
  });

  test('lock NOT acquired: whenReady startup never runs (no second AdoptionClient/window)', async () => {
    app.requestSingleInstanceLock = () => false;
    app.quit = () => {};
    requireFreshApp();
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(
      registerIpcHandlersCalled,
      false,
      'registerIpcHandlers must not run for a duplicate launch',
    );
    assert.strictEqual(
      createMainWindowCalled,
      false,
      'createMainWindow must not run for a duplicate launch',
    );
  });

  test('lock acquired: whenReady startup still runs normally', async () => {
    app.requestSingleInstanceLock = () => true;
    requireFreshApp();
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(registerIpcHandlersCalled, true);
    assert.strictEqual(createMainWindowCalled, true);
  });

  test('lock acquired: a second-instance handler is registered', () => {
    app.requestSingleInstanceLock = () => true;
    requireFreshApp();
    assert.ok(
      getAppHandlers()['second-instance'] && getAppHandlers()['second-instance'].length > 0,
      'a second-instance listener must be registered when this instance holds the lock',
    );
  });

  test('second-instance: existing window is shown and focused', async () => {
    app.requestSingleInstanceLock = () => true;
    requireFreshApp();
    await new Promise((r) => setImmediate(r)); // let whenReady create the window

    const win = BrowserWindow.getAllWindows()[0];
    win.hide();
    let focusCalled = false;
    win.focus = () => {
      focusCalled = true;
    };

    app.emit('second-instance');

    assert.strictEqual(win.isVisible(), true, 'window must be shown');
    assert.strictEqual(focusCalled, true, 'window must be focused');
  });

  test('second-instance: minimized window is restored before being shown', async () => {
    app.requestSingleInstanceLock = () => true;
    requireFreshApp();
    await new Promise((r) => setImmediate(r));

    const win = BrowserWindow.getAllWindows()[0];
    win._minimized = true;
    let restoreCalled = false;
    const originalRestore = win.restore.bind(win);
    win.restore = () => {
      restoreCalled = true;
      originalRestore();
    };

    app.emit('second-instance');

    assert.strictEqual(restoreCalled, true, 'a minimized window must be restored');
  });

  test('second-instance: does not throw when no window exists', () => {
    app.requestSingleInstanceLock = () => true;
    requireFreshApp();
    BrowserWindow.getAllWindows = () => [];
    assert.doesNotThrow(() => app.emit('second-instance'));
  });
});
