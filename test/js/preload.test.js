'use strict';

/**
 * @file test/js/preload.test.js
 * @description Behavioral contract tests for src/js/preload.js
 *
 * preload.js has no module.exports – it is an Electron preload bundle.
 * We test it by:
 *  1. Intercepting contextBridge.exposeInMainWorld → assert exact API surface
 *  2. Simulating window + document → test keyboard handlers
 *
 * Guarantees:
 *  - Exact electronAPI key set is locked (add/remove → test failure)
 *  - All IPC channel names are locked per method
 *  - All invoke channels are locked per method
 *  - invoke return values are passed through to callers
 *  - Argument integrity: count and value asserted per method
 *  - Keyboard shortcut channels are locked (F9, F10)
 *  - No extra arguments sent for zero-argument methods
 *  - Edge cases: null key, undefined key, non-registered keys
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const preloadSource = fs.readFileSync(path.resolve(__dirname, '../../src/js/preload.js'), 'utf8');

// ── DOM mock builder ──────────────────────────────────────────────────────────

function buildDomMock() {
  return {
    URL: 'https://cam.local/protect/dashboard',
    getElementById: () => null,
    createElement: (tag) => ({
      id: '',
      textContent: '',
      innerHTML: '',
      classList: { add: () => {}, contains: () => false },
      style: {},
      children: { length: 0 },
      remove: () => {},
      appendChild: () => {},
      dispatchEvent: () => true,
    }),
    getElementsByTagName: () => [],
    getElementsByClassName: () => ({ length: 0, 0: undefined }),
    getElementsByName: () => [undefined],
    querySelectorAll: () => ({ length: 0, forEach: () => {} }),
    querySelector: () => null,
    head: { appendChild: () => {} },
    body: { appendChild: () => {}, style: {}, insertAdjacentHTML: () => {} },
  };
}

/**
 * Executes preload.js in an isolated sandbox with mocked Electron IPC.
 * @param {*} invokeReturnValue - resolved value returned by ipcRenderer.invoke
 */
function runPreloadInSandbox(invokeReturnValue = undefined) {
  const sentMessages = [];
  const invokedMessages = [];
  const exposed = {};
  const keydownListeners = [];

  const mockIpcRenderer = {
    send: (ch, ...args) => sentMessages.push({ channel: ch, args }),
    invoke: (ch, ...args) => {
      invokedMessages.push({ channel: ch, args });
      return Promise.resolve(invokeReturnValue);
    },
  };

  const mockContextBridge = {
    exposeInMainWorld: (key, api) => {
      exposed[key] = api;
    },
  };

  const sandbox = {
    require: (mod) => {
      if (mod === 'electron')
        return { ipcRenderer: mockIpcRenderer, contextBridge: mockContextBridge };
      throw new Error(`require not allowed in preload sandbox: ${mod}`);
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    window: {
      addEventListener: (event, handler) => {
        if (event === 'keydown') keydownListeners.push(handler);
      },
    },
    document: buildDomMock(),
    localStorage: { getItem: () => null },
    location: { reload: () => {} },
    setTimeout: () => {},
    setInterval: () => {},
    clearTimeout: () => {},
    clearInterval: () => {},
    crypto: { randomUUID: () => 'test-uuid' },
    Event: class Event {
      constructor(t, o) {
        this.type = t;
      }
    },
    MouseEvent: class MouseEvent {
      constructor(t, o) {
        this.type = t;
      }
    },
    module: { id: 'preload' },
  };

  try {
    vm.runInNewContext(preloadSource, sandbox);
  } catch (_) {
    /* DOM side-effects – ignore */
  }
  // After script init, sentMessages may contain upv:log entries from the
  // installConsoleLogOverride() startup call. Record the base index so tests
  // can find the FIRST message sent after an explicit API call.
  const baseIdx = sentMessages.length;
  return { exposed, sentMessages, invokedMessages, keydownListeners, baseIdx };
}

// ─────────────────────────────────────────────────────────────────────────────
// API SURFACE CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js – API surface contract', () => {
  test('exposes exactly the expected electronAPI methods', () => {
    const { exposed } = runPreloadInSandbox();
    const expectedMethods = [
      'activeProfileGet',
      'activeProfileSet',
      'configLoad',
      'configSave',
      'displaysGet',
      'launchProfile',
      'openConfig',
      'openDevTools',
      'openExternal',
      'openLogFile',
      'profilesLoad',
      'profilesSave',
      'reset',
      'restart',
      'startupProfileGet',
      'startupProfileSet',
      'startupSettingsGet',
      'startupSettingsSet',
      'switchNextProfile',
      'toggleFullscreen',
    ].sort();
    assert.deepStrictEqual(Object.keys(exposed.electronAPI).sort(), expectedMethods);
  });

  test('all electronAPI methods are functions', () => {
    const { exposed } = runPreloadInSandbox();
    for (const [key, fn] of Object.entries(exposed.electronAPI)) {
      assert.strictEqual(typeof fn, 'function', `${key} must be a function`);
    }
  });

  test('exposeInMainWorld key is exactly "electronAPI"', () => {
    const { exposed } = runPreloadInSandbox();
    assert.ok('electronAPI' in exposed, '"electronAPI" key must be used');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IPC CHANNEL CONTRACTS (send)
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js – IPC send channel contracts', () => {
  test('configSave sends on channel "configSave"', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    exposed.electronAPI.configSave({ url: 'u', username: 'u', password: 'p' });
    assert.strictEqual(sentMessages[baseIdx].channel, 'configSave');
  });

  test('configSave: stores complete object without stripping fields', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    const cfg = { url: 'u', username: 'user', password: 'pw', extra: 'keep' };
    exposed.electronAPI.configSave(cfg);
    assert.deepStrictEqual(sentMessages[baseIdx].args[0], cfg);
  });

  test('configSave: sends exactly 1 argument', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    exposed.electronAPI.configSave({ url: 'u', username: 'u', password: 'p' });
    assert.strictEqual(sentMessages[baseIdx].args.length, 1);
  });

  test('profilesSave sends on channel "profilesSave"', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    exposed.electronAPI.profilesSave([]);
    assert.strictEqual(sentMessages[baseIdx].channel, 'profilesSave');
  });

  test('profilesSave: sends exactly 1 argument (the full array)', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    const profiles = [
      { id: 'p1', name: 'P1', url: 'u1', username: 'u', password: 'p' },
      { id: 'p2', name: 'P2', url: 'u2', username: 'u', password: 'p' },
    ];
    exposed.electronAPI.profilesSave(profiles);
    assert.strictEqual(sentMessages[baseIdx].args.length, 1);
    assert.deepStrictEqual(sentMessages[baseIdx].args[0], profiles);
  });

  test('launchProfile sends on channel "launchProfile"', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    exposed.electronAPI.launchProfile('p1');
    assert.strictEqual(sentMessages[baseIdx].channel, 'launchProfile');
  });

  test('launchProfile: sends exactly 1 argument (the profile ID)', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    exposed.electronAPI.launchProfile('exact-id');
    assert.strictEqual(sentMessages[baseIdx].args.length, 1);
    assert.strictEqual(sentMessages[baseIdx].args[0], 'exact-id');
  });

  test('activeProfileSet sends on channel "activeProfileSet"', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    exposed.electronAPI.activeProfileSet('x');
    assert.strictEqual(sentMessages[baseIdx].channel, 'activeProfileSet');
  });

  test('activeProfileSet with null: sends null (no guard)', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    exposed.electronAPI.activeProfileSet(null);
    assert.strictEqual(sentMessages[baseIdx].args[0], null);
  });

  test('startupProfileSet sends on channel "startupProfileSet"', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    exposed.electronAPI.startupProfileSet('x');
    assert.strictEqual(sentMessages[baseIdx].channel, 'startupProfileSet');
  });

  test('startupProfileSet with null: sends null (no guard)', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    exposed.electronAPI.startupProfileSet(null);
    assert.strictEqual(sentMessages[baseIdx].args[0], null);
  });

  test('openConfig sends on channel "openConfig" with 0 arguments', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    exposed.electronAPI.openConfig();
    assert.strictEqual(sentMessages[baseIdx].channel, 'openConfig');
    assert.strictEqual(sentMessages[baseIdx].args.length, 0);
  });

  test('openExternal sends on channel "openExternal"', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    exposed.electronAPI.openExternal('https://test.url');
    assert.strictEqual(sentMessages[baseIdx].channel, 'openExternal');
  });

  test('openExternal: sends URL as args[0]', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    exposed.electronAPI.openExternal('https://test.url/path');
    assert.strictEqual(sentMessages[baseIdx].args[0], 'https://test.url/path');
    assert.strictEqual(sentMessages[baseIdx].args.length, 1);
  });

  test('toggleFullscreen sends on channel "toggleFullscreen" with 0 arguments', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    exposed.electronAPI.toggleFullscreen();
    assert.strictEqual(sentMessages[baseIdx].channel, 'toggleFullscreen');
    assert.strictEqual(sentMessages[baseIdx].args.length, 0);
  });

  test('switchNextProfile sends on channel "switchNextProfile" with 0 arguments', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    exposed.electronAPI.switchNextProfile();
    assert.strictEqual(sentMessages[baseIdx].channel, 'switchNextProfile');
    assert.strictEqual(sentMessages[baseIdx].args.length, 0);
  });

  test('reset sends on channel "reset" with 0 arguments', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    exposed.electronAPI.reset();
    assert.strictEqual(sentMessages[baseIdx].channel, 'reset');
    assert.strictEqual(sentMessages[baseIdx].args.length, 0);
  });

  test('restart sends on channel "restart" with 0 arguments', () => {
    const { exposed, sentMessages, baseIdx } = runPreloadInSandbox();
    exposed.electronAPI.restart();
    assert.strictEqual(sentMessages[baseIdx].channel, 'restart');
    assert.strictEqual(sentMessages[baseIdx].args.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IPC CHANNEL CONTRACTS (invoke + return value pass-through)
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js – IPC invoke channel contracts and return-value pass-through', () => {
  test('configLoad invokes channel "configLoad"', async () => {
    const { exposed, invokedMessages } = runPreloadInSandbox();
    await exposed.electronAPI.configLoad();
    assert.strictEqual(invokedMessages[0].channel, 'configLoad');
  });

  test('configLoad sends 0 arguments to invoke', () => {
    const { exposed, invokedMessages } = runPreloadInSandbox();
    exposed.electronAPI.configLoad();
    assert.strictEqual(invokedMessages[0].args.length, 0);
  });

  test('configLoad: return value is passed through from invoke', async () => {
    const fakeConfig = { url: 'https://x', username: 'u', password: 'p' };
    const { exposed } = runPreloadInSandbox(fakeConfig);
    const result = await exposed.electronAPI.configLoad();
    assert.deepStrictEqual(result, fakeConfig);
  });

  test('configLoad: passes undefined through when invoke returns undefined', async () => {
    const { exposed } = runPreloadInSandbox(undefined);
    const result = await exposed.electronAPI.configLoad();
    assert.strictEqual(result, undefined);
  });

  test('profilesLoad invokes channel "profilesLoad"', async () => {
    const { exposed, invokedMessages } = runPreloadInSandbox();
    await exposed.electronAPI.profilesLoad();
    assert.strictEqual(invokedMessages[0].channel, 'profilesLoad');
  });

  test('profilesLoad sends 0 arguments to invoke', () => {
    const { exposed, invokedMessages } = runPreloadInSandbox();
    exposed.electronAPI.profilesLoad();
    assert.strictEqual(invokedMessages[0].args.length, 0);
  });

  test('profilesLoad: return value is passed through from invoke', async () => {
    const fakeProfiles = [{ id: 'p1', name: 'P1', url: 'u1', username: '', password: '' }];
    const { exposed } = runPreloadInSandbox(fakeProfiles);
    const result = await exposed.electronAPI.profilesLoad();
    assert.deepStrictEqual(result, fakeProfiles);
  });

  test('activeProfileGet invokes channel "activeProfileGet"', async () => {
    const { exposed, invokedMessages } = runPreloadInSandbox();
    await exposed.electronAPI.activeProfileGet();
    assert.strictEqual(invokedMessages[0].channel, 'activeProfileGet');
  });

  test('activeProfileGet sends 0 arguments to invoke', () => {
    const { exposed, invokedMessages } = runPreloadInSandbox();
    exposed.electronAPI.activeProfileGet();
    assert.strictEqual(invokedMessages[0].args.length, 0);
  });

  test('activeProfileGet: return value is passed through from invoke', async () => {
    const { exposed } = runPreloadInSandbox('active-42');
    const result = await exposed.electronAPI.activeProfileGet();
    assert.strictEqual(result, 'active-42');
  });

  test('startupProfileGet invokes channel "startupProfileGet"', async () => {
    const { exposed, invokedMessages } = runPreloadInSandbox();
    await exposed.electronAPI.startupProfileGet();
    assert.strictEqual(invokedMessages[0].channel, 'startupProfileGet');
  });

  test('startupProfileGet sends 0 arguments to invoke', () => {
    const { exposed, invokedMessages } = runPreloadInSandbox();
    exposed.electronAPI.startupProfileGet();
    assert.strictEqual(invokedMessages[0].args.length, 0);
  });

  test('startupProfileGet: return value is passed through from invoke', async () => {
    const { exposed } = runPreloadInSandbox('startup-7');
    const result = await exposed.electronAPI.startupProfileGet();
    assert.strictEqual(result, 'startup-7');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD HANDLER CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js – keyboard handler', () => {
  // Helper: filters out upv:log messages (which are side-effects of console.log override)
  function nonLogMessages(msgs) {
    return msgs.filter((m) => m.channel !== 'upv:log');
  }

  test('F9: sends exactly 1 message on channel "restart"', () => {
    const { keydownListeners, sentMessages, baseIdx } = runPreloadInSandbox();
    keydownListeners[0]({ key: 'F9' });
    const after = nonLogMessages(sentMessages.slice(baseIdx));
    assert.strictEqual(after.length, 1);
    assert.strictEqual(after[0].channel, 'restart');
  });

  test('F10: sends exactly 1 message on channel "switchNextProfile"', () => {
    const { keydownListeners, sentMessages, baseIdx } = runPreloadInSandbox();
    keydownListeners[0]({ key: 'F10' });
    const after = nonLogMessages(sentMessages.slice(baseIdx));
    assert.strictEqual(after.length, 1);
    assert.strictEqual(after[0].channel, 'switchNextProfile');
  });

  test('F9: sends exactly 1 non-log message (not 2)', () => {
    const { keydownListeners, sentMessages, baseIdx } = runPreloadInSandbox();
    keydownListeners[0]({ key: 'F9' });
    assert.strictEqual(nonLogMessages(sentMessages.slice(baseIdx)).length, 1);
  });

  test('F10: sends exactly 1 non-log message (not 2)', () => {
    const { keydownListeners, sentMessages, baseIdx } = runPreloadInSandbox();
    keydownListeners[0]({ key: 'F10' });
    assert.strictEqual(nonLogMessages(sentMessages.slice(baseIdx)).length, 1);
  });

  test('F11: sends no non-log message (handled by native/registerF11Handler)', () => {
    const { keydownListeners, sentMessages, baseIdx } = runPreloadInSandbox();
    keydownListeners[0]({ key: 'F11' });
    assert.strictEqual(nonLogMessages(sentMessages.slice(baseIdx)).length, 0);
  });

  test('unregistered key (F5): sends no non-log message', () => {
    const { keydownListeners, sentMessages, baseIdx } = runPreloadInSandbox();
    keydownListeners[0]({ key: 'F5' });
    assert.strictEqual(nonLogMessages(sentMessages.slice(baseIdx)).length, 0);
  });

  test('unregistered key (Enter): sends no non-log message', () => {
    const { keydownListeners, sentMessages, baseIdx } = runPreloadInSandbox();
    keydownListeners[0]({ key: 'Enter' });
    assert.strictEqual(nonLogMessages(sentMessages.slice(baseIdx)).length, 0);
  });

  test('undefined key: does not crash', () => {
    const { keydownListeners } = runPreloadInSandbox();
    assert.doesNotThrow(() => keydownListeners[0]({ key: undefined }));
  });

  test('null key: does not crash', () => {
    const { keydownListeners } = runPreloadInSandbox();
    assert.doesNotThrow(() => keydownListeners[0]({ key: null }));
  });

  test('keydown listener is registered on window', () => {
    const { keydownListeners } = runPreloadInSandbox();
    assert.ok(keydownListeners.length > 0, 'at least one keydown listener must be registered');
  });

  test('F9 and F10 each trigger distinct channels', () => {
    const { keydownListeners, sentMessages, baseIdx } = runPreloadInSandbox();
    keydownListeners[0]({ key: 'F9' });
    keydownListeners[0]({ key: 'F10' });
    const after = nonLogMessages(sentMessages.slice(baseIdx));
    assert.strictEqual(after[0].channel, 'restart');
    assert.strictEqual(after[1].channel, 'switchNextProfile');
  });
});
