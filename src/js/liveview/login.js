'use strict';

/**
 * @file login.js
 * @description Auto-login handler – REFERENCE COPY ONLY.
 *
 * Inlined into src/js/preload.js. Edit here for review, then sync to preload.js.
 */

/**
 * Fills in the username and password fields, ticks "Remember Me" (for a
 * long-lived 30-day session instead of Unifi's default 2h session), and
 * submits the login form. Waits until the login button is available in the
 * DOM before proceeding.
 *
 * The "Remember Me" checkbox is optional: Unifi OS removed it for a while
 * and only recent releases (Unifi OS 5.1.21+) render it again, so it may be
 * absent on some hosts – this is handled gracefully (see GitHub issue #17).
 *
 * @param {{ username: string, password: string }} credentials
 * @returns {Promise<void>}
 */
async function performLogin(credentials) {
  // Wait for the login form button to appear
  await waitUntil(() => document.getElementsByTagName('button').length > 0);

  setReactInputValue(document.getElementsByName('username')[0], credentials.username);
  setReactInputValue(document.getElementsByName('password')[0], credentials.password);

  // Tick "Remember Me" if the checkbox is present and not already checked
  const rememberMe =
    document.getElementsByName('rememberMe')[0] ||
    document.querySelector('#rememberMe, input[type="checkbox"]');
  if (rememberMe && !rememberMe.checked) {
    simulateClick(rememberMe);
  }

  // Submit by clicking the first (submit) button
  simulateClick(document.getElementsByTagName('button')[0]);
}

// (no module.exports – this file is a reference copy, not a runtime module)
