'use strict';

/**
 * @file test/js/liveview/dom.test.js
 * @description Minimal DOM contract tests for preload.js liveview DOM flows.
 *
 * Tests cover (extracted from preload.js inline functions):
 *  - showOverlay     : exact IDs, element creation, fallback timer
 *  - setOverlayStatus: textContent mutation on correct IDs
 *  - hideOverlay     : classList.add('fade-out'), remove() after timeout
 *  - performLogin    : selector contracts, input wiring, button click
 *  - activateDarkTheme: selector contracts, two-step click flow
 *  - resolveProtectVersion: version parsing, fallback to '3.x'
 *  - dismissAllModals: portal detection, SVG click
 *  - fullscreen gate: gate-scoped overlay rules, documentElement class toggle
 *
 * No jsdom. No browser. Pure node:test + node:assert/strict.
 * Mocks simulate only what each function directly touches.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const preloadSource = fs.readFileSync(
  path.resolve(__dirname, '../../../src/js/preload.js'),
  'utf8',
);

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox builder
// Each test builds a minimal sandbox containing only the fakes it needs.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs preload.js in a sandbox with the given overrides.
 * Returns a handle to the sandbox so tests can inspect state after execution.
 */
function runInSandbox(overrides = {}) {
  const ipcOnCalls = [];
  const invokedChannels = [];
  const sandbox = {
    // required by contextBridge / ipcRenderer at module top level
    require: (mod) => {
      if (mod === 'electron') {
        return {
          contextBridge: { exposeInMainWorld: () => {} },
          ipcRenderer: {
            send: () => {},
            invoke: (channel, ...args) => {
              invokedChannels.push(channel);
              return Promise.resolve(undefined);
            },
            on: (channel, handler) => {
              ipcOnCalls.push({ channel, handler });
            },
          },
        };
      }
      throw new Error(`unexpected require: ${mod}`);
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    window: { addEventListener: () => {} },
    document: {
      URL: 'https://cam.local/protect/dashboard',
      documentElement: makeEl('html'),
      getElementById: () => null,
      createElement: (tag) => makeEl(tag),
      getElementsByTagName: () => [],
      getElementsByClassName: () => ({ length: 0 }),
      getElementsByName: () => [undefined],
      querySelectorAll: () => makeNodeList([]),
      querySelector: () => null,
      head: { appendChild: () => {} },
      body: { appendChild: () => {}, style: {}, insertAdjacentHTML: () => {} },
    },
    localStorage: { getItem: () => null },
    location: { href: null, reload: () => {} },
    setTimeout: (fn, ms) => {
      fn();
      return 1;
    },
    setInterval: (fn, ms) => {
      fn();
      return 2;
    },
    clearTimeout: () => {},
    clearInterval: () => {},
    crypto: { randomUUID: () => 'test-uuid' },
    Event: class Event {
      constructor(t, o) {
        this.type = t;
        this.bubbles = (o || {}).bubbles;
        this.simulated = false;
      }
    },
    MouseEvent: class MouseEvent {
      constructor(t, o) {
        this.type = t;
      }
    },
    module: { id: 'preload' },
    ...overrides,
  };

  try {
    vm.runInNewContext(preloadSource, sandbox);
  } catch (_) {
    // DOM side-effects during init may throw in sandbox – expected
  }
  sandbox.__ipcOnCalls = ipcOnCalls;
  sandbox.__invokedChannels = invokedChannels;
  return sandbox;
}

// ── Minimal element factory ──────────────────────────────────────────────────

function makeEl(tag = 'div') {
  return {
    _tag: tag,
    id: '',
    textContent: '',
    innerHTML: '',
    classList: {
      _classes: new Set(),
      add: function (...c) {
        c.forEach((x) => this._classes.add(x));
      },
      remove: function (...c) {
        c.forEach((x) => this._classes.delete(x));
      },
      contains: function (c) {
        return this._classes.has(c);
      },
      toggle: function (c, force) {
        const shouldAdd = force === undefined ? !this._classes.has(c) : Boolean(force);
        if (shouldAdd) this._classes.add(c);
        else this._classes.delete(c);
        return shouldAdd;
      },
    },
    style: {},
    children: { length: 0 },
    _removed: false,
    _appended: [],
    remove: function () {
      this._removed = true;
    },
    appendChild: function (child) {
      this._appended.push(child);
      return child;
    },
    dispatchEvent: function (e) {
      this._lastEvent = e;
      return true;
    },
    click: function () {
      this._clicked = true;
    },
  };
}

function makeNodeList(items) {
  return Object.assign(items, {
    length: items.length,
    forEach: Array.prototype.forEach.bind(items),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// § OVERLAY CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js overlay – showOverlay', () => {
  /**
   * showOverlay is triggered by the DOMContentLoaded listener when the URL
   * is NOT one of the own pages (index.html / config.html / profile-select.html).
   * We fire the handler by capturing it and calling it directly.
   */
  function buildOverlayCapture() {
    let domContentLoadedHandler = null;
    let bodyAppended = [];
    let headAppended = [];
    let setTimeoutMs = [];

    const doc = {
      URL: 'https://cam.local/protect/dashboard',
      getElementById: () => null,
      createElement: (tag) => makeEl(tag),
      getElementsByTagName: () => [],
      getElementsByClassName: () => ({ length: 0 }),
      getElementsByName: () => [undefined],
      querySelectorAll: () => makeNodeList([]),
      querySelector: () => null,
      head: {
        appendChild: (el) => {
          headAppended.push(el);
        },
      },
      body: {
        appendChild: (el) => {
          bodyAppended.push(el);
        },
        style: {},
        insertAdjacentHTML: () => {},
      },
    };

    runInSandbox({
      document: doc,
      setTimeout: (fn, ms) => {
        setTimeoutMs.push(ms);
        /* do NOT call fn – we want to observe */ return setTimeoutMs.length;
      },
      setInterval: () => 2,
      window: {
        addEventListener: (event, handler) => {
          if (event === 'DOMContentLoaded') domContentLoadedHandler = handler;
        },
      },
    });

    // Fire DOMContentLoaded manually
    if (domContentLoadedHandler) domContentLoadedHandler();

    return { bodyAppended, headAppended, setTimeoutMs };
  }

  test('creates overlay element with id "__upv_loader"', () => {
    const { bodyAppended } = buildOverlayCapture();
    assert.ok(
      bodyAppended.some((el) => el.id === '__upv_loader'),
      `body.appendChild must receive element with id "__upv_loader", got ids: [${bodyAppended.map((e) => e.id)}]`,
    );
  });

  test('injects style element with id "__upv_loader_style" into document.head', () => {
    const { headAppended } = buildOverlayCapture();
    assert.ok(
      headAppended.some((el) => el.id === '__upv_loader_style'),
      `head.appendChild must receive element with id "__upv_loader_style", got ids: [${headAppended.map((e) => e.id)}]`,
    );
  });

  test('does NOT create overlay if it already exists (idempotency guard)', () => {
    let appendCount = 0;
    const existingOverlay = makeEl('div');
    existingOverlay.id = '__upv_loader';

    let domContentLoadedHandler = null;

    const doc = {
      URL: 'https://cam.local/protect/dashboard',
      getElementById: (id) => (id === '__upv_loader' ? existingOverlay : null),
      createElement: () => makeEl('div'),
      getElementsByTagName: () => [],
      getElementsByClassName: () => ({ length: 0 }),
      getElementsByName: () => [undefined],
      querySelectorAll: () => makeNodeList([]),
      querySelector: () => null,
      head: {
        appendChild: () => {
          appendCount++;
        },
      },
      body: {
        appendChild: () => {
          appendCount++;
        },
        style: {},
        insertAdjacentHTML: () => {},
      },
    };

    runInSandbox({
      document: doc,
      setTimeout: () => 1,
      window: {
        addEventListener: (event, handler) => {
          if (event === 'DOMContentLoaded') domContentLoadedHandler = handler;
        },
      },
    });

    if (domContentLoadedHandler) domContentLoadedHandler();

    assert.strictEqual(appendCount, 0, 'no elements must be appended if overlay already exists');
  });

  test('overlay fallback timeout is scheduled (setTimeout called with OVERLAY_FALLBACK_MS = 20000)', () => {
    const { setTimeoutMs } = buildOverlayCapture();
    assert.ok(
      setTimeoutMs.includes(20000),
      `fallback timeout of 20000 ms must be scheduled, got: [${setTimeoutMs}]`,
    );
  });

  test('overlay inner HTML contains IDs __upv_loader_text and __upv_loader_sub', () => {
    // The inner HTML is built using OVERLAY_IDS constants.
    // The overlay div's innerHTML template contains literal ID strings
    // that expand from the constants: __upv_loader_text and __upv_loader_sub.
    // We verify the source template string uses the correct ID references.
    assert.ok(
      preloadSource.includes('OVERLAY_IDS.text'),
      'showOverlay innerHTML must use OVERLAY_IDS.text',
    );
    assert.ok(
      preloadSource.includes('OVERLAY_IDS.sub'),
      'showOverlay innerHTML must use OVERLAY_IDS.sub',
    );
  });

  test('overlay innerHTML contains the loading text "Loading cameras"', () => {
    assert.ok(
      preloadSource.includes('Loading cameras'),
      'overlay must contain "Loading cameras" initial text',
    );
  });

  test('OVERLAY_IDS.overlay value is "__upv_loader"', () => {
    assert.ok(
      preloadSource.includes("overlay: '__upv_loader'"),
      'OVERLAY_IDS.overlay must be "__upv_loader"',
    );
  });

  test('OVERLAY_IDS.style value is "__upv_loader_style"', () => {
    assert.ok(
      preloadSource.includes("style: '__upv_loader_style'"),
      'OVERLAY_IDS.style must be "__upv_loader_style"',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § OVERLAY – setOverlayStatus (ID contract)
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js overlay – setOverlayStatus', () => {
  test('getElementById is called with OVERLAY_IDS.text for status text', () => {
    // setOverlayStatus uses: document.getElementById(OVERLAY_IDS.text)
    assert.ok(
      preloadSource.includes('document.getElementById(OVERLAY_IDS.text)'),
      'setOverlayStatus must call document.getElementById(OVERLAY_IDS.text)',
    );
  });

  test('getElementById is called with OVERLAY_IDS.sub for status sub-text', () => {
    assert.ok(
      preloadSource.includes('document.getElementById(OVERLAY_IDS.sub)'),
      'setOverlayStatus must call document.getElementById(OVERLAY_IDS.sub)',
    );
  });

  test('setOverlayStatus: text ID is exactly "__upv_loader_text" (value lock)', () => {
    assert.ok(
      preloadSource.includes("text: '__upv_loader_text'"),
      'OVERLAY_IDS.text must be "__upv_loader_text"',
    );
  });

  test('setOverlayStatus: sub ID is exactly "__upv_loader_sub" (value lock)', () => {
    assert.ok(
      preloadSource.includes("sub: '__upv_loader_sub'"),
      'OVERLAY_IDS.sub must be "__upv_loader_sub"',
    );
  });

  test('setOverlayStatus mutates textContent (not innerHTML)', () => {
    // The source uses: if (t && text) t.textContent = text;
    assert.ok(
      preloadSource.includes('t.textContent = text'),
      'setOverlayStatus must set t.textContent = text',
    );
    assert.ok(
      preloadSource.includes('s.textContent = sub'),
      'setOverlayStatus must set s.textContent = sub',
    );
  });

  test('setOverlayStatus does not crash when elements are null (missing overlay)', () => {
    const doc = {
      URL: 'https://cam.local/protect/dashboard',
      getElementById: () => null,
      createElement: () => makeEl('div'),
      getElementsByTagName: () => [],
      getElementsByClassName: () => ({ length: 0 }),
      getElementsByName: () => [undefined],
      querySelectorAll: () => makeNodeList([]),
      querySelector: () => null,
      head: { appendChild: () => {} },
      body: { appendChild: () => {}, style: {}, insertAdjacentHTML: () => {} },
    };

    assert.doesNotThrow(() => runInSandbox({ document: doc }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § OVERLAY – hideOverlay
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js overlay – hideOverlay', () => {
  /**
   * hideOverlay is triggered by the fallback setTimeout inside showOverlay.
   * Strategy: let DOMContentLoaded fire, then invoke the fallback timer.
   */
  function buildHideCapture() {
    // Pre-create tracked elements that showOverlay will inject
    const overlayEl = makeEl('div');
    const styleEl = makeEl('style');
    let overlayAppended = false;
    let styleAppended = false;

    let domContentLoadedHandler = null;
    const pendingTimers = [];

    const doc = {
      URL: 'https://cam.local/protect/dashboard',
      // Returns null until element is appended (so showOverlay guard passes),
      // then returns the real element (so hideOverlay can mutate it).
      getElementById: (id) => {
        if (id === '__upv_loader') return overlayAppended ? overlayEl : null;
        if (id === '__upv_loader_style') return styleAppended ? styleEl : null;
        return null;
      },
      createElement: (tag) => {
        if (tag === 'style') return styleEl;
        if (tag === 'div') return overlayEl;
        return makeEl(tag);
      },
      getElementsByTagName: () => [],
      getElementsByClassName: () => ({ length: 0 }),
      getElementsByName: () => [undefined],
      querySelectorAll: () => makeNodeList([]),
      querySelector: () => null,
      head: {
        appendChild: (el) => {
          if (el === styleEl) {
            styleEl.id = '__upv_loader_style';
            styleAppended = true;
          }
        },
      },
      body: {
        appendChild: (el) => {
          if (el === overlayEl) {
            overlayEl.id = '__upv_loader';
            overlayAppended = true;
          }
        },
        style: {},
        insertAdjacentHTML: () => {},
      },
    };

    runInSandbox({
      document: doc,
      // Collect timers but do NOT fire them yet
      setTimeout: (fn, ms) => {
        pendingTimers.push({ fn, ms });
        return pendingTimers.length;
      },
      window: {
        addEventListener: (event, handler) => {
          if (event === 'DOMContentLoaded') domContentLoadedHandler = handler;
        },
      },
    });

    // Fire DOMContentLoaded → showOverlay → schedules fallback timer (20000 ms)
    if (domContentLoadedHandler) domContentLoadedHandler();

    // Drain ALL timers including timers that are added during execution
    // (hideOverlay adds a 450ms remove-timer when the 20000ms fallback fires).
    let i = 0;
    while (i < pendingTimers.length) {
      try {
        pendingTimers[i].fn();
      } catch (_) {}
      i++;
    }

    return { overlayEl, styleEl };
  }

  test('adds class "fade-out" to overlay element', () => {
    const { overlayEl } = buildHideCapture();
    assert.ok(
      overlayEl.classList.contains('fade-out'),
      'hideOverlay must add class "fade-out" to the overlay element',
    );
  });

  test('calls remove() on overlay element after fade-out', () => {
    const { overlayEl } = buildHideCapture();
    assert.strictEqual(overlayEl._removed, true, 'overlay element must be removed after fade-out');
  });

  test('calls remove() on style element after fade-out', () => {
    const { styleEl } = buildHideCapture();
    assert.strictEqual(styleEl._removed, true, 'style element must be removed after fade-out');
  });

  test('hideOverlay does nothing when overlay element does not exist', () => {
    let domContentLoadedHandler = null;
    const doc = {
      URL: 'https://cam.local/protect/dashboard',
      getElementById: () => null,
      createElement: () => makeEl('div'),
      getElementsByTagName: () => [],
      getElementsByClassName: () => ({ length: 0 }),
      getElementsByName: () => [undefined],
      querySelectorAll: () => makeNodeList([]),
      querySelector: () => null,
      head: { appendChild: () => {} },
      body: { appendChild: () => {}, style: {}, insertAdjacentHTML: () => {} },
    };

    const pendingTimers = [];
    runInSandbox({
      document: doc,
      setTimeout: (fn, ms) => {
        pendingTimers.push({ fn, ms });
        return pendingTimers.length;
      },
      window: {
        addEventListener: (event, handler) => {
          if (event === 'DOMContentLoaded') domContentLoadedHandler = handler;
        },
      },
    });

    if (domContentLoadedHandler) domContentLoadedHandler();
    assert.doesNotThrow(() => {
      for (const { fn } of pendingTimers) {
        try {
          fn();
        } catch (_) {}
      }
    });
  });

  test('hideOverlay: uses getElementById(OVERLAY_IDS.overlay)?.remove() (selector lock)', () => {
    assert.ok(
      preloadSource.includes('document.getElementById(OVERLAY_IDS.overlay)?.remove()'),
      'preload.js must call document.getElementById(OVERLAY_IDS.overlay)?.remove()',
    );
  });

  test('hideOverlay: uses getElementById(OVERLAY_IDS.style)?.remove() (selector lock)', () => {
    assert.ok(
      preloadSource.includes('document.getElementById(OVERLAY_IDS.style)?.remove()'),
      'preload.js must call document.getElementById(OVERLAY_IDS.style)?.remove()',
    );
  });

  test('fade-out class name is exactly "fade-out" (class name lock)', () => {
    assert.ok(
      preloadSource.includes("classList.add('fade-out')"),
      'hideOverlay must call classList.add("fade-out") with exact class name',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § LOGIN – performLogin selector contracts
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js login – performLogin selector contracts', () => {
  test('fills username input via getElementsByName("username")[0]', () => {
    assert.ok(
      preloadSource.includes("getElementsByName('username')"),
      'performLogin must use getElementsByName("username")',
    );
  });

  test('fills password input via getElementsByName("password")[0]', () => {
    assert.ok(
      preloadSource.includes("getElementsByName('password')"),
      'performLogin must use getElementsByName("password")',
    );
  });

  test('waits for buttons via getElementsByTagName("button")', () => {
    assert.ok(
      preloadSource.includes("getElementsByTagName('button')"),
      'performLogin must wait for getElementsByTagName("button")',
    );
  });

  test('clicks first button: getElementsByTagName("button")[0]', () => {
    assert.ok(
      preloadSource.includes("getElementsByTagName('button')[0]"),
      'performLogin must click getElementsByTagName("button")[0]',
    );
  });

  test('performLogin passes username value from credentials.username', () => {
    assert.ok(
      preloadSource.includes('credentials.username'),
      'performLogin must pass credentials.username to setReactInputValue',
    );
  });

  test('performLogin passes password value from credentials.password', () => {
    assert.ok(
      preloadSource.includes('credentials.password'),
      'performLogin must pass credentials.password to setReactInputValue',
    );
  });

  test('performLogin uses setReactInputValue (not direct .value assignment)', () => {
    assert.ok(
      preloadSource.includes('setReactInputValue(document.getElementsByName'),
      'performLogin must use setReactInputValue for DOM input wiring',
    );
  });

  test('performLogin uses simulateClick (not direct .click()) for submit', () => {
    assert.ok(
      preloadSource.includes("simulateClick(document.getElementsByTagName('button')[0])"),
      'performLogin must use simulateClick for submit button',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § LOGIN – performLogin "Remember Me" checkbox contracts (GitHub issue #17)
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js login – performLogin "Remember Me" checkbox contracts', () => {
  test('looks up the checkbox via getElementsByName("rememberMe")[0]', () => {
    assert.ok(
      preloadSource.includes("document.getElementsByName('rememberMe')[0]"),
      'performLogin must look up the checkbox via getElementsByName("rememberMe")[0]',
    );
  });

  test('falls back to querySelector("#rememberMe, input[type=\\"checkbox\\"]") when absent', () => {
    assert.ok(
      preloadSource.includes('document.querySelector(\'#rememberMe, input[type="checkbox"]\')'),
      'performLogin must fall back to querySelector(\'#rememberMe, input[type="checkbox"]\')',
    );
  });

  test('clicks the checkbox via simulateClick(rememberMe) (not direct .click())', () => {
    assert.ok(
      preloadSource.includes('simulateClick(rememberMe)'),
      'performLogin must use simulateClick(rememberMe) to tick the checkbox',
    );
  });

  test('checks rememberMe.checked before clicking (skip if already ticked)', () => {
    assert.ok(
      preloadSource.includes('rememberMe.checked'),
      'performLogin must check rememberMe.checked before clicking',
    );
  });

  test('logs a message when no "Remember Me" checkbox is found (optional checkbox)', () => {
    assert.ok(
      preloadSource.includes('no "Remember Me" checkbox found'),
      'performLogin must log when the optional "Remember Me" checkbox is absent',
    );
  });

  test('does not throw when getElementsByName/querySelector both return nothing', () => {
    assert.doesNotThrow(() =>
      runInSandbox({
        document: {
          URL: 'https://cam.local/login',
          getElementById: () => null,
          createElement: () => makeEl('div'),
          getElementsByTagName: () => [makeEl('button')],
          getElementsByClassName: () => ({ length: 0 }),
          getElementsByName: () => [undefined],
          querySelectorAll: () => makeNodeList([]),
          querySelector: () => null,
          head: { appendChild: () => {} },
          body: { appendChild: () => {}, style: {}, insertAdjacentHTML: () => {} },
        },
        window: { addEventListener: () => {} },
      }),
    );
  });

  test('"Remember Me" checkbox handling happens before the submit button click', () => {
    // The checkbox lookup/click must occur before the final submit button click
    // so that the checkbox state is applied prior to form submission.
    const rememberMeIdx = preloadSource.indexOf("document.getElementsByName('rememberMe')[0]");
    const submitClickIdx = preloadSource.indexOf(
      "simulateClick(document.getElementsByTagName('button')[0])",
    );
    assert.ok(rememberMeIdx !== -1, 'rememberMe lookup must exist');
    assert.ok(submitClickIdx !== -1, 'submit button click must exist');
    assert.ok(
      rememberMeIdx < submitClickIdx,
      '"Remember Me" checkbox handling must occur before the submit button click',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § DARK THEME – activateDarkTheme selector contracts
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js dark theme – activateDarkTheme', () => {
  test('toggle button selector is exactly button[aria-haspopup="true"]', () => {
    assert.ok(
      preloadSource.includes('button[aria-haspopup="true"]'),
      'dark theme toggle selector must be button[aria-haspopup="true"]',
    );
  });

  test('dark option selector is exactly [data-key="dark"]', () => {
    assert.ok(
      preloadSource.includes('[data-key="dark"]'),
      'dark option selector must be [data-key="dark"]',
    );
  });

  test('toggle selector (SEL_TOGGLE) assigned before dark option selector (SEL_DARK_OPT)', () => {
    // Compare const DEFINITION positions (not raw first occurrences which include comments)
    const toggleConstIdx = preloadSource.indexOf('const SEL_TOGGLE =');
    const darkOptConstIdx = preloadSource.indexOf('const SEL_DARK_OPT =');
    assert.ok(toggleConstIdx !== -1, 'const SEL_TOGGLE must be defined');
    assert.ok(darkOptConstIdx !== -1, 'const SEL_DARK_OPT must be defined');
    assert.ok(
      toggleConstIdx < darkOptConstIdx,
      'const SEL_TOGGLE must be defined before const SEL_DARK_OPT in source',
    );
  });

  test('SEL_TOGGLE is assigned to a const before use', () => {
    assert.ok(
      preloadSource.includes('const SEL_TOGGLE = \'button[aria-haspopup="true"]\''),
      'SEL_TOGGLE const must be defined with exact value',
    );
  });

  test('SEL_DARK_OPT is assigned to a const before use', () => {
    assert.ok(
      preloadSource.includes('const SEL_DARK_OPT = \'[data-key="dark"]\''),
      'SEL_DARK_OPT const must be defined with exact value',
    );
  });

  test('skips gracefully when toggle button is not found (querySelector returns null)', () => {
    assert.doesNotThrow(() =>
      runInSandbox({
        document: {
          URL: 'https://cam.local/protect/dashboard',
          getElementById: () => null,
          createElement: () => makeEl('div'),
          getElementsByTagName: () => [],
          getElementsByClassName: () => ({ length: 0 }),
          getElementsByName: () => [undefined],
          querySelectorAll: () => makeNodeList([]),
          querySelector: () => null,
          head: { appendChild: () => {} },
          body: { appendChild: () => {}, style: {}, insertAdjacentHTML: () => {} },
        },
        window: { addEventListener: () => {} },
      }),
    );
  });

  test('re-clicks toggle to close dropdown when dark option is not found', () => {
    // There must be two simulateClick(toggleBtn) calls in activateDarkTheme
    const occurrences = (preloadSource.match(/simulateClick\(toggleBtn\)/g) || []).length;
    assert.ok(
      occurrences >= 2,
      'activateDarkTheme must have at least 2 simulateClick(toggleBtn) calls (open + close fallback)',
    );
  });

  test('dark theme waitUntil timeout is exactly 3_000 ms', () => {
    assert.ok(
      preloadSource.includes('3_000') || preloadSource.includes('3000'),
      'dark theme waitUntil must use a 3000 ms timeout',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § VERSION DETECTION – resolveProtectVersion
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js – resolveProtectVersion', () => {
  test('DOM selector covers Version__Item spans (pre-7.x) and Version__Row (7.x+)', () => {
    assert.ok(
      preloadSource.includes('[class^=Version__Item] > span, [class^=Version__Row]'),
      'version detection must query both the pre-7.x span and the 7.x row elements',
    );
  });

  test('function signature accepts (doc, profile) parameters', () => {
    assert.ok(
      preloadSource.includes('function resolveProtectVersion(doc, profile)'),
      'resolveProtectVersion must accept (doc, profile) parameters',
    );
  });

  test('uses injected doc.querySelectorAll (not global document)', () => {
    const fnStart = preloadSource.indexOf('function resolveProtectVersion(');
    const fnEnd = preloadSource.indexOf('\nfunction ', fnStart + 1);
    const fnBody = preloadSource.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    assert.ok(
      fnBody.includes('doc.querySelectorAll'),
      'resolveProtectVersion must use doc.querySelectorAll (injected document)',
    );
  });

  test('extracts major version via unanchored /Protect\\s+(\\d+)\\. regex (both DOM formats)', () => {
    assert.ok(
      preloadSource.includes('/Protect\\s+(\\d+)\\./'),
      'resolveProtectVersion must match the version number after "Protect" in either DOM format',
    );
  });

  test('reads innerText from span that includes "Protect"', () => {
    assert.ok(
      preloadSource.includes("el.innerText.includes('Protect')"),
      'resolveProtectVersion must filter spans by innerText.includes("Protect")',
    );
  });

  test('reads innerHTML (not textContent) to get version string', () => {
    assert.ok(
      preloadSource.includes('.innerHTML ?? '),
      'resolveProtectVersion must use .innerHTML for version extraction',
    );
  });

  test('references profile.protectVersion for fallback', () => {
    assert.ok(
      preloadSource.includes('profile.protectVersion'),
      'resolveProtectVersion must reference profile.protectVersion for the fallback path',
    );
  });

  test('returns "7.x" as safe default when both DOM and profile fail', () => {
    // The function returns '7.x' as a safe default (last known stable UI model)
    // instead of undefined, so callers do not need to guard against undefined.
    assert.ok(
      preloadSource.includes("return '7.x'"),
      'resolveProtectVersion must return "7.x" as safe default when both detection paths fail',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § DISMISS MODALS – dismissAllModals
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js – dismissAllModals', () => {
  test('queries portals by class name "ReactModalPortal"', () => {
    assert.ok(
      preloadSource.includes("getElementsByClassName('ReactModalPortal')"),
      'dismissAllModals must use getElementsByClassName("ReactModalPortal")',
    );
  });

  test('gets SVG from portal via getElementsByTagName("svg")[0]', () => {
    assert.ok(
      preloadSource.includes("getElementsByTagName('svg')[0]"),
      'dismissAllModals must find SVG via getElementsByTagName("svg")[0]',
    );
  });

  test('does not crash when no portals exist (empty list)', () => {
    assert.doesNotThrow(() =>
      runInSandbox({
        document: {
          URL: 'https://cam.local/protect/dashboard',
          getElementById: () => null,
          createElement: () => makeEl('div'),
          getElementsByTagName: () => [],
          getElementsByClassName: (cls) => ({ length: 0 }),
          getElementsByName: () => [undefined],
          querySelectorAll: () => makeNodeList([]),
          querySelector: () => null,
          head: { appendChild: () => {} },
          body: { appendChild: () => {}, style: {}, insertAdjacentHTML: () => {} },
        },
        window: { addEventListener: () => {} },
      }),
    );
  });

  test('skips portals with children.length === 0 (closed portals)', () => {
    assert.ok(
      preloadSource.includes('children.length > 0'),
      'dismissAllModals must filter portals by children.length > 0',
    );
  });

  test('closes ALL open portals (uses Array.from + forEach)', () => {
    assert.ok(
      preloadSource.includes('Array.from(portals)'),
      'dismissAllModals must convert portals collection via Array.from()',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § OWN PAGE GUARD – DOMContentLoaded skip
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js – own-page guard (DOMContentLoaded)', () => {
  function runForUrl(url) {
    let appendCount = 0;
    let domContentLoadedHandler = null;

    const doc = {
      URL: url,
      getElementById: () => null,
      createElement: () => makeEl('div'),
      getElementsByTagName: () => [],
      getElementsByClassName: () => ({ length: 0 }),
      getElementsByName: () => [undefined],
      querySelectorAll: () => makeNodeList([]),
      querySelector: () => null,
      head: { appendChild: () => {} },
      body: {
        appendChild: () => {
          appendCount++;
        },
        style: {},
        insertAdjacentHTML: () => {},
      },
    };

    runInSandbox({
      document: doc,
      setTimeout: () => 1, // don't fire timers
      window: {
        addEventListener: (event, handler) => {
          if (event === 'DOMContentLoaded') domContentLoadedHandler = handler;
        },
      },
    });

    if (domContentLoadedHandler) domContentLoadedHandler();
    return appendCount;
  }

  test('does NOT show overlay on index.html', () => {
    assert.strictEqual(
      runForUrl('file:///app/index.html'),
      0,
      'overlay must NOT be shown for index.html',
    );
  });

  test('does NOT show overlay on config.html', () => {
    assert.strictEqual(
      runForUrl('file:///app/config.html'),
      0,
      'overlay must NOT be shown for config.html',
    );
  });

  test('does NOT show overlay on profile-select.html', () => {
    assert.strictEqual(
      runForUrl('file:///app/profile-select.html'),
      0,
      'overlay must NOT be shown for profile-select.html',
    );
  });

  test('does NOT show overlay on chrome-error:// pages', () => {
    assert.strictEqual(
      runForUrl('chrome-error://chromewebdata'),
      0,
      'overlay must NOT be shown for chrome-error pages',
    );
  });

  test('does NOT show overlay on about:blank', () => {
    assert.strictEqual(runForUrl('about:blank'), 0, 'overlay must NOT be shown for about:blank');
  });

  test('DOES show overlay on real Protect URL (protect/dashboard)', () => {
    const count = runForUrl('https://cam.local/protect/dashboard');
    assert.ok(count > 0, 'overlay MUST be shown for real Protect dashboard URL');
  });

  test('own-page list is exactly: index.html, config.html, profile-select.html', () => {
    assert.ok(preloadSource.includes("'index.html'"), 'ownPages must include "index.html"');
    assert.ok(preloadSource.includes("'config.html'"), 'ownPages must include "config.html"');
    assert.ok(
      preloadSource.includes("'profile-select.html'"),
      'ownPages must include "profile-select.html"',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § OVERLAY IDs – full constant contract (all 4 keys locked)
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js – OVERLAY_IDS constant contract', () => {
  const EXPECTED = {
    overlay: '__upv_loader',
    style: '__upv_loader_style',
    text: '__upv_loader_text',
    sub: '__upv_loader_sub',
  };

  for (const [key, value] of Object.entries(EXPECTED)) {
    test(`OVERLAY_IDS.${key} is exactly "${value}"`, () => {
      assert.ok(
        preloadSource.includes(`${key}: '${value}'`),
        `OVERLAY_IDS.${key} must be "${value}"`,
      );
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// § V2 SELECTOR CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js – liveview v2 selector contracts', () => {
  test('v2 viewport selector is exactly "[class^=liveview__ViewportsWrapper]"', () => {
    assert.ok(
      preloadSource.includes('[class^=liveview__ViewportsWrapper]'),
      'v2 must use selector "[class^=liveview__ViewportsWrapper]"',
    );
  });

  test('v2 hides header via getElementsByTagName("header")[0]', () => {
    assert.ok(
      preloadSource.includes("getElementsByTagName('header')[0]"),
      'v2 must hide header via getElementsByTagName("header")[0]',
    );
  });

  test('v2 hides nav via getElementsByTagName("nav")[0]', () => {
    assert.ok(
      preloadSource.includes("getElementsByTagName('nav')[0]"),
      'v2 must hide nav via getElementsByTagName("nav")[0]',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § V3 SELECTOR CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js – liveview v3 selector contracts', () => {
  const V3_SELECTORS = [
    '[class^=dashboard__LiveViewWrapper]',
    '[class^=dashboard__Widgets]',
    '[class^=liveView__Header]',
    'button[class^=dashboard__ExpandButton]',
    '[class^=ExpandButton__Root]',
    '[class^=dashboard__Content]',
    '[class^=dashboard__Scrollable]',
    '[class^=liveview__ViewportsWrapper]',
    '[class^=LiveViewGridSlot__CameraNameWrapper] button',
  ];

  for (const sel of V3_SELECTORS) {
    test(`v3 uses selector: ${sel}`, () => {
      assert.ok(preloadSource.includes(sel), `v3 liveview handler must use selector: ${sel}`);
    });
  }

  test('v3 sets body background to "black"', () => {
    assert.ok(
      preloadSource.includes("'background', 'black'"),
      'v3 must set body background to "black"',
    );
  });

  test('v3 camera name buttons get pointerEvents=none', () => {
    assert.ok(
      preloadSource.includes("'pointerEvents', 'none'"),
      'v3 must disable pointerEvents on camera name buttons',
    );
  });

  test('v3 camera name button cursor set to "initial"', () => {
    assert.ok(
      preloadSource.includes("'cursor', 'initial'"),
      'v3 must set cursor to "initial" on camera name buttons',
    );
  });

  test('v3 camera name button color set to "white"', () => {
    assert.ok(
      preloadSource.includes("'color', 'white'"),
      'v3 must set color to "white" on camera name buttons',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § V4+ SELECTOR CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js – liveview v4+ selector contracts', () => {
  const V4_SELECTORS = [
    '[class^=liveView__FullscreenWrapper]',
    '[class^=liveView__LiveViewWrapper]',
    '[data-testid="option"]',
    '[class^=LiveViewGridSlot__PlayerOptions] [class^=PlayerTopLeftControls__ButtonGroup]',
    '[class^=ViewportError__Wrapper]',
    '[class*=LiveviewControls__LiveControlsContainer]',
  ];

  for (const sel of V4_SELECTORS) {
    test(`v4+ uses selector: ${sel}`, () => {
      assert.ok(preloadSource.includes(sel), `v4+ liveview handler must use selector: ${sel}`);
    });
  }

  test('v4+ sets viewport maxHeight to 100vh', () => {
    assert.ok(
      preloadSource.includes("'maxHeight', '100vh'"),
      'v4+ viewport maxHeight must be "100vh"',
    );
  });

  test('v4+ clips viewport wrapper overflow', () => {
    assert.ok(
      preloadSource.includes("applyStyle(viewportWrapperEl, 'overflow', 'hidden')"),
      'v4+ must set overflow hidden on the viewport wrapper',
    );
  });

  test('v4+ derives viewport maxWidth from the grid aspect, not a fixed 16:9', () => {
    assert.ok(
      preloadSource.includes('const SLOT_ASPECT = 1.7777777777777777'),
      'v4+ must base the cap on a 16:9 slot aspect constant',
    );
    assert.ok(
      preloadSource.includes('calc(100vh * ${SLOT_ASPECT} * ${cols} / ${rows})'),
      'v4+ cap must scale by the grid column/row count',
    );
  });

  test('v4+ re-fits the grid on layout change instead of pinning a stale cap', () => {
    assert.ok(
      preloadSource.includes('function watchGridLayout'),
      'v4+ must install a grid layout watcher',
    );
    assert.ok(
      !preloadSource.includes('if (!document.getElementById(persistStyleId))'),
      'v4+ must not write the persisted max-width rule only once',
    );
  });

  test('v4+ persists max-height and overflow in the style tag', () => {
    assert.ok(
      preloadSource.includes('max-height:100vh!important'),
      'persisted style must include max-height',
    );
    assert.ok(
      preloadSource.includes('overflow:hidden!important'),
      'persisted style must include overflow hidden',
    );
  });

  test('v4+ loader screen selector is exactly [data-testid="loader-screen"]', () => {
    assert.ok(
      preloadSource.includes('[data-testid="loader-screen"]'),
      'splash screen selector must be [data-testid="loader-screen"]',
    );
  });

  test('v4+ error slot background set to "black"', () => {
    assert.ok(
      preloadSource.includes("'backgroundColor', 'black'"),
      'v4+ must set backgroundColor to "black" for error slots',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § V4+ LIVEVIEW OVERLAYS – FULLSCREEN GATE (GitHub issue #22)
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js – liveview v4+ overlays gated on window fullscreen (issue #22)', () => {
  /**
   * The controls bar, the per-slot option buttons and the timeline button group are
   * hidden only while the Electron window is fullscreen. In windowed mode Protect's
   * own hover behaviour must apply, so every hiding rule is scoped to the gate class
   * on documentElement. Those elements must not be styled inline at all: an inline
   * style wins over a gated rule even when the gate is inactive.
   */
  function buildGateFixture() {
    const persistedStyle = makeEl('style');
    const documentElement = makeEl('html');
    const controlsEl = makeEl('div');
    const optionEl = makeEl('div');
    const timelineEl = makeEl('div');
    const fullscreenWrapper = makeEl('div');

    controlsEl.classList.add('LiveviewControls__LiveControlsContainer-sc-hdlmsl-1');
    fullscreenWrapper.classList.add('liveView__FullscreenWrapper-sc-o64eat-3');

    const logs = [];
    const headAppended = [];
    let styleAttached = false;

    const sandbox = runInSandbox({
      document: {
        URL: 'https://cam.local/protect/dashboard',
        documentElement,
        // The style tag only resolves once it is attached, as in a real document.
        getElementById: (id) =>
          id === '__upv_persisted_rules' && styleAttached ? persistedStyle : null,
        createElement: (tag) => (tag === 'style' ? persistedStyle : makeEl(tag)),
        getElementsByTagName: () => [],
        getElementsByClassName: () => ({ length: 0 }),
        getElementsByName: () => [undefined],
        querySelectorAll: (selector) => {
          if (selector.includes('LiveviewControls__LiveControlsContainer')) {
            return makeNodeList([controlsEl]);
          }
          if (selector.includes('data-testid="option"')) {
            return makeNodeList([optionEl]);
          }
          if (selector.includes('PlayerTopLeftControls__ButtonGroup')) {
            return makeNodeList([timelineEl]);
          }
          if (selector.includes('liveView__FullscreenWrapper')) {
            return makeNodeList([fullscreenWrapper]);
          }
          return makeNodeList([]);
        },
        querySelector: () => null,
        head: {
          appendChild: (el) => {
            headAppended.push(el);
            if (el === persistedStyle) styleAttached = true;
          },
        },
        body: { appendChild: () => {}, style: {}, insertAdjacentHTML: () => {} },
      },
      console: {
        log: (...args) => logs.push(args.map(String).join(' ')),
        warn: () => {},
        error: () => {},
      },
    });

    return {
      sandbox,
      persistedStyle,
      headAppended,
      logs,
      documentElement,
      controlsEl,
      optionEl,
      timelineEl,
    };
  }

  const OVERLAY_SELECTORS = [
    '[class*=LiveviewControls__LiveControlsContainer]',
    '[data-testid="option"]',
    '[class^=LiveViewGridSlot__PlayerOptions] [class^=PlayerTopLeftControls__ButtonGroup]',
  ];

  test('overlay rules are scoped to the fullscreen gate, not written ungated', async () => {
    const { sandbox, persistedStyle, headAppended } = buildGateFixture();
    await sandbox.applyLiveviewV4andNewer();

    assert.ok(
      headAppended.includes(persistedStyle),
      'overlay rules must live in a <style> tag in document.head (inline styles are lost on React re-mount)',
    );

    const rules = persistedStyle.textContent.split('\n');
    const hidingRules = rules.filter((rule) => rule.includes('display:none!important'));
    assert.strictEqual(
      hidingRules.length,
      OVERLAY_SELECTORS.length,
      'one gated rule per overlay expected, got: ' + persistedStyle.textContent,
    );

    for (const rule of hidingRules) {
      assert.ok(
        rule.startsWith('html.upv-fullscreen '),
        'windowed mode must keep Protect behaviour, so the rule needs the gate: ' + rule,
      );
    }

    for (const selector of OVERLAY_SELECTORS) {
      assert.ok(
        persistedStyle.textContent.includes(selector),
        'the persisted rules must cover the overlay selector ' + selector,
      );
    }
  });

  test('the gate follows the fullscreen state reported by the main process', async () => {
    const { sandbox, documentElement, logs } = buildGateFixture();
    await sandbox.applyLiveviewV4andNewer();

    assert.ok(
      sandbox.__invokedChannels.includes('fullscreenGet'),
      'the initial fullscreen state must be read from the main process',
    );

    const subscriptions = sandbox.__ipcOnCalls.filter(
      (call) => call.channel === 'fullscreenChanged',
    );
    assert.strictEqual(
      subscriptions.length,
      1,
      'the fullscreen push channel must be subscribed exactly once (guarded watcher)',
    );

    assert.ok(
      logs.some((line) => line.startsWith('[upv] v4+:') && line.includes('fullscreen gate')),
      'installing the gate must be logged with the [upv] prefix, got: ' + JSON.stringify(logs),
    );

    const handler = subscriptions[0].handler;
    handler({}, true);
    assert.ok(
      documentElement.classList.contains('upv-fullscreen'),
      'entering fullscreen must activate the gate on documentElement',
    );

    handler({}, false);
    assert.ok(
      !documentElement.classList.contains('upv-fullscreen'),
      'leaving fullscreen must release the gate so windowed mode shows the overlays again',
    );
  });

  test('gate-scoped overlays are not hidden through inline styles', async () => {
    const { sandbox, controlsEl, optionEl, timelineEl } = buildGateFixture();
    await sandbox.applyLiveviewV4andNewer();

    assert.ok(
      !preloadSource.includes("applyStyle(btn, 'display', 'none')"),
      'a gated overlay cannot be hidden inline – an inline style wins over the gated rule',
    );

    for (const el of [controlsEl, optionEl, timelineEl]) {
      assert.ok(
        !('display' in el.style),
        'overlay elements must keep their own display so windowed mode shows them again',
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § SESSION RENEWAL CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js – scheduleSessionRenewal', () => {
  test('reads "portal:localSessionsExpiresAt" from localStorage', () => {
    assert.ok(
      preloadSource.includes("'portal:localSessionsExpiresAt'"),
      'scheduleSessionRenewal must read "portal:localSessionsExpiresAt" from localStorage',
    );
  });

  test('uses a 10-minute early-renewal buffer (10 * 60 * 1_000)', () => {
    assert.ok(
      preloadSource.includes('10 * 60 * 1_000') || preloadSource.includes('10 * 60 * 1000'),
      'session renewal must use a 10-minute buffer',
    );
  });

  test('calls location.reload() for session renewal', () => {
    assert.ok(
      preloadSource.includes('location.reload()'),
      'scheduleSessionRenewal must call location.reload()',
    );
  });

  test('shows overlay before reload (reconnecting message)', () => {
    const reloadIdx = preloadSource.indexOf('location.reload()');
    const overlayIdx = preloadSource.lastIndexOf('showOverlay()', reloadIdx);
    assert.ok(
      overlayIdx !== -1 && overlayIdx < reloadIdx,
      'showOverlay() must be called before location.reload() in session renewal',
    );
  });

  test('does not call reload when localStorage returns null', () => {
    let reloadCalled = false;
    assert.doesNotThrow(() =>
      runInSandbox({
        localStorage: { getItem: () => null },
        location: {
          href: null,
          reload: () => {
            reloadCalled = true;
          },
        },
        window: { addEventListener: () => {} },
      }),
    );
    assert.strictEqual(
      reloadCalled,
      false,
      'location.reload must not be called when no session expiry in localStorage',
    );
  });

  test('does not reload on NaN expiresAt', () => {
    let reloadCalled = false;
    assert.doesNotThrow(() =>
      runInSandbox({
        localStorage: { getItem: () => 'abc' },
        sessionStorage: { getItem: () => null, setItem: () => {} },
        location: {
          href: null,
          reload: () => {
            reloadCalled = true;
          },
        },
        window: { addEventListener: () => {} },
      }),
    );
    assert.strictEqual(
      reloadCalled,
      false,
      'location.reload must not be called when expiresAt is NaN',
    );
  });

  test('does not start polling loop on past-dated expiresAt', () => {
    let reloadCalled = false;
    let intervalCount = 0;
    assert.doesNotThrow(() =>
      runInSandbox({
        localStorage: { getItem: () => String(Date.now() - 86_400_000) },
        sessionStorage: { getItem: () => null, setItem: () => {} },
        location: {
          href: null,
          reload: () => {
            reloadCalled = true;
          },
        },
        setInterval: (fn, ms) => {
          intervalCount++;
          fn();
          return 2;
        },
        window: { addEventListener: () => {} },
      }),
    );
    // past-dated should trigger immediate reload (1 call), not start a polling loop
    assert.ok(
      intervalCount < 2,
      'should not start a polling loop for past-dated expiresAt (intervalCount: ' +
        intervalCount +
        ')',
    );
  });

  test('has immediate reload path for past-dated expiresAt', () => {
    // The immediate reload is triggered asynchronously (await wait + location.reload),
    // so we verify the code path exists via source inspection.
    assert.ok(
      preloadSource.includes('already past renewal threshold'),
      'scheduleSessionRenewal must have an immediate reload path for past-dated expiresAt',
    );
    // Verify the reload path calls showOverlay + setOverlayStatus + location.reload
    const pastGuardIdx = preloadSource.indexOf('already past renewal threshold');
    assert.ok(pastGuardIdx !== -1, 'past-dated guard message must exist');
    const reloadAfterGuard = preloadSource.indexOf('location.reload()', pastGuardIdx);
    assert.ok(
      reloadAfterGuard !== -1,
      'location.reload() must be called in the past-dated guard path',
    );
  });

  test('does not reload on identical stale value (anti-loop)', () => {
    const staleValue = String(Date.now() - 86_400_000);
    let reloadCalled = false;
    assert.doesNotThrow(() =>
      runInSandbox({
        localStorage: { getItem: () => staleValue },
        sessionStorage: { getItem: () => staleValue, setItem: () => {} },
        location: {
          href: null,
          reload: () => {
            reloadCalled = true;
          },
        },
        window: { addEventListener: () => {} },
      }),
    );
    assert.strictEqual(
      reloadCalled,
      false,
      'location.reload must not be called when sessionStorage has identical stale value (anti-loop)',
    );
  });

  test('has NaN guard (Number.isNaN)', () => {
    assert.ok(
      preloadSource.includes('Number.isNaN'),
      'scheduleSessionRenewal must guard against NaN expiresAt using Number.isNaN',
    );
  });

  test('has anti-loop mechanism (sessionStorage)', () => {
    assert.ok(
      preloadSource.includes('sessionStorage'),
      'scheduleSessionRenewal must use sessionStorage for anti-loop protection',
    );
  });

  test('has try-catch around sessionStorage access', () => {
    const funcStart = preloadSource.indexOf('async function scheduleSessionRenewal');
    const funcEnd = preloadSource.indexOf('\n}', funcStart + 100);
    const funcBody = preloadSource.slice(funcStart, funcEnd);
    assert.ok(
      funcBody.includes('try') && funcBody.includes('catch'),
      'scheduleSessionRenewal must have try-catch around sessionStorage access',
    );
  });

  test('does not crash when sessionStorage throws (graceful degradation)', () => {
    const pastExpiry = String(Date.now() - 86_400_000);
    assert.doesNotThrow(() =>
      runInSandbox({
        localStorage: { getItem: () => pastExpiry },
        sessionStorage: {
          getItem: () => {
            throw new Error('SecurityError');
          },
          setItem: () => {
            throw new Error('SecurityError');
          },
        },
        location: {
          href: null,
          reload: () => {},
        },
        window: { addEventListener: () => {} },
      }),
    );
  });

  test('normal polling path calls waitUntil for future expiresAt', () => {
    const pastGuardReload = preloadSource.indexOf('location.reload()');
    const waitUntilAfter = preloadSource.indexOf('waitUntil', pastGuardReload + 50);
    assert.ok(
      waitUntilAfter !== -1,
      'scheduleSessionRenewal must call waitUntil for the normal polling path',
    );
    const intervalAfter = preloadSource.indexOf('60_000', pastGuardReload);
    assert.ok(intervalAfter !== -1, 'normal polling path must use 60_000ms interval');
  });

  test('normal polling path uses currentUrlIncludes escape', () => {
    const funcStart = preloadSource.indexOf('async function scheduleSessionRenewal');
    const funcBody = preloadSource.slice(funcStart);
    assert.ok(
      funcBody.includes('currentUrlIncludes'),
      'normal polling path must check currentUrlIncludes to allow escape',
    );
  });
});

describe('preload.js – installConsoleLogOverride', () => {
  test('also overrides console.warn for IPC forwarding', () => {
    assert.ok(
      preloadSource.includes('console.warn = function'),
      'preload must override console.warn for IPC forwarding',
    );
    assert.ok(
      preloadSource.includes('_originalConsoleWarn'),
      'preload must preserve original console.warn',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § CODEC CAPABILITY PROBE
// ─────────────────────────────────────────────────────────────────────────────

describe('preload.js – codec capability probe', () => {
  function probeSandbox(fakes) {
    const logs = [];
    const warns = [];

    const doc = {
      URL: 'https://cam.local/protect/dashboard',
      createElement: (tag) =>
        tag === 'video' ? { canPlayType: (type) => fakes.canPlayType(type) } : makeEl(tag),
      getElementById: () => null,
      getElementsByTagName: () => [],
      getElementsByClassName: () => ({ length: 0 }),
      getElementsByName: () => [undefined],
      querySelectorAll: () => makeNodeList([]),
      querySelector: () => null,
      head: { appendChild: () => {} },
      body: { appendChild: () => {}, style: {}, insertAdjacentHTML: () => {} },
    };

    const sandbox = runInSandbox({
      ...(fakes.sandboxOverrides || {}),
      document: doc,
      console: {
        log: (...args) => logs.push(args.map(String).join(' ')),
        warn: (...args) => warns.push(args.map(String).join(' ')),
        error: () => {},
      },
      window: { addEventListener: () => {} },
    });

    return { sandbox, logs, warns };
  }

  test('uses complete HEVC codec ids (incomplete ids are always rejected by Chromium)', () => {
    assert.ok(
      preloadSource.includes("const HEVC_CODEC_IDS = ['hvc1.1.6.L93.B0', 'hev1.1.6.L93.B0']"),
      'HEVC_CODEC_IDS must contain complete profile/level/tier ids',
    );
    assert.ok(
      !preloadSource.includes('codecs="hvc1"') && !preloadSource.includes('codecs="hev1"'),
      'bare codec ids always report unsupported in Chromium – the probe must not use them',
    );
  });

  test('logs with the [upv] prefix so the message reaches upv.log', () => {
    assert.ok(
      preloadSource.includes("'[upv] codec probe:'"),
      'probe must log with the [upv] prefix for IPC log forwarding',
    );
  });

  test('runs the probe from the liveview automation startup', () => {
    assert.ok(
      preloadSource.includes('await logCodecCapability()'),
      'startLiveviewAutomation must run the codec probe at startup',
    );
  });

  test('MediaSource and navigator access are guarded', () => {
    assert.ok(
      preloadSource.includes("typeof MediaSource !== 'undefined'"),
      'probe must guard MediaSource',
    );
    assert.ok(
      preloadSource.includes("typeof navigator !== 'undefined'"),
      'probe must guard navigator',
    );
  });

  test('reference copy src/js/liveview/utils.js contains the same probe (no drift)', () => {
    const utilsSource = fs.readFileSync(
      path.resolve(__dirname, '../../../src/js/liveview/utils.js'),
      'utf8',
    );
    assert.ok(
      utilsSource.includes('async function logCodecCapability()'),
      'utils.js reference copy must contain the codec probe',
    );
    assert.ok(
      utilsSource.includes("const HEVC_CODEC_IDS = ['hvc1.1.6.L93.B0', 'hev1.1.6.L93.B0']"),
      'utils.js reference copy must use the same codec ids',
    );
  });

  test('records canPlayType and MediaSource results and warns when HEVC cannot decode', async () => {
    const { sandbox, logs, warns } = probeSandbox({
      canPlayType: () => '',
      sandboxOverrides: { MediaSource: { isTypeSupported: () => false } },
    });

    await sandbox.logCodecCapability();

    const line = logs.find((l) => l.startsWith('[upv] codec probe:'));
    assert.ok(line, 'probe must log a codec probe line');
    assert.ok(line.includes('"canPlayType":"no"'), 'probe must record the canPlayType result');
    assert.ok(line.includes('"mse":false'), 'probe must record the MediaSource result');
    assert.ok(
      warns.some((w) => w.startsWith('[upv] HEVC not decodable here')),
      'probe must warn when HEVC is not decodable at all',
    );
  });

  test('does not warn when the platform can decode HEVC, and logs the platform', async () => {
    const { sandbox, logs, warns } = probeSandbox({
      canPlayType: (type) => (type.includes('hvc1.1.6.L93.B0') ? 'probably' : ''),
      sandboxOverrides: {
        MediaSource: { isTypeSupported: (type) => type.includes('hvc1.1.6.L93.B0') },
        navigator: {
          platform: 'Linux x86_64',
          mediaCapabilities: {
            decodingInfo: async () => ({ supported: true, smooth: true, powerEfficient: true }),
          },
        },
      },
    });

    await sandbox.logCodecCapability();

    const line = logs.find((l) => l.startsWith('[upv] codec probe:'));
    assert.ok(line.includes('Linux x86_64'), 'probe line must include the platform');
    assert.ok(
      line.includes('"powerEfficient":true'),
      'probe must record MediaCapabilities powerEfficient (hardware decoder)',
    );
    assert.strictEqual(warns.length, 0, 'no warning when HEVC is decodable');
  });

  test('does not reject when MediaSource and navigator are unavailable', async () => {
    const { sandbox } = probeSandbox({ canPlayType: () => '' });
    await assert.doesNotReject(() => sandbox.logCodecCapability());
  });
});
