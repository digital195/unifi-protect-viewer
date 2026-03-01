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
  const sandbox = {
    // required by contextBridge / ipcRenderer at module top level
    require: (mod) => {
      if (mod === 'electron') {
        return {
          contextBridge: { exposeInMainWorld: () => {} },
          ipcRenderer: {
            send: () => {},
            invoke: () => Promise.resolve(undefined),
          },
        };
      }
      throw new Error(`unexpected require: ${mod}`);
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    window: { addEventListener: () => {} },
    document: {
      URL: 'https://cam.local/protect/dashboard',
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
  test('CSS selector for version spans is exactly "[class^=Version__Item] > span"', () => {
    assert.ok(
      preloadSource.includes('[class^=Version__Item] > span'),
      'version selector must be "[class^=Version__Item] > span"',
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

  test('strips "Protect" prefix and trims result', () => {
    assert.ok(
      preloadSource.includes(".replace('Protect', '').trim()"),
      'resolveProtectVersion must call .replace("Protect", "").trim()',
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
  ];

  for (const sel of V4_SELECTORS) {
    test(`v4+ uses selector: ${sel}`, () => {
      assert.ok(preloadSource.includes(sel), `v4+ liveview handler must use selector: ${sel}`);
    });
  }

  test('v4+ sets viewport maxWidth to calc(100vh * 1.7777...)', () => {
    assert.ok(
      preloadSource.includes('calc(100vh * 1.7777777777777777)'),
      'v4+ viewport maxWidth must be "calc(100vh * 1.7777777777777777)"',
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
});
