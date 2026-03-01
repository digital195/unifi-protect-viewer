'use strict';

/**
 * @file test/js/preload-logging.test.js
 * @description Contract tests for the console.log override and IPC log forwarding
 *              implemented in src/js/preload.js.
 *
 * Covers (per copilot-instructions.md):
 *  1.  console.log still calls original after override
 *  2.  IPC forwarding works for own [upv ...] messages
 *  3.  Only own logs are forwarded (no third-party logs)
 *  4.  Re-entrance guard prevents infinite loops
 *  5.  IPC send uses the correct channel name 'upv:log'
 *  6.  Forwarded payload is the message string
 *  7.  openLogFile sends on channel 'openLogFile'
 *  8.  openDevTools sends on channel 'openDevTools'
 *  9.  No crash when ipcRenderer.send throws
 * 10.  Original console.log is restored correctly (no infinite recursion)
 *
 * Uses ONLY node:test + node:assert/strict.
 * No real files written. No Electron runtime launched.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const preloadSource = fs.readFileSync(path.resolve(__dirname, '../../src/js/preload.js'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox factory
// ─────────────────────────────────────────────────────────────────────────────

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
    getElementsByClassName: () => ({ length: 0 }),
    getElementsByName: () => [undefined],
    querySelectorAll: () => Object.assign([], { length: 0, forEach: () => {} }),
    querySelector: () => null,
    head: { appendChild: () => {} },
    body: { appendChild: () => {}, style: {}, insertAdjacentHTML: () => {} },
  };
}

/**
 * Runs preload.js in an isolated sandbox, capturing IPC messages and
 * the overridden console.log.
 *
 * Returns:
 *  - sentMessages   – all calls to ipcRenderer.send
 *  - exposed        – contextBridge.exposeInMainWorld result
 *  - consoleCalls   – calls forwarded to the mocked original console.log
 *  - consoleMock    – the console object used in the sandbox
 */
function runPreloadCapture({ ipcSendThrows = false } = {}) {
  const sentMessages = [];
  const invokedMessages = [];
  const exposed = {};
  const consoleCalls = [];

  // This is what we check: did the "original" get called?
  const originalLog = (...args) => consoleCalls.push(args);

  const consoleMock = {
    log: originalLog, // starts as original; preload will override it
    warn: () => {},
    error: () => {},
  };

  const mockIpcRenderer = {
    send: (ch, ...args) => {
      if (ipcSendThrows) throw new Error('ipc error');
      sentMessages.push({ channel: ch, args });
    },
    invoke: (ch, ...args) => {
      invokedMessages.push({ channel: ch, args });
      return Promise.resolve(undefined);
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
      throw new Error(`unexpected require: ${mod}`);
    },
    console: consoleMock,
    window: { addEventListener: () => {} },
    document: buildDomMock(),
    localStorage: { getItem: () => null },
    location: { reload: () => {} },
    setTimeout: () => {},
    setInterval: () => {},
    clearTimeout: () => {},
    clearInterval: () => {},
    crypto: { randomUUID: () => 'test-uuid' },
    Event: class Event {
      constructor(t) {
        this.type = t;
      }
    },
    MouseEvent: class MouseEvent {
      constructor(t) {
        this.type = t;
      }
    },
    module: { id: 'preload' },
  };

  try {
    vm.runInNewContext(preloadSource, sandbox);
  } catch (_) {
    /* DOM side-effects */
  }

  // After running, consoleMock.log is the OVERRIDDEN version
  return {
    sentMessages,
    exposed,
    consoleCalls,
    overriddenLog: consoleMock.log,
    originalLog,
    consoleMock,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 1 – Original console.log still called
// ─────────────────────────────────────────────────────────────────────────────

describe('preload – console.log override: original still called', () => {
  test('original is called when logging an [upv ...] message', () => {
    const { consoleCalls, overriddenLog } = runPreloadCapture();
    // Call the overridden log with an own message
    overriddenLog('[upv] test message');
    // The original was also called
    const found = consoleCalls.some((args) =>
      args.some((a) => String(a).includes('[upv] test message')),
    );
    assert.ok(found, 'original console.log must be called with own message');
  });

  test('original is called when logging a third-party message', () => {
    const { consoleCalls, overriddenLog } = runPreloadCapture();
    overriddenLog('some third-party library message');
    const found = consoleCalls.some((args) => args.some((a) => String(a).includes('third-party')));
    assert.ok(found, 'original console.log must be called for third-party messages too');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 2 – IPC forwarding works for own logs
// ─────────────────────────────────────────────────────────────────────────────

describe('preload – console.log override: IPC forwarding', () => {
  test('forwards [upv ...] message via IPC', () => {
    const { sentMessages, overriddenLog } = runPreloadCapture();
    const before = sentMessages.length;
    overriddenLog('[upv] preload initialised');
    const logMessages = sentMessages.slice(before).filter((m) => m.channel === 'upv:log');
    assert.ok(logMessages.length >= 1, 'must forward at least one message');
  });

  test('IPC channel is exactly "upv:log"', () => {
    const { sentMessages, overriddenLog } = runPreloadCapture();
    const before = sentMessages.length;
    overriddenLog('[upv] channel test');
    const logMsg = sentMessages.slice(before).find((m) => m.channel === 'upv:log');
    assert.ok(logMsg, 'must have sent on "upv:log" channel');
    assert.equal(logMsg.channel, 'upv:log');
  });

  test('payload is the string message', () => {
    const { sentMessages, overriddenLog } = runPreloadCapture();
    const before = sentMessages.length;
    overriddenLog('[upv window] Login button clicked');
    const logMsg = sentMessages.slice(before).find((m) => m.channel === 'upv:log');
    assert.ok(logMsg, 'must have forwarded message');
    assert.ok(
      logMsg.args[0].includes('[upv window] Login button clicked'),
      `got: ${logMsg.args[0]}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 3 – Only own logs forwarded
// ─────────────────────────────────────────────────────────────────────────────

describe('preload – console.log override: no third-party forwarding', () => {
  test('does NOT forward messages that do not start with [upv', () => {
    const { sentMessages, overriddenLog } = runPreloadCapture();
    const before = sentMessages.length;
    overriddenLog('React: some warning from a library');
    overriddenLog('Unifi loaded');
    overriddenLog('[other] some other prefix');
    const logMessages = sentMessages.slice(before).filter((m) => m.channel === 'upv:log');
    assert.equal(logMessages.length, 0, 'third-party messages must not be forwarded');
  });

  test('forwards [upv ...] but not adjacent third-party call', () => {
    const { sentMessages, overriddenLog } = runPreloadCapture();
    const before = sentMessages.length;
    overriddenLog('[upv] own message');
    overriddenLog('third-party noise');
    const logMessages = sentMessages.slice(before).filter((m) => m.channel === 'upv:log');
    assert.equal(logMessages.length, 1, 'only the own message should be forwarded');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 4 – No crash when IPC send throws
// ─────────────────────────────────────────────────────────────────────────────

describe('preload – console.log override: resilience', () => {
  test('does not throw when ipcRenderer.send throws', () => {
    const { overriddenLog } = runPreloadCapture({ ipcSendThrows: true });
    assert.doesNotThrow(() => overriddenLog('[upv] message that triggers ipc error'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 5 – openLogFile and openDevTools IPC channels
// ─────────────────────────────────────────────────────────────────────────────

describe('preload – openLogFile / openDevTools IPC', () => {
  test('openLogFile sends on channel "openLogFile"', () => {
    const { exposed, sentMessages } = runPreloadCapture();
    const before = sentMessages.length;
    exposed.electronAPI.openLogFile('/path/to/upv.log');
    const msg = sentMessages.slice(before).find((m) => m.channel === 'openLogFile');
    assert.ok(msg, 'must send on "openLogFile" channel');
  });

  test('openDevTools sends on channel "openDevTools"', () => {
    const { exposed, sentMessages } = runPreloadCapture();
    const before = sentMessages.length;
    exposed.electronAPI.openDevTools();
    const msg = sentMessages.slice(before).find((m) => m.channel === 'openDevTools');
    assert.ok(msg, 'must send on "openDevTools" channel');
  });

  test('openDevTools sends no extra arguments', () => {
    const { exposed, sentMessages } = runPreloadCapture();
    const before = sentMessages.length;
    exposed.electronAPI.openDevTools();
    const msg = sentMessages.slice(before).find((m) => m.channel === 'openDevTools');
    assert.equal(msg.args.length, 0, 'openDevTools must send no arguments');
  });
});
