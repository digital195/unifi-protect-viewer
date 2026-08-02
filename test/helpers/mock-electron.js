'use strict';

/**
 * @file mock-electron.js
 * @description Full Electron mock for the Node.js test runner.
 *
 * Import this before any source module that calls require('electron').
 * Call resetElectronMocks() in beforeEach blocks to isolate state between tests.
 *
 * Exported symbols (alphabetical):
 *   BrowserWindow, Menu, Tray, app, contextBridge, electronMock,
 *   getBrowserWindowInstances, getAppHandlers, getContextBridgeExposed,
 *   getIpcMainHandleHandlers, getIpcMainHandlers, getIpcRendererInvokedMessages,
 *   getIpcRendererSentMessages, getMenuBuiltTemplates, getShellOpenedUrls,
 *   getTrayInstances, installElectronMock, ipcMain, ipcRenderer,
 *   nativeImage, resetElectronMocks, shell, uninstallElectronMock
 */

const { Module } = require('node:module');

// ── Internal state ────────────────────────────────────────────────────────────

let _appHandlers = {};
let _ipcMainHandlers = {};
let _ipcMainHandleHandlers = {};
let _ipcRendererSentMessages = [];
let _ipcRendererInvokedMessages = [];
let _contextBridgeExposed = {};
let _trayInstances = [];
let _browserWindowInstances = [];
let _menuBuiltTemplates = [];
let _shellOpenedUrls = [];
let _nativeImageCalls = [];

// ── app mock ──────────────────────────────────────────────────────────────────

const app = {
  _whenReadyCallbacks: [],
  commandLine: {
    appendSwitch: () => {},
  },
  getPath: (key) => {
    if (key === 'userData') return '/mock/userData';
    return '/mock/path';
  },
  whenReady: () =>
    Promise.resolve().then(() => {
      app._whenReadyCallbacks.forEach((cb) => cb());
    }),
  on: (event, handler) => {
    if (!_appHandlers[event]) _appHandlers[event] = [];
    _appHandlers[event].push(handler);
  },
  once: (event, handler) => {
    app.on(event, handler);
  },
  emit: (event, ...args) => {
    if (_appHandlers[event]) {
      _appHandlers[event].forEach((h) => h(...args));
    }
  },
  relaunch: () => {},
  quit: () => {},
  exit: () => {},
  // Single-instance lock: default to "we got the lock" (the common case).
  // Tests that simulate a duplicate launch override this to return false.
  requestSingleInstanceLock: () => true,
};

// ── BrowserWindow mock ────────────────────────────────────────────────────────

class BrowserWindow {
  constructor(options) {
    this._options = options;
    this._eventHandlers = {};
    this._url = null;
    this._file = null;
    this._title = 'Unifi Protect Viewer';
    this._fullscreen = false;
    this._visible = true;
    this._destroyed = false;
    // Initialise _bounds from constructor options so getBounds() returns the
    // position/size the window was created with (mirrors real Electron behaviour).
    this._bounds = {
      x: options?.x ?? 0,
      y: options?.y ?? 0,
      width: options?.width ?? 1280,
      height: options?.height ?? 760,
    };
    this.webContents = {
      _inputHandlers: [],
      on: (event, handler) => {
        if (!this._eventHandlers[event]) this._eventHandlers[event] = [];
        this._eventHandlers[event].push(handler);
      },
      executeJavaScript: () => Promise.resolve(),
      getURL: () => this._url || '',
      openDevTools: () => {},
    };
    _browserWindowInstances.push(this);
  }

  static getAllWindows() {
    return _browserWindowInstances.filter((w) => !w._destroyed);
  }

  static fromWebContents(wc) {
    return _browserWindowInstances.find((w) => w.webContents === wc) || null;
  }

  loadURL(url, opts) {
    this._url = url;
    this._loadURLOpts = opts;
    return Promise.resolve();
  }

  loadFile(filePath, opts) {
    this._file = filePath;
    this._loadFileOpts = opts;
    return Promise.resolve();
  }

  on(event, handler) {
    if (!this._eventHandlers[event]) this._eventHandlers[event] = [];
    this._eventHandlers[event].push(handler);
    return this;
  }

  once(event, handler) {
    const wrapper = (...args) => {
      handler(...args);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
    return this;
  }

  off(event, handler) {
    if (this._eventHandlers[event]) {
      this._eventHandlers[event] = this._eventHandlers[event].filter((h) => h !== handler);
    }
    return this;
  }

  emit(event, ...args) {
    if (this._eventHandlers[event]) {
      this._eventHandlers[event].forEach((h) => h(...args));
    }
  }

  setTitle(title) {
    this._title = title;
  }

  setFullScreen(val) {
    this._fullscreen = val;
  }

  isFullScreen() {
    return this._fullscreen;
  }

  getBounds() {
    return { ...this._bounds };
  }

  setBounds(bounds) {
    this._bounds = { ...bounds };
  }

  show() {
    this._visible = true;
  }

  hide() {
    this._visible = false;
  }

  focus() {}

  isVisible() {
    return this._visible;
  }

  isMinimized() {
    return this._minimized ?? false;
  }

  restore() {
    this._minimized = false;
  }

  isDestroyed() {
    return this._destroyed;
  }

  destroy() {
    this._destroyed = true;
  }
}

// Captured immediately, before any test can override them. Some tests stub
// BrowserWindow.getAllWindows (a static method, shared across all tests/files
// running in this process) to simulate 0/1 windows; without restoring it in
// resetElectronMocks() below, that stub leaks into every test that runs
// afterwards and returns a fabricated window instead of the real one.
const originalBrowserWindowGetAllWindows = BrowserWindow.getAllWindows;
const originalBrowserWindowFromWebContents = BrowserWindow.fromWebContents;

// ── Menu mock ─────────────────────────────────────────────────────────────────

const Menu = {
  setApplicationMenu: () => {},
  buildFromTemplate: (template) => {
    _menuBuiltTemplates.push(template);
    return { template };
  },
};

// ── Tray mock ─────────────────────────────────────────────────────────────────

class Tray {
  constructor(icon) {
    this._icon = icon;
    this._tooltip = '';
    this._contextMenu = null;
    this._eventHandlers = {};
    this._destroyed = false;
    _trayInstances.push(this);
  }

  setToolTip(tip) {
    this._tooltip = tip;
  }

  setContextMenu(menu) {
    this._contextMenu = menu;
  }

  on(event, handler) {
    if (!this._eventHandlers[event]) this._eventHandlers[event] = [];
    this._eventHandlers[event].push(handler);
  }

  emit(event, ...args) {
    if (this._eventHandlers[event]) {
      this._eventHandlers[event].forEach((h) => h(...args));
    }
  }

  destroy() {
    this._destroyed = true;
  }
}

// ── nativeImage mock ──────────────────────────────────────────────────────────

const nativeImage = {
  createFromPath: (p) => {
    _nativeImageCalls.push(p);
    return {
      resize: () => ({
        setTemplateImage: () => {},
        resize: () => ({}),
      }),
      setTemplateImage: () => {},
    };
  },
};

// ── ipcMain mock ──────────────────────────────────────────────────────────────

const ipcMain = {
  on: (channel, handler) => {
    _ipcMainHandlers[channel] = handler;
  },
  handle: (channel, handler) => {
    _ipcMainHandleHandlers[channel] = handler;
  },
  removeHandler: (channel) => {
    delete _ipcMainHandleHandlers[channel];
  },
};

// ── ipcRenderer mock ──────────────────────────────────────────────────────────

const ipcRenderer = {
  send: (channel, ...args) => {
    _ipcRendererSentMessages.push({ channel, args });
  },
  invoke: (channel, ...args) => {
    _ipcRendererInvokedMessages.push({ channel, args });
    return Promise.resolve(undefined);
  },
};

// ── contextBridge mock ────────────────────────────────────────────────────────

const contextBridge = {
  exposeInMainWorld: (apiKey, api) => {
    _contextBridgeExposed[apiKey] = api;
  },
};

// ── shell mock ────────────────────────────────────────────────────────────────

const shell = {
  openExternal: (url) => {
    _shellOpenedUrls.push(url);
    return Promise.resolve();
  },
  openPath: (p) => {
    _shellOpenedUrls.push(p);
    return Promise.resolve();
  },
};

// ── screen mock ───────────────────────────────────────────────────────────────

const screen = {
  // Override _displays in tests to simulate multiple monitors:
  //   screen._displays = [{ bounds: { x:0,y:0,width:1920,height:1080 } }, ...]
  _displays: null,
  getAllDisplays() {
    return (
      this._displays ?? [
        {
          id: 1,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          size: { width: 1920, height: 1080 },
        },
      ]
    );
  },
  getPrimaryDisplay() {
    return this.getAllDisplays()[0];
  },
};

// ── Electron module object ────────────────────────────────────────────────────

const electronMock = {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  ipcRenderer,
  contextBridge,
  shell,
  screen,
};

// ── Module cache patching ─────────────────────────────────────────────────────

const originalLoad = Module._load;

function installElectronMock() {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronMock;
    return originalLoad.call(this, request, parent, isMain);
  };
}

function uninstallElectronMock() {
  Module._load = originalLoad;
}

// ── Reset helper ──────────────────────────────────────────────────────────────

function resetElectronMocks() {
  _appHandlers = {};
  _ipcMainHandlers = {};
  _ipcMainHandleHandlers = {};
  _ipcRendererSentMessages = [];
  _ipcRendererInvokedMessages = [];
  _contextBridgeExposed = {};
  _trayInstances = [];
  _browserWindowInstances = [];
  _menuBuiltTemplates = [];
  _shellOpenedUrls = [];
  _nativeImageCalls = [];

  app._whenReadyCallbacks = [];
  app.commandLine.appendSwitch = () => {};
  app.relaunch = () => {};
  app.quit = () => {};
  app.exit = () => {};
  app.requestSingleInstanceLock = () => true;

  // Undo any per-test stub of these static methods (see capture above).
  BrowserWindow.getAllWindows = originalBrowserWindowGetAllWindows;
  BrowserWindow.fromWebContents = originalBrowserWindowFromWebContents;

  screen._displays = null;
}

// ── Accessor helpers for test inspection ─────────────────────────────────────

function getAppHandlers() {
  return _appHandlers;
}
function getIpcMainHandlers() {
  return _ipcMainHandlers;
}
function getIpcMainHandleHandlers() {
  return _ipcMainHandleHandlers;
}
function getIpcRendererSentMessages() {
  return _ipcRendererSentMessages;
}
function getIpcRendererInvokedMessages() {
  return _ipcRendererInvokedMessages;
}
function getContextBridgeExposed() {
  return _contextBridgeExposed;
}
function getTrayInstances() {
  return _trayInstances;
}
function getBrowserWindowInstances() {
  return _browserWindowInstances;
}
function getMenuBuiltTemplates() {
  return _menuBuiltTemplates;
}
function getShellOpenedUrls() {
  return _shellOpenedUrls;
}

module.exports = {
  electronMock,
  installElectronMock,
  uninstallElectronMock,
  resetElectronMocks,
  getAppHandlers,
  getIpcMainHandlers,
  getIpcMainHandleHandlers,
  getIpcRendererSentMessages,
  getIpcRendererInvokedMessages,
  getContextBridgeExposed,
  getTrayInstances,
  getBrowserWindowInstances,
  getMenuBuiltTemplates,
  getShellOpenedUrls,
  // Direct references
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  ipcRenderer,
  contextBridge,
  shell,
  screen,
};
