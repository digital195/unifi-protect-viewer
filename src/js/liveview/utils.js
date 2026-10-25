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

// ── Codec capability probe ────────────────────────────────────────────────────

/**
 * Full HEVC codec ids only. Chromium rejects incomplete ids such as "hvc1" or
 * "hev1", so a bare id reports unsupported even on a machine that can decode —
 * only the complete profile/level/tier id gives a meaningful answer.
 */
const HEVC_CODEC_IDS = ['hvc1.1.6.L93.B0', 'hev1.1.6.L93.B0'];

/**
 * Logs which video codecs the rendering engine can actually decode, so an
 * "Enhanced encoding" report can be answered from the log alone.
 *
 * Pure observation – no app behaviour branches on the result. Runs once per
 * page load, never blocks the liveview automation, and swallows every error.
 *
 * @returns {Promise<void>}
 */
async function logCodecCapability() {
  try {
    const video = document.createElement('video');
    const probe = {};
    let mseSupported = false;

    for (const id of HEVC_CODEC_IDS) {
      const type = `video/mp4; codecs="${id}"`;
      const mse = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type);
      if (mse) mseSupported = true;

      probe[id] = { canPlayType: video.canPlayType(type) || 'no', mse };
    }

    if (typeof navigator !== 'undefined' && navigator.mediaCapabilities?.decodingInfo) {
      const info = await navigator.mediaCapabilities.decodingInfo({
        type: 'file',
        video: {
          contentType: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
          width: 1920,
          height: 1080,
          bitrate: 8_000_000,
          framerate: 30,
        },
      });

      probe.mcap = { supported: info.supported, powerEfficient: info.powerEfficient };
    }

    const platform = typeof navigator !== 'undefined' ? navigator.platform : 'n/a';
    console.log('[upv] codec probe:', JSON.stringify(probe), 'platform:', platform);

    if (!mseSupported && !probe.mcap?.supported) {
      console.warn('[upv] HEVC not decodable here – Enhanced encoding cameras will fail');
    }
  } catch (_) {
    /* swallow – must not crash the preload */
  }
}

// (no module.exports – this file is a reference copy, not a runtime module)
