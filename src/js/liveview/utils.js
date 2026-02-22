'use strict';

/**
 * @file utils.js
 * @description Shared DOM utility functions – REFERENCE COPY ONLY.
 *
 * These functions are inlined directly into src/js/preload.js because the
 * Electron preload sandbox (contextIsolation=true) does not support loading
 * local files via require(). Edit this file for readability/review, then
 * copy changes into the matching section of preload.js.
 */

// ── Async helpers ─────────────────────────────────────────────────────────────

/**
 * Resolves after `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls `condition()` at `intervalMs` and resolves when it returns truthy,
 * or when `timeoutMs` elapses (resolves `false`).
 *
 * Pass `timeoutMs = -1` for no timeout (runs indefinitely).
 *
 * @param {() => boolean} condition
 * @param {number} [timeoutMs=60_000]
 * @param {number} [intervalMs=100]
 * @returns {Promise<boolean>}
 */
function waitUntil(condition, timeoutMs = 60_000, intervalMs = 100) {
  return new Promise((resolve) => {
    let timeoutId;
    let intervalId;

    function finish(result) {
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
      // Small defer so callers can chain reliably
      setTimeout(() => resolve(result), 20);
    }

    if (timeoutMs !== -1) {
      timeoutId = setTimeout(() => finish(false), timeoutMs);
    }

    intervalId = setInterval(() => {
      if (condition()) finish(true);
    }, intervalMs);
  });
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

/**
 * Returns `true` when `elements` is non-empty.
 * @param {NodeList|HTMLCollection} elements
 */
function hasElements(elements) {
  return elements.length > 0;
}

/**
 * Returns `true` when `elements[index]` exists.
 * @param {NodeList|HTMLCollection} elements
 * @param {number} [index=0]
 */
function elementExistsAt(elements, index = 0) {
  return elements.length > index && Boolean(elements[index]);
}

/**
 * Returns `true` when the current page URL contains `urlPart`.
 * @param {string} urlPart
 */
function currentUrlIncludes(urlPart) {
  return document.URL.includes(urlPart);
}

/**
 * Applies a CSS style property to `element`, if it exists.
 * @param {Element|null|undefined} element
 * @param {string} property  CSS property name (camelCase)
 * @param {string} value
 */
function applyStyle(element, property, value) {
  if (element) element.style[property] = value;
}

/**
 * Simulates a user click on `element`.
 * Works with both native DOM elements and React synthetic event targets.
 * @param {Element|null|undefined} element
 */
function simulateClick(element) {
  if (!element) return;

  if (typeof element.click === 'function') {
    element.click();
  } else {
    element.dispatchEvent(
      new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
}

/**
 * Sets the value of a React-controlled input while triggering React's
 * internal change tracker so the framework picks up the new value.
 * @param {HTMLInputElement|null|undefined} element
 * @param {string} value
 */
function setReactInputValue(element, value) {
  if (!element) return;

  const previousValue = element.value;
  element.value = value;

  const inputEvent = new Event('input', { bubbles: true });
  inputEvent.simulated = true;

  // React 16+ stores an internal value tracker on the element
  const tracker = element._valueTracker;
  if (tracker) tracker.setValue(previousValue);

  element.dispatchEvent(inputEvent);
}

/**
 * Closes all open React modal portals by clicking their close SVG icons.
 * @returns {Promise<void>}
 */
async function dismissAllModals() {
  const portals = document.getElementsByClassName('ReactModalPortal');
  if (!hasElements(portals)) return;

  Array.from(portals).forEach((portal) => {
    const closeIcon = portal.getElementsByTagName('svg')[0];
    if (closeIcon) simulateClick(closeIcon);
  });

  // Wait until all portal containers are empty
  await waitUntil(() =>
    Array.from(document.getElementsByClassName('ReactModalPortal')).every(
      (p) => p.children.length === 0,
    ),
  );
}

// (no module.exports – this file is a reference copy, not a runtime module)
