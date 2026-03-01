'use strict';

/**
 * @file test/js/debug-block.test.js
 * @description Contract tests for src/html/debug-block.js
 *
 * Covers (per copilot-instructions.md):
 *  1. renderDebugBlock is callable and produces correct DOM structure
 *  2. Three buttons present: Open Log File, Open DevTools, Report Issue
 *  3. Correct IDs: debugOpenLogBtn, debugOpenDevToolsBtn, debugReportIssueBtn
 *  4. Each handler calls the correct window.electronAPI method
 *  5. Idempotency guard: calling renderDebugBlock twice does not duplicate
 *  6. Null container: does not throw
 *  7. GITHUB_ISSUES_URL is exposed on window
 *  8. Section title "Debug & Support" is present
 *
 * Uses ONLY node:test + node:assert/strict.
 * No real Electron runtime. Uses vm sandbox with mocked DOM and electronAPI.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const debugBlockSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/html/debug-block.js'),
  'utf8',
);

// ─────────────────────────────────────────────────────────────────────────────
// DOM mock
// ─────────────────────────────────────────────────────────────────────────────

function buildMinimalDom() {
  // We build a real lightweight in-memory element tree via a factory.
  // No jsdom – pure structural tracking.

  function makeElement(tag) {
    const el = {
      tag,
      className: '',
      id: '',
      innerHTML: '',
      dataset: {},
      _children: [],
      _listeners: {},
      appendChild(child) {
        this._children.push(child);
        return child;
      },
      addEventListener(ev, fn) {
        if (!this._listeners[ev]) this._listeners[ev] = [];
        this._listeners[ev].push(fn);
      },
      querySelector(sel) {
        // Simple id-selector support
        if (sel.startsWith('#')) {
          const id = sel.slice(1);
          return this._findById(id);
        }
        return null;
      },
      _findById(id) {
        if (this.id === id) return this;
        for (const c of this._children) {
          const found = c._findById && c._findById(id);
          if (found) return found;
        }
        return null;
      },
      _findAll(predicate) {
        const results = [];
        if (predicate(this)) results.push(this);
        for (const c of this._children) {
          if (c._findAll) results.push(...c._findAll(predicate));
        }
        return results;
      },
      click() {
        (this._listeners['click'] || []).forEach((fn) => fn());
      },
    };
    return el;
  }

  const container = makeElement('div');
  container.id = 'debugBlockContainer';

  return { container, makeElement };
}

function runDebugBlock(overrides = {}) {
  const calls = {
    openLogFile: [],
    openDevTools: [],
    openExternal: [],
  };

  const { container } = buildMinimalDom();

  const electronAPI = {
    openLogFile: (...args) => calls.openLogFile.push(args),
    openDevTools: (...args) => calls.openDevTools.push(args),
    openExternal: (...args) => calls.openExternal.push(args),
    ...overrides.electronAPI,
  };

  const sandbox = {
    window: { electronAPI },
    document: {
      createElement: (tag) => {
        const el = {
          tag,
          className: '',
          id: '',
          innerHTML: '',
          dataset: {},
          textContent: '',
          _children: [],
          _listeners: {},
          appendChild(child) {
            this._children.push(child);
            return child;
          },
          addEventListener(ev, fn) {
            if (!this._listeners[ev]) this._listeners[ev] = [];
            this._listeners[ev].push(fn);
          },
          _findAll(pred) {
            const r = [];
            if (pred(this)) r.push(this);
            for (const c of this._children) if (c._findAll) r.push(...c._findAll(pred));
            return r;
          },
          click() {
            (this._listeners['click'] || []).forEach((fn) => fn());
          },
        };
        return el;
      },
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };

  // Expose sandbox.window to script
  sandbox.window.renderDebugBlock = undefined;
  sandbox.window.GITHUB_ISSUES_URL = undefined;

  vm.runInNewContext(debugBlockSource, sandbox);

  const renderDebugBlock = sandbox.window.renderDebugBlock;
  const GITHUB_ISSUES_URL = sandbox.window.GITHUB_ISSUES_URL;

  return { renderDebugBlock, GITHUB_ISSUES_URL, container, calls, sandbox };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 1 – renderDebugBlock produces DOM structure
// ─────────────────────────────────────────────────────────────────────────────

describe('debug-block.js – renderDebugBlock DOM structure', () => {
  test('renderDebugBlock is exposed on window', () => {
    const { renderDebugBlock } = runDebugBlock();
    assert.strictEqual(typeof renderDebugBlock, 'function');
  });

  test('renders children into container', () => {
    const { renderDebugBlock, container } = runDebugBlock();
    renderDebugBlock(container);
    assert.ok(container._children.length > 0, 'container must have children after render');
  });

  test('renders a section title element', () => {
    const { renderDebugBlock, container } = runDebugBlock();
    renderDebugBlock(container);
    const titles = container._findAll((el) => el.className === 'upv-section-title');
    assert.ok(titles.length >= 1, 'must render upv-section-title');
  });

  test('section title text is "Debug & Support"', () => {
    const { renderDebugBlock, container } = runDebugBlock();
    renderDebugBlock(container);
    const titles = container._findAll((el) => el.className === 'upv-section-title');
    assert.ok(
      titles.some((t) => t.textContent === 'Debug & Support'),
      `expected "Debug & Support", got: ${titles.map((t) => t.textContent).join(', ')}`,
    );
  });

  test('renders a button group container with id debugButtonGroup', () => {
    const { renderDebugBlock, container } = runDebugBlock();
    renderDebugBlock(container);
    const groups = container._findAll((el) => el.id === 'debugButtonGroup');
    assert.ok(groups.length >= 1, 'debugButtonGroup must be present');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 2 – Three buttons present with correct IDs
// ─────────────────────────────────────────────────────────────────────────────

describe('debug-block.js – button presence and IDs', () => {
  test('button debugOpenLogBtn is present', () => {
    const { renderDebugBlock, container } = runDebugBlock();
    renderDebugBlock(container);
    const btns = container._findAll((el) => el.id === 'debugOpenLogBtn');
    assert.ok(btns.length >= 1, 'debugOpenLogBtn must be present');
  });

  test('button debugOpenDevToolsBtn is present', () => {
    const { renderDebugBlock, container } = runDebugBlock();
    renderDebugBlock(container);
    const btns = container._findAll((el) => el.id === 'debugOpenDevToolsBtn');
    assert.ok(btns.length >= 1, 'debugOpenDevToolsBtn must be present');
  });

  test('button debugReportIssueBtn is present', () => {
    const { renderDebugBlock, container } = runDebugBlock();
    renderDebugBlock(container);
    const btns = container._findAll((el) => el.id === 'debugReportIssueBtn');
    assert.ok(btns.length >= 1, 'debugReportIssueBtn must be present');
  });

  test('all three buttons have upv-btn class', () => {
    const { renderDebugBlock, container } = runDebugBlock();
    renderDebugBlock(container);
    const ids = ['debugOpenLogBtn', 'debugOpenDevToolsBtn', 'debugReportIssueBtn'];
    for (const id of ids) {
      const btn = container._findAll((el) => el.id === id)[0];
      assert.ok(btn, `${id} must exist`);
      assert.ok(btn.className.includes('upv-btn'), `${id} must have upv-btn class`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 3 – Handler wiring
// ─────────────────────────────────────────────────────────────────────────────

describe('debug-block.js – handler wiring', () => {
  test('debugOpenLogBtn click calls electronAPI.openLogFile', () => {
    const { renderDebugBlock, container, calls } = runDebugBlock();
    renderDebugBlock(container);
    const btn = container._findAll((el) => el.id === 'debugOpenLogBtn')[0];
    assert.ok(btn, 'button must exist');
    btn.click();
    assert.equal(calls.openLogFile.length, 1, 'openLogFile must be called once');
  });

  test('debugOpenLogBtn click passes null as first arg', () => {
    const { renderDebugBlock, container, calls } = runDebugBlock();
    renderDebugBlock(container);
    container._findAll((el) => el.id === 'debugOpenLogBtn')[0].click();
    assert.equal(calls.openLogFile[0][0], null);
  });

  test('debugOpenDevToolsBtn click calls electronAPI.openDevTools', () => {
    const { renderDebugBlock, container, calls } = runDebugBlock();
    renderDebugBlock(container);
    const btn = container._findAll((el) => el.id === 'debugOpenDevToolsBtn')[0];
    btn.click();
    assert.equal(calls.openDevTools.length, 1, 'openDevTools must be called once');
  });

  test('debugReportIssueBtn click calls electronAPI.openExternal with GitHub URL', () => {
    const { renderDebugBlock, container, calls, GITHUB_ISSUES_URL } = runDebugBlock();
    renderDebugBlock(container);
    const btn = container._findAll((el) => el.id === 'debugReportIssueBtn')[0];
    btn.click();
    assert.equal(calls.openExternal.length, 1, 'openExternal must be called once');
    assert.equal(calls.openExternal[0][0], GITHUB_ISSUES_URL);
  });

  test('GITHUB_ISSUES_URL is a non-empty string exposed on window', () => {
    const { GITHUB_ISSUES_URL } = runDebugBlock();
    assert.strictEqual(typeof GITHUB_ISSUES_URL, 'string');
    assert.ok(GITHUB_ISSUES_URL.length > 0, 'GITHUB_ISSUES_URL must not be empty');
    assert.ok(GITHUB_ISSUES_URL.startsWith('https://'), 'must be an https URL');
  });

  test('GITHUB_ISSUES_URL contains "issues" (GitHub Issues link)', () => {
    const { GITHUB_ISSUES_URL } = runDebugBlock();
    assert.ok(GITHUB_ISSUES_URL.includes('issues'), 'URL must point to issues');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 4 – Idempotency guard
// ─────────────────────────────────────────────────────────────────────────────

describe('debug-block.js – idempotency guard', () => {
  test('calling renderDebugBlock twice does not duplicate the button group', () => {
    const { renderDebugBlock, container } = runDebugBlock();
    renderDebugBlock(container);
    renderDebugBlock(container);
    const groups = container._findAll((el) => el.id === 'debugButtonGroup');
    assert.equal(groups.length, 1, 'debugButtonGroup must appear exactly once');
  });

  test('calling renderDebugBlock twice does not duplicate section title', () => {
    const { renderDebugBlock, container } = runDebugBlock();
    renderDebugBlock(container);
    renderDebugBlock(container);
    const titles = container._findAll((el) => el.className === 'upv-section-title');
    assert.equal(titles.length, 1, 'section title must appear exactly once');
  });

  test('null container does not throw', () => {
    const { renderDebugBlock } = runDebugBlock();
    assert.doesNotThrow(() => renderDebugBlock(null));
  });

  test('undefined container does not throw', () => {
    const { renderDebugBlock } = runDebugBlock();
    assert.doesNotThrow(() => renderDebugBlock(undefined));
  });
});
