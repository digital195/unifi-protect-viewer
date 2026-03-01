'use strict';

/**
 * @file test/js/liveview/utils.test.js
 * @description Tests für src/js/liveview/utils.js
 *
 * utils.js ist eine REFERENCE COPY (keine module.exports).
 * Wir laden es via vm.runInNewContext mit einem simulierten DOM.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const utilsSource = fs.readFileSync(
  path.resolve(__dirname, '../../../src/js/liveview/utils.js'),
  'utf8',
);

// ── Sandbox-Factory ───────────────────────────────────────────────────────────

function createSandbox(overrides = {}) {
  // Alle Funktionen werden in den Kontext gemappt
  const ctx = {
    console: { log: () => {}, warn: () => {} },
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
    document: {
      URL: 'https://cam.local/protect/dashboard',
      getElementsByClassName: () => ({ length: 0 }),
      querySelectorAll: () => ({ length: 0, forEach: () => {} }),
    },
    window: {},
    Event: class Event {
      constructor(t, o = {}) {
        this.type = t;
        this.bubbles = o.bubbles;
        this.simulated = false;
      }
    },
    MouseEvent: class MouseEvent {
      constructor(t, o = {}) {
        this.type = t;
        this.bubbles = o.bubbles;
      }
    },
    module: { exports: {} },
    exports: {},
    ...overrides,
  };
  const script = new vm.Script(utilsSource);
  const context = vm.createContext(ctx);
  script.runInContext(context);
  return ctx;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('utils.js – wait()', () => {
  test('wait gibt eine Promise zurück die nach ms auflöst', async () => {
    // Wir können wait nicht direkt aufrufen, da es im Kontext definiert ist.
    // Wir extrahieren es, indem wir den Code in einer Funktion ausführen
    // die wait zurückgibt.
    const code =
      utilsSource +
      '\nmodule.exports = { wait, waitUntil, hasElements, elementExistsAt, currentUrlIncludes, applyStyle, simulateClick, setReactInputValue, dismissAllModals };';
    // Nur evalieren wenn safe – ohne externe Aufrufe
    // Minimal-Test: wir prüfen, dass das Modul die Funktion definiert
    // (via vm mit patched setTimeout)
    let resolvedValue;
    const ctx = vm.createContext({
      console: { log: () => {} },
      module: { exports: {} },
      exports: {},
      setTimeout: (fn, ms) => {
        resolvedValue = ms;
        fn();
        return 1;
      },
      setInterval: () => 2,
      clearTimeout: () => {},
      clearInterval: () => {},
      document: { URL: '' },
      window: {},
      Event: class {},
      MouseEvent: class {},
    });
    vm.runInContext(utilsSource + '\nmodule.exports.wait = wait;', ctx);
    const waitFn = ctx.module.exports.wait;
    assert.strictEqual(typeof waitFn, 'function');
    await waitFn(42);
    assert.strictEqual(resolvedValue, 42);
  });
});

describe('utils.js – waitUntil()', () => {
  test('löst true auf wenn Bedingung sofort wahr ist', async () => {
    // waitUntil nutzt setInterval + setTimeout(defer, 20).
    // Wir sammeln alle gespeicherten Callbacks und rufen sie manuell auf.
    const timeoutCallbacks = [];
    let intervalFn = null;
    const ctx = vm.createContext({
      console: { log: () => {} },
      module: { exports: {} },
      exports: {},
      setTimeout: (fn, ms) => {
        timeoutCallbacks.push(fn);
        return timeoutCallbacks.length;
      },
      setInterval: (fn, ms) => {
        intervalFn = fn;
        return 99;
      },
      clearTimeout: () => {},
      clearInterval: () => {},
      document: { URL: '' },
      window: {},
      Event: class {},
      MouseEvent: class {},
    });
    vm.runInContext(utilsSource + '\nmodule.exports.waitUntil = waitUntil;', ctx);
    const { waitUntil } = ctx.module.exports;

    const promise = waitUntil(() => true);
    // Interval-Callback ausführen → ruft finish(true) → speichert 20ms-defer
    if (intervalFn) intervalFn();
    // Alle gespeicherten Timeouts ausführen (inkl. 20ms defer)
    for (const fn of timeoutCallbacks) fn();

    const result = await promise;
    assert.strictEqual(result, true);
  });

  test('löst false auf nach Timeout wenn Bedingung nie wahr wird', async () => {
    const ctx = vm.createContext({
      console: { log: () => {} },
      module: { exports: {} },
      exports: {},
      setTimeout: (fn, ms) => {
        fn();
        return 1;
      }, // sofortiger Timeout
      setInterval: (fn, ms) => 2, // läuft NICHT
      clearTimeout: () => {},
      clearInterval: () => {},
      document: { URL: '' },
      window: {},
      Event: class {},
      MouseEvent: class {},
    });
    vm.runInContext(utilsSource + '\nmodule.exports.waitUntil = waitUntil;', ctx);
    const { waitUntil } = ctx.module.exports;
    const result = await waitUntil(() => false, 1);
    assert.strictEqual(result, false);
  });

  test('kein Timeout wenn timeoutMs = -1', async () => {
    // Bei timeoutMs = -1 wird kein setTimeout aufgerufen für den Timeout
    let setTimeoutCallCount = 0;
    const ctx = vm.createContext({
      console: { log: () => {} },
      module: { exports: {} },
      exports: {},
      setTimeout: (fn, ms) => {
        setTimeoutCallCount++;
        fn();
        return 1;
      },
      setInterval: (fn, ms) => {
        fn();
        return 2;
      }, // Bedingung wird sofort geprüft
      clearTimeout: () => {},
      clearInterval: () => {},
      document: { URL: '' },
      window: {},
      Event: class {},
      MouseEvent: class {},
    });
    vm.runInContext(utilsSource + '\nmodule.exports.waitUntil = waitUntil;', ctx);
    const { waitUntil } = ctx.module.exports;
    setTimeoutCallCount = 0; // reset nach Initialisierung
    const result = await waitUntil(() => true, -1);
    assert.strictEqual(result, true);
  });
});

describe('utils.js – hasElements()', () => {
  function getUtils() {
    const ctx = vm.createContext({
      console: { log: () => {} },
      module: { exports: {} },
      exports: {},
      setTimeout: (fn, ms) => {
        fn();
        return 1;
      },
      setInterval: () => 2,
      clearTimeout: () => {},
      clearInterval: () => {},
      document: { URL: '' },
      window: {},
      Event: class {},
      MouseEvent: class {},
    });
    vm.runInContext(
      utilsSource +
        '\nmodule.exports = { hasElements, elementExistsAt, currentUrlIncludes, applyStyle, simulateClick, setReactInputValue };',
      ctx,
    );
    return ctx.module.exports;
  }

  test('hasElements gibt true zurück für nicht-leere NodeList', () => {
    const { hasElements } = getUtils();
    assert.strictEqual(hasElements({ length: 3 }), true);
  });

  test('hasElements gibt false zurück für leere NodeList', () => {
    const { hasElements } = getUtils();
    assert.strictEqual(hasElements({ length: 0 }), false);
  });

  test('elementExistsAt gibt true zurück wenn Element am Index existiert', () => {
    const { elementExistsAt } = getUtils();
    assert.strictEqual(elementExistsAt(['a', 'b'], 1), true);
  });

  test('elementExistsAt gibt false zurück wenn Index außerhalb', () => {
    const { elementExistsAt } = getUtils();
    assert.strictEqual(elementExistsAt(['a'], 5), false);
  });

  test('elementExistsAt gibt true zurück für Index 0 (Standard)', () => {
    const { elementExistsAt } = getUtils();
    assert.strictEqual(elementExistsAt(['a']), true);
  });
});

describe('utils.js – currentUrlIncludes()', () => {
  function getUtils(url) {
    const ctx = vm.createContext({
      console: { log: () => {} },
      module: { exports: {} },
      exports: {},
      setTimeout: (fn, ms) => {
        fn();
        return 1;
      },
      setInterval: () => 2,
      clearTimeout: () => {},
      clearInterval: () => {},
      document: { URL: url },
      window: {},
      Event: class {},
      MouseEvent: class {},
    });
    vm.runInContext(utilsSource + '\nmodule.exports.currentUrlIncludes = currentUrlIncludes;', ctx);
    return ctx.module.exports;
  }

  test('gibt true zurück wenn URL den Teilstring enthält', () => {
    const { currentUrlIncludes } = getUtils('https://cam/protect/dashboard');
    assert.strictEqual(currentUrlIncludes('protect'), true);
  });

  test('gibt false zurück wenn URL den Teilstring nicht enthält', () => {
    const { currentUrlIncludes } = getUtils('https://cam/login');
    assert.strictEqual(currentUrlIncludes('dashboard'), false);
  });
});

describe('utils.js – applyStyle()', () => {
  test('setzt CSS-Eigenschaft auf vorhandenem Element', () => {
    const ctx = vm.createContext({
      console: { log: () => {} },
      module: { exports: {} },
      exports: {},
      setTimeout: (fn, ms) => {
        fn();
        return 1;
      },
      setInterval: () => 2,
      clearTimeout: () => {},
      clearInterval: () => {},
      document: { URL: '' },
      window: {},
      Event: class {},
      MouseEvent: class {},
    });
    vm.runInContext(utilsSource + '\nmodule.exports.applyStyle = applyStyle;', ctx);
    const { applyStyle } = ctx.module.exports;
    const el = { style: {} };
    applyStyle(el, 'display', 'none');
    assert.strictEqual(el.style.display, 'none');
  });

  test('tut nichts wenn Element null ist', () => {
    const ctx = vm.createContext({
      console: { log: () => {} },
      module: { exports: {} },
      exports: {},
      setTimeout: (fn, ms) => {
        fn();
        return 1;
      },
      setInterval: () => 2,
      clearTimeout: () => {},
      clearInterval: () => {},
      document: { URL: '' },
      window: {},
      Event: class {},
      MouseEvent: class {},
    });
    vm.runInContext(utilsSource + '\nmodule.exports.applyStyle = applyStyle;', ctx);
    const { applyStyle } = ctx.module.exports;
    assert.doesNotThrow(() => applyStyle(null, 'display', 'none'));
    assert.doesNotThrow(() => applyStyle(undefined, 'display', 'none'));
  });
});

describe('utils.js – simulateClick()', () => {
  function getSimulateClick() {
    const ctx = vm.createContext({
      console: { log: () => {} },
      module: { exports: {} },
      exports: {},
      setTimeout: (fn, ms) => {
        fn();
        return 1;
      },
      setInterval: () => 2,
      clearTimeout: () => {},
      clearInterval: () => {},
      document: { URL: '' },
      window: {},
      Event: class {},
      MouseEvent: class MouseEvent {
        constructor(t, o) {
          this.type = t;
          this.opts = o;
        }
      },
    });
    vm.runInContext(utilsSource + '\nmodule.exports.simulateClick = simulateClick;', ctx);
    return ctx.module.exports.simulateClick;
  }

  test('ruft element.click() auf wenn verfügbar', () => {
    const simulateClick = getSimulateClick();
    let clicked = false;
    const el = {
      click: () => {
        clicked = true;
      },
    };
    simulateClick(el);
    assert.strictEqual(clicked, true);
  });

  test('verwendet dispatchEvent wenn click() nicht verfügbar', () => {
    const simulateClick = getSimulateClick();
    let dispatched = false;
    const el = {
      dispatchEvent: () => {
        dispatched = true;
      },
    };
    simulateClick(el);
    assert.strictEqual(dispatched, true);
  });

  test('tut nichts bei null/undefined', () => {
    const simulateClick = getSimulateClick();
    assert.doesNotThrow(() => simulateClick(null));
    assert.doesNotThrow(() => simulateClick(undefined));
  });
});

describe('utils.js – setReactInputValue()', () => {
  function getSetReactInputValue() {
    const ctx = vm.createContext({
      console: { log: () => {} },
      module: { exports: {} },
      exports: {},
      setTimeout: (fn, ms) => {
        fn();
        return 1;
      },
      setInterval: () => 2,
      clearTimeout: () => {},
      clearInterval: () => {},
      document: { URL: '' },
      window: {},
      Event: class Event {
        constructor(t, o = {}) {
          this.type = t;
          this.bubbles = o.bubbles;
          this.simulated = false;
        }
      },
      MouseEvent: class {},
    });
    vm.runInContext(utilsSource + '\nmodule.exports.setReactInputValue = setReactInputValue;', ctx);
    return ctx.module.exports.setReactInputValue;
  }

  test('setzt den Wert und feuert input-Event', () => {
    const setReactInputValue = getSetReactInputValue();
    let eventFired = false;
    const el = {
      value: 'old',
      dispatchEvent: () => {
        eventFired = true;
      },
      _valueTracker: null,
    };
    setReactInputValue(el, 'newValue');
    assert.strictEqual(el.value, 'newValue');
    assert.strictEqual(eventFired, true);
  });

  test('setzt React _valueTracker wenn vorhanden', () => {
    const setReactInputValue = getSetReactInputValue();
    let trackerValue = null;
    const el = {
      value: 'initial',
      dispatchEvent: () => {},
      _valueTracker: {
        setValue: (v) => {
          trackerValue = v;
        },
      },
    };
    setReactInputValue(el, 'updated');
    // tracker.setValue wird mit dem ALTEN Wert aufgerufen
    assert.strictEqual(trackerValue, 'initial');
  });

  test('tut nichts bei null/undefined', () => {
    const setReactInputValue = getSetReactInputValue();
    assert.doesNotThrow(() => setReactInputValue(null, 'x'));
    assert.doesNotThrow(() => setReactInputValue(undefined, 'x'));
  });
});
