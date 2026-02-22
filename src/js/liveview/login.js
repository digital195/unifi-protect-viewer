'use strict';

/**
 * @file login.js
 * @description Auto-login handler – REFERENCE COPY ONLY.
 *
 * Inlined into src/js/preload.js. Edit here for review, then sync to preload.js.
 */

/**
 * Fills in the username and password fields and submits the login form.
 * Waits until the login button is available in the DOM before proceeding.
 *
 * @param {{ username: string, password: string }} credentials
 * @returns {Promise<void>}
 */
async function performLogin(credentials) {
  // Wait for the login form button to appear
  await waitUntil(() => document.getElementsByTagName('button').length > 0);

  setReactInputValue(document.getElementsByName('username')[0], credentials.username);
  setReactInputValue(document.getElementsByName('password')[0], credentials.password);

  // Submit by clicking the first (submit) button
  simulateClick(document.getElementsByTagName('button')[0]);
}

// (no module.exports – this file is a reference copy, not a runtime module)
