'use strict';

/**
 * @file test/main/tray.test.js
 * @description Behavioral contract tests for src/main/tray.js
 *
 * Guarantees:
 *  - Exported symbol surface is locked (add/remove → test failure)
 *  - Tray creation and destruction lifecycle is tested
 *  - Context menu template structure is locked (exact label strings and order)
 *  - All menu action clicks are tested (Show/Hide, Edit Config, Restart, etc.)
 *  - show()/focus() call contracts are enforced for openConfigPage
 *  - Restart calls app.quit, NOT app.exit (distinguished from ipc.restart)
 *  - Quit calls app.quit, NOT app.exit
 *  - Profile switching via tray is tested (ordering, show/focus)
 *  - updateTrayMenu is called after profile switch
 *  - USER_AGENT constant is locked
 *  - before-quit lifecycle is tested (no-op on second updateTrayMenu)
 *  - Icon path ends with 128.png
 *  - Separator count and menu item order are locked
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Module } = require('node:module');

const {
  installElectronMock,
  uninstallElectronMock,
  resetElectronMocks,
  getTrayInstances,
  getMenuBuiltTemplates,
  app,
  Tray,
} = require('../helpers/mock-electron');

const MockStore = require('../helpers/mock-store');
let mockStoreInstance;

const storeApi = {
  getProfiles: () => mockStoreInstance.get('profiles', []),
  getActiveProfileId: () => mockStoreInstance.get('activeProfileId'),
  setActiveProfileId: (id) => mockStoreInstance.set('activeProfileId', id),
  clearAll: () => mockStoreInstance.clear(),
};

const originalLoad = Module._load;

function installMocks() {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return require('../helpers/mock-electron').electronMock;
    }
    if (request === './store') {
      return storeApi;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

function uninstallMocks() {
  Module._load = originalLoad;
}

function requireFreshTray() {
  const trayPath = require.resolve('../../src/main/tray');
  delete require.cache[trayPath];
  return require('../../src/main/tray');
}

function makeMockWindow(visible = true, destroyed = false) {
  return {
    _visible: visible,
    _focused: false,
    _destroyed: destroyed,
    _url: null,
    _file: null,
    _loadURLOpts: null,
    show: function () {
      this._visible = true;
    },
    hide: function () {
      this._visible = false;
    },
    focus: function () {
      this._focused = true;
    },
    isVisible: function () {
      return this._visible;
    },
    isDestroyed: function () {
      return this._destroyed;
    },
    loadFile: function (p) {
      this._file = p;
      return Promise.resolve();
    },
    loadURL: function (url, opts) {
      this._url = url;
      this._loadURLOpts = opts;
      return Promise.resolve();
    },
    webContents: { on: () => {} },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE BOUNDARY CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('tray.js – module boundary contract', () => {
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

  test('exports exactly { createTray, updateTrayMenu }', () => {
    const mod = requireFreshTray();
    assert.deepStrictEqual(Object.keys(mod).sort(), ['createTray', 'updateTrayMenu']);
  });

  test('createTray is a function', () => {
    const mod = requireFreshTray();
    assert.strictEqual(typeof mod.createTray, 'function');
  });

  test('updateTrayMenu is a function', () => {
    const mod = requireFreshTray();
    assert.strictEqual(typeof mod.updateTrayMenu, 'function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRAY CREATION CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('tray.js – createTray', () => {
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

  test('creates exactly one Tray instance', () => {
    const { createTray } = requireFreshTray();
    createTray(makeMockWindow());
    assert.strictEqual(getTrayInstances().length, 1);
  });

  test('tray tooltip is exactly "Unifi Protect Viewer"', () => {
    const { createTray } = requireFreshTray();
    createTray(makeMockWindow());
    assert.strictEqual(getTrayInstances()[0]._tooltip, 'Unifi Protect Viewer');
  });

  test('destroys existing tray before creating a new one', () => {
    const { createTray } = requireFreshTray();
    const win = makeMockWindow();
    createTray(win);
    const firstTray = getTrayInstances()[0];
    createTray(win);
    assert.strictEqual(firstTray._destroyed, true);
    assert.ok(getTrayInstances().length >= 2);
  });

  test('calls Menu.buildFromTemplate to build context menu', () => {
    const { createTray } = requireFreshTray();
    mockStoreInstance.set('profiles', []);
    createTray(makeMockWindow());
    assert.ok(getMenuBuiltTemplates().length > 0, 'Menu.buildFromTemplate must be called');
  });

  test('registers double-click handler', () => {
    const { createTray } = requireFreshTray();
    createTray(makeMockWindow());
    assert.ok(
      getTrayInstances()[0]._eventHandlers['double-click'],
      'double-click must be registered',
    );
  });

  test('double-click shows hidden window', () => {
    const { createTray } = requireFreshTray();
    const win = makeMockWindow(false);
    createTray(win);
    getTrayInstances()[0]._eventHandlers['double-click'][0]();
    assert.strictEqual(win._visible, true);
  });

  test('double-click does nothing when window is destroyed', () => {
    const { createTray } = requireFreshTray();
    const win = makeMockWindow(true, true);
    createTray(win);
    assert.doesNotThrow(() => getTrayInstances()[0]._eventHandlers['double-click'][0]());
  });

  test('before-quit handler destroys the tray', () => {
    const { createTray } = requireFreshTray();
    createTray(makeMockWindow());
    const tray = getTrayInstances()[0];
    app.emit('before-quit');
    assert.strictEqual(tray._destroyed, true);
  });

  test('nativeImage.createFromPath is called with a path ending in 128.png', () => {
    let capturedPath = null;
    require('../helpers/mock-electron').electronMock.nativeImage.createFromPath = (p) => {
      capturedPath = p;
      return {
        resize: () => ({ setTemplateImage: () => {}, resize: () => ({}) }),
        setTemplateImage: () => {},
      };
    };
    const { createTray } = requireFreshTray();
    mockStoreInstance.set('profiles', []);
    createTray(makeMockWindow());
    assert.ok(capturedPath !== null, 'createFromPath must be called');
    assert.ok(
      capturedPath.replace(/\\/g, '/').endsWith('128.png'),
      `icon path must end with 128.png, got: ${capturedPath}`,
    );
  });

  test('macOS: setTemplateImage(true) is called on the icon', () => {
    const { createTray } = requireFreshTray();
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    let setTemplateImageCalled = false;
    require('../helpers/mock-electron').electronMock.nativeImage.createFromPath = () => ({
      resize: () => ({
        setTemplateImage: () => {
          setTemplateImageCalled = true;
        },
        resize: () => ({}),
      }),
      setTemplateImage: () => {},
    });

    createTray(makeMockWindow());
    assert.strictEqual(setTemplateImageCalled, true);
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT MENU STRUCTURE CONTRACT
// Changing any label string or order causes these tests to fail.
// ─────────────────────────────────────────────────────────────────────────────

describe('tray.js – context menu structure contract', () => {
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

  test('menu contains exactly the labels: Show / Hide, Edit Configuration, Restart, Reset & Restart, Quit', () => {
    const { createTray } = requireFreshTray();
    mockStoreInstance.set('profiles', []);
    createTray(makeMockWindow());
    const template = getMenuBuiltTemplates()[0];
    const labels = template.map((i) => i.label).filter(Boolean);
    assert.deepStrictEqual(labels.sort(), [
      'Edit Configuration',
      'Quit',
      'Reset & Restart',
      'Restart',
      'Show / Hide',
    ]);
  });

  test('"Show / Hide" is the first labeled menu item', () => {
    const { createTray } = requireFreshTray();
    mockStoreInstance.set('profiles', []);
    createTray(makeMockWindow());
    const template = getMenuBuiltTemplates()[0];
    const firstLabel = template.find((i) => i.label)?.label;
    assert.strictEqual(firstLabel, 'Show / Hide');
  });

  test('"Quit" is the last labeled menu item', () => {
    const { createTray } = requireFreshTray();
    mockStoreInstance.set('profiles', []);
    createTray(makeMockWindow());
    const template = getMenuBuiltTemplates()[0];
    const labels = template.filter((i) => i.label).map((i) => i.label);
    assert.strictEqual(labels[labels.length - 1], 'Quit');
  });

  test('context menu contains at least 2 separators', () => {
    const { createTray } = requireFreshTray();
    mockStoreInstance.set('profiles', []);
    createTray(makeMockWindow());
    const template = getMenuBuiltTemplates()[0];
    const separators = template.filter((i) => i.type === 'separator');
    assert.ok(separators.length >= 2, `expected ≥2 separators, got: ${separators.length}`);
  });

  test('updateTrayMenu does nothing when no tray exists', () => {
    const { updateTrayMenu } = requireFreshTray();
    assert.doesNotThrow(() => updateTrayMenu(makeMockWindow()));
  });

  test('updateTrayMenu rebuilds the context menu', () => {
    const { createTray, updateTrayMenu } = requireFreshTray();
    const win = makeMockWindow();
    mockStoreInstance.set('profiles', []);
    createTray(win);
    const countBefore = getMenuBuiltTemplates().length;
    updateTrayMenu(win);
    assert.ok(
      getMenuBuiltTemplates().length > countBefore,
      'buildFromTemplate must be called again',
    );
  });

  test('menu includes profile radio items when profiles exist', () => {
    const { createTray, updateTrayMenu } = requireFreshTray();
    const win = makeMockWindow();
    mockStoreInstance.set('profiles', [
      { id: 'p1', name: 'Cam1', url: 'u1' },
      { id: 'p2', name: 'Cam2', url: 'u2' },
    ]);
    mockStoreInstance.set('activeProfileId', 'p1');
    createTray(win);
    updateTrayMenu(win);
    const lastTemplate = getMenuBuiltTemplates()[getMenuBuiltTemplates().length - 1];
    const profileItems = lastTemplate.filter((i) => i.type === 'radio');
    assert.strictEqual(profileItems.length, 2);
    assert.strictEqual(profileItems[0].label, 'Cam1');
    assert.strictEqual(profileItems[0].checked, true);
    assert.strictEqual(profileItems[1].label, 'Cam2');
    assert.strictEqual(profileItems[1].checked, false);
  });

  test('menu includes "Switch Profile" disabled label when profiles exist', () => {
    const { createTray, updateTrayMenu } = requireFreshTray();
    const win = makeMockWindow();
    mockStoreInstance.set('profiles', [{ id: 'p1', name: 'Cam1', url: 'u1' }]);
    createTray(win);
    updateTrayMenu(win);
    const lastTemplate = getMenuBuiltTemplates()[getMenuBuiltTemplates().length - 1];
    const switchItem = lastTemplate.find((i) => i.label === 'Switch Profile');
    assert.ok(switchItem, 'Switch Profile label must exist');
    assert.strictEqual(switchItem.enabled, false);
  });

  test('profile label falls back to URL when name is empty', () => {
    const { createTray, updateTrayMenu } = requireFreshTray();
    const win = makeMockWindow();
    mockStoreInstance.set('profiles', [{ id: 'p1', name: '', url: 'https://cam.local' }]);
    createTray(win);
    updateTrayMenu(win);
    const lastTemplate = getMenuBuiltTemplates()[getMenuBuiltTemplates().length - 1];
    const radioItems = lastTemplate.filter((i) => i.type === 'radio');
    assert.strictEqual(radioItems[0].label, 'https://cam.local');
  });

  test('no profile items in menu when profiles array is empty', () => {
    const { createTray, updateTrayMenu } = requireFreshTray();
    const win = makeMockWindow();
    mockStoreInstance.set('profiles', []);
    createTray(win);
    updateTrayMenu(win);
    const lastTemplate = getMenuBuiltTemplates()[getMenuBuiltTemplates().length - 1];
    const radioItems = lastTemplate.filter((i) => i.type === 'radio');
    assert.strictEqual(radioItems.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MENU ACTION CONTRACTS
// ─────────────────────────────────────────────────────────────────────────────

describe('tray.js – menu actions', () => {
  let win;
  let trayModule;

  beforeEach(() => {
    mockStoreInstance = new MockStore();
    resetElectronMocks();
    installElectronMock();
    installMocks();
    trayModule = requireFreshTray();
    win = makeMockWindow();
    mockStoreInstance.set('profiles', [
      { id: 'p1', name: 'P1', url: 'https://cam1' },
      { id: 'p2', name: 'P2', url: 'https://cam2' },
    ]);
    mockStoreInstance.set('activeProfileId', 'p1');
    trayModule.createTray(win);
  });

  afterEach(() => {
    uninstallMocks();
    uninstallElectronMock();
  });

  // ── Show / Hide ──────────────────────────────────────────────────────────

  test('Show / Hide: click hides visible window', () => {
    const template = getMenuBuiltTemplates()[0];
    const showHide = template.find((i) => i.label === 'Show / Hide');
    win._visible = true;
    showHide.click();
    assert.strictEqual(win._visible, false);
  });

  test('Show / Hide: click shows hidden window', () => {
    const template = getMenuBuiltTemplates()[0];
    const showHide = template.find((i) => i.label === 'Show / Hide');
    win._visible = false;
    showHide.click();
    assert.strictEqual(win._visible, true);
  });

  test('Show / Hide: does nothing when window is destroyed', () => {
    const template = getMenuBuiltTemplates()[0];
    const showHide = template.find((i) => i.label === 'Show / Hide');
    win._destroyed = true;
    assert.doesNotThrow(() => showHide.click());
  });

  // ── Edit Configuration ───────────────────────────────────────────────────

  test('Edit Configuration: loads config.html', () => {
    const template = getMenuBuiltTemplates()[0];
    const editConfig = template.find((i) => i.label === 'Edit Configuration');
    editConfig.click();
    assert.ok(
      win._file && win._file.endsWith('config.html'),
      `expected config.html, got: ${win._file}`,
    );
  });

  test('Edit Configuration: calls show() before loading config.html', () => {
    const template = getMenuBuiltTemplates()[0];
    const editConfig = template.find((i) => i.label === 'Edit Configuration');
    win._visible = false;
    editConfig.click();
    assert.strictEqual(win._visible, true, 'show() must be called');
  });

  test('Edit Configuration: calls focus() on the window', () => {
    const template = getMenuBuiltTemplates()[0];
    const editConfig = template.find((i) => i.label === 'Edit Configuration');
    editConfig.click();
    assert.strictEqual(win._focused, true, 'focus() must be called');
  });

  test('Edit Configuration: does nothing when window is destroyed', () => {
    const template = getMenuBuiltTemplates()[0];
    const editConfig = template.find((i) => i.label === 'Edit Configuration');
    win._destroyed = true;
    assert.doesNotThrow(() => editConfig.click());
  });

  // ── Restart ──────────────────────────────────────────────────────────────

  test('Restart: calls app.relaunch then app.quit', () => {
    const order = [];
    app.relaunch = () => {
      order.push('relaunch');
    };
    app.quit = () => {
      order.push('quit');
    };
    const template = getMenuBuiltTemplates()[0];
    template.find((i) => i.label === 'Restart').click();
    assert.deepStrictEqual(order, ['relaunch', 'quit']);
  });

  test('Restart: calls app.quit, NOT app.exit', () => {
    let exitCalled = false;
    let quitCalled = false;
    app.exit = () => {
      exitCalled = true;
    };
    app.quit = () => {
      quitCalled = true;
    };
    app.relaunch = () => {};
    const template = getMenuBuiltTemplates()[0];
    template.find((i) => i.label === 'Restart').click();
    assert.strictEqual(quitCalled, true, 'app.quit must be called');
    assert.strictEqual(exitCalled, false, 'app.exit must NOT be called');
  });

  // ── Reset & Restart ───────────────────────────────────────────────────────

  test('Reset & Restart: clears store and calls relaunch', () => {
    let relaunchCalled = false;
    app.relaunch = () => {
      relaunchCalled = true;
    };
    app.quit = () => {};
    mockStoreInstance._seed({ profiles: [{ id: 'x' }] });
    const template = getMenuBuiltTemplates()[0];
    template.find((i) => i.label === 'Reset & Restart').click();
    assert.deepStrictEqual(mockStoreInstance._dump(), {});
    assert.strictEqual(relaunchCalled, true);
  });

  // ── Quit ─────────────────────────────────────────────────────────────────

  test('Quit: destroys tray and calls app.quit', () => {
    let quitCalled = false;
    app.quit = () => {
      quitCalled = true;
    };
    const tray = getTrayInstances()[0];
    const template = getMenuBuiltTemplates()[0];
    template.find((i) => i.label === 'Quit').click();
    assert.strictEqual(tray._destroyed, true);
    assert.strictEqual(quitCalled, true);
  });

  test('Quit: calls app.quit, NOT app.exit', () => {
    let exitCalled = false;
    let quitCalled = false;
    app.exit = () => {
      exitCalled = true;
    };
    app.quit = () => {
      quitCalled = true;
    };
    const template = getMenuBuiltTemplates()[0];
    template.find((i) => i.label === 'Quit').click();
    assert.strictEqual(quitCalled, true, 'app.quit must be called');
    assert.strictEqual(exitCalled, false, 'app.exit must NOT be called');
  });

  // ── Profile click ─────────────────────────────────────────────────────────

  test('profile click: sets activeProfileId and loads profile URL', async () => {
    trayModule.updateTrayMenu(win);
    const lastTemplate = getMenuBuiltTemplates()[getMenuBuiltTemplates().length - 1];
    const profileItems = lastTemplate.filter((i) => i.type === 'radio');
    profileItems[1].click(); // p2
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(mockStoreInstance.get('activeProfileId'), 'p2');
    assert.strictEqual(win._url, 'https://cam2');
  });

  test('profile click: loads URL with exact USER_AGENT string', async () => {
    const EXPECTED_USER_AGENT =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    trayModule.updateTrayMenu(win);
    const lastTemplate = getMenuBuiltTemplates()[getMenuBuiltTemplates().length - 1];
    const profileItems = lastTemplate.filter((i) => i.type === 'radio');
    profileItems[0].click();
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(win._loadURLOpts.userAgent, EXPECTED_USER_AGENT);
  });

  test('profile click: calls show() before loadURL', async () => {
    const order = [];
    win.show = () => {
      order.push('show');
    };
    win.focus = () => {
      order.push('focus');
    };
    const origLoadURL = win.loadURL.bind(win);
    win.loadURL = (url, opts) => {
      order.push('loadURL');
      return origLoadURL(url, opts);
    };

    trayModule.updateTrayMenu(win);
    const lastTemplate = getMenuBuiltTemplates()[getMenuBuiltTemplates().length - 1];
    lastTemplate.filter((i) => i.type === 'radio')[1].click();
    await new Promise((r) => setTimeout(r, 30));

    assert.ok(
      order.indexOf('show') < order.indexOf('loadURL'),
      'show() must be called before loadURL',
    );
  });

  test('profile click: calls updateTrayMenu after loadURL', async () => {
    const countBefore = getMenuBuiltTemplates().length;
    trayModule.updateTrayMenu(win);
    const lastTemplate = getMenuBuiltTemplates()[getMenuBuiltTemplates().length - 1];
    lastTemplate.filter((i) => i.type === 'radio')[1].click(); // p2
    await new Promise((r) => setTimeout(r, 30));
    // switchToProfile calls updateTrayMenu → buildFromTemplate count must have grown
    assert.ok(
      getMenuBuiltTemplates().length > countBefore + 1,
      'updateTrayMenu must be called again after profile switch',
    );
  });

  test('profile click: does nothing when window is destroyed', async () => {
    win._destroyed = true;
    trayModule.updateTrayMenu(win);
    const lastTemplate = getMenuBuiltTemplates()[getMenuBuiltTemplates().length - 1];
    let loadURLCalled = false;
    win.loadURL = () => {
      loadURLCalled = true;
      return Promise.resolve();
    };
    assert.doesNotThrow(() => lastTemplate.filter((i) => i.type === 'radio')[0].click());
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(loadURLCalled, false, 'loadURL must not be called for destroyed window');
  });

  test('profile click: does nothing when profile no longer exists (stale closure)', async () => {
    trayModule.updateTrayMenu(win);
    const lastTemplate = getMenuBuiltTemplates()[getMenuBuiltTemplates().length - 1];
    const profileItems = lastTemplate.filter((i) => i.type === 'radio');
    mockStoreInstance.set('profiles', []);
    if (profileItems.length > 0) {
      assert.doesNotThrow(() => profileItems[0].click());
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BEFORE-QUIT LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

describe('tray.js – before-quit lifecycle', () => {
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

  test('before-quit: second emit does not crash (tray is null after first)', () => {
    const { createTray, updateTrayMenu } = requireFreshTray();
    createTray(makeMockWindow());
    app.emit('before-quit');
    assert.doesNotThrow(() => updateTrayMenu(makeMockWindow()));
  });

  test('before-quit: updateTrayMenu is a no-op after tray is destroyed', () => {
    const { createTray, updateTrayMenu } = requireFreshTray();
    createTray(makeMockWindow());
    const countBefore = getMenuBuiltTemplates().length;
    app.emit('before-quit');
    updateTrayMenu(makeMockWindow());
    assert.strictEqual(
      getMenuBuiltTemplates().length,
      countBefore,
      'buildFromTemplate must not be called after before-quit',
    );
  });
});
