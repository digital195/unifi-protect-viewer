'use strict';

/**
 * @file test/main/menu.test.js
 * @description Behavioral contract tests for src/main/menu.js
 *
 * Guarantees:
 *  - Exported symbol surface is locked (installApplicationMenu only)
 *  - An Edit submenu with the clipboard roles is built on every platform
 *  - On darwin the app submenu with the quit role is built (Cmd+Q works again)
 *  - No togglefullscreen / reload roles - they would conflict with registerF11Handler
 *  - setApplicationMenu receives the built menu, never null
 *  - Installation failures are swallowed (must not crash the app) and logged
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Module } = require('node:module');

const {
  installElectronMock,
  uninstallElectronMock,
  resetElectronMocks,
  getMenuBuiltTemplates,
  Menu,
} = require('../helpers/mock-electron');

const originalLoad = Module._load;
const originalPlatform = process.platform;

function installMocks() {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return require('../helpers/mock-electron').electronMock;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

function uninstallMocks() {
  Module._load = originalLoad;
}

function requireFreshMenu() {
  const menuPath = require.resolve('../../src/main/menu');
  delete require.cache[menuPath];
  return require('../../src/main/menu');
}

function setPlatform(value) {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

// Flat list of every role in a template (top level + nested submenus).
function collectRoles(template) {
  const roles = [];
  for (const item of template) {
    if (item.role) roles.push(item.role);
    if (Array.isArray(item.submenu)) roles.push(...collectRoles(item.submenu));
  }
  return roles;
}

function findSubmenu(template, label) {
  const item = template.find((i) => i.label === label);
  return item && Array.isArray(item.submenu) ? item.submenu : null;
}

// getLogger is a factory function, matching the app.js/logger.js convention.
function createFakeLogger() {
  const lines = [];
  const getLogger = () => ({ log: (source, message) => lines.push({ source, message }) });
  getLogger.lines = lines;
  return getLogger;
}

function freshSetup() {
  resetElectronMocks();
  installElectronMock();
  installMocks();
}

function freshTeardown() {
  uninstallMocks();
  uninstallElectronMock();
  setPlatform(originalPlatform);
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE BOUNDARY CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('menu.js – module boundary contract', () => {
  beforeEach(freshSetup);
  afterEach(freshTeardown);

  test('exports exactly installApplicationMenu', () => {
    const mod = requireFreshMenu();
    assert.deepStrictEqual(Object.keys(mod), ['installApplicationMenu']);
  });
});
// ─────────────────────────────────────────────────────────────────────────────
// EDIT ROLES CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('menu.js – edit roles contract', () => {
  beforeEach(freshSetup);
  afterEach(freshTeardown);

  const CLIPBOARD_ROLES = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'];

  function assertEditRoles(platformName) {
    setPlatform(platformName);
    const mod = requireFreshMenu();
    mod.installApplicationMenu(createFakeLogger());

    const template = getMenuBuiltTemplates()[0];
    const edit = findSubmenu(template, 'Edit');
    assert.ok(edit, 'an Edit submenu must be built on ' + platformName);
    for (const role of CLIPBOARD_ROLES) {
      assert.ok(
        edit.some((i) => i.role === role),
        'Edit submenu must contain role ' + role,
      );
    }
  }

  test('Edit submenu carries the clipboard roles on darwin', () => {
    assertEditRoles('darwin');
  });

  test('Edit submenu carries the clipboard roles on win32', () => {
    assertEditRoles('win32');
  });

  test('no togglefullscreen role (F11 stays handled by ipc.js)', () => {
    setPlatform('darwin');
    const mod = requireFreshMenu();
    mod.installApplicationMenu(createFakeLogger());

    const roles = collectRoles(getMenuBuiltTemplates()[0]);
    assert.ok(!roles.includes('togglefullscreen'), 'togglefullscreen must not be registered');
  });

  test('no reload roles', () => {
    setPlatform('darwin');
    const mod = requireFreshMenu();
    mod.installApplicationMenu(createFakeLogger());

    const roles = collectRoles(getMenuBuiltTemplates()[0]);
    assert.ok(!roles.includes('reload'), 'reload must not be registered');
    assert.ok(!roles.includes('forceReload'), 'forceReload must not be registered');
  });
});
// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('menu.js – platform contract', () => {
  beforeEach(freshSetup);
  afterEach(freshTeardown);

  test('darwin: app submenu with the quit role (Cmd+Q works again)', () => {
    setPlatform('darwin');
    const mod = requireFreshMenu();
    mod.installApplicationMenu(createFakeLogger());

    const roles = collectRoles(getMenuBuiltTemplates()[0]);
    assert.ok(
      roles.includes('appMenu') || roles.includes('quit'),
      'the app submenu must restore Cmd+Q on darwin',
    );
  });

  test('win32: Edit-only menu, no app submenu', () => {
    setPlatform('win32');
    const mod = requireFreshMenu();
    mod.installApplicationMenu(createFakeLogger());

    const template = getMenuBuiltTemplates()[0];
    assert.deepStrictEqual(
      template.map((i) => i.role || i.label),
      ['Edit'],
    );
    assert.ok(!collectRoles(template).includes('quit'), 'no quit role on win32');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INSTALLATION CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('menu.js – installation contract', () => {
  beforeEach(freshSetup);
  afterEach(freshTeardown);

  test('setApplicationMenu is called once with the built menu (never null)', () => {
    setPlatform('darwin');
    const calls = [];
    Menu.setApplicationMenu = (menu) => calls.push(menu);

    const mod = requireFreshMenu();
    mod.installApplicationMenu(createFakeLogger());

    assert.strictEqual(calls.length, 1, 'setApplicationMenu must be called exactly once');
    assert.ok(calls[0], 'the built menu must be passed, not null');
  });

  test('installation is logged with the app log source', () => {
    setPlatform('darwin');
    const logger = createFakeLogger();
    const mod = requireFreshMenu();
    mod.installApplicationMenu(logger);

    assert.strictEqual(logger.lines.length, 1);
    assert.strictEqual(logger.lines[0].source, 'app');
    assert.ok(logger.lines[0].message.includes('application menu'));
  });

  test('setApplicationMenu failure is swallowed (must not crash the app)', () => {
    setPlatform('darwin');
    Menu.setApplicationMenu = () => {
      throw new Error('menu installation failed');
    };

    const logger = createFakeLogger();
    const mod = requireFreshMenu();
    assert.doesNotThrow(() => mod.installApplicationMenu(logger));
    assert.ok(logger.lines.some((l) => l.message.includes('application menu')));
  });

  test('missing logger does not crash installation', () => {
    setPlatform('darwin');
    const mod = requireFreshMenu();
    assert.doesNotThrow(() => mod.installApplicationMenu(null));
  });
});
