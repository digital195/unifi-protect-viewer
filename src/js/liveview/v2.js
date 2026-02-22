'use strict';

/**
 * @file v2.js
 * @description Liveview handler Protect 2.x – REFERENCE COPY ONLY.
 *
 * Inlined into src/js/preload.js. Edit here for review, then sync to preload.js.
 */

const SEL = {
  viewportWrapper: '[class^=liveview__ViewportsWrapper]',
};

/**
 * Strips the Unifi UI chrome and expands the viewport to fill the window.
 * @returns {Promise<void>}
 */
async function applyLiveviewV2() {
  // Wait for the viewport wrapper to appear
  await waitUntil(() => document.querySelectorAll(SEL.viewportWrapper).length > 0);

  await dismissAllModals();

  applyStyle(document.getElementsByTagName('header')[0], 'display', 'none');
  applyStyle(document.getElementsByTagName('nav')[0], 'display', 'none');

  const wrapper = document.querySelectorAll(SEL.viewportWrapper)[0];
  applyStyle(wrapper, 'maxWidth', '100vw');
  applyStyle(wrapper, 'maxHeight', '100vh');
}

// (no module.exports – this file is a reference copy, not a runtime module)
