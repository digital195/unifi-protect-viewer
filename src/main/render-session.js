'use strict';

/**
 * @file render-session.js
 * @description Tiny process-memory-only override for the EFFECTIVE render
 * session (the URL + creds that ipc.js's `onConfigLoad` hands to preload.js
 * for the unexpected-URL redirect and the auto-login form fill).
 *
 * Why this exists: when Viewport
 * mode's adoption fails and window.js falls back to a configured profile, the
 * render session must actually BECOME that profile — not silently keep
 * authenticating as the still-"enabled" viewport connection. `onConfigLoad`
 * has no other way to learn that a fallback happened (the viewport config in
 * the store is untouched — only the in-window navigation state changed), so
 * window.js sets this override at the moment it decides to fall back, and
 * `onConfigLoad` checks it first, ahead of the viewport-connection gate.
 *
 * Deliberately NOT persisted (no store.set) — this is per-process runtime
 * state only, cleared on every fresh `loadInitialPage` so a normal launch (no
 * fallback) is never affected by a previous window's leftover override.
 */

/** @type {{url:string, username?:string, password?:string}|null} */
let _override = null;

/**
 * Sets the render-session override. Pass a profile-shaped object (only
 * url/username/password are retained — extra profile fields like `id`/`name`
 * are intentionally dropped since `onConfigLoad`'s contract is `{url,
 * username, password}`, same as the viewport-connection and profile paths).
 * @param {{url:string, username?:string, password?:string}} config
 */
function setRenderCredentialOverride(config) {
  _override = config
    ? { url: config.url, username: config.username, password: config.password }
    : null;
}

/**
 * @returns {{url:string, username?:string, password?:string}|null} the
 *   current override, or null when none is set (the common case).
 */
function getRenderCredentialOverride() {
  return _override;
}

/** Clears the override. Safe to call when none is set. */
function clear() {
  _override = null;
}

module.exports = { setRenderCredentialOverride, getRenderCredentialOverride, clear };
