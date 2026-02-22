'use strict';

/**
 * @file v3.js
 * @description Liveview handler Protect 3.x – REFERENCE COPY ONLY.
 *
 * Inlined into src/js/preload.js. Edit here for review, then sync to preload.js.
 */

const SEL = {
  liveViewWrapper: '[class^=dashboard__LiveViewWrapper]',
  widgets: '[class^=dashboard__Widgets]',
  liveViewHeader: '[class^=liveView__Header]',
  expandButton: 'button[class^=dashboard__ExpandButton]',
  dashboardContent: '[class^=dashboard__Content]',
  scrollable: '[class^=dashboard__Scrollable]',
  viewportWrapper: '[class^=liveview__ViewportsWrapper]',
  cameraNameBtn: '[class^=LiveViewGridSlot__CameraNameWrapper] button',
};

/**
 * Strips the Unifi 3.x UI chrome, hides widgets and expands the liveview.
 * Called twice (with a 4 s gap) because some elements render lazily.
 * @returns {Promise<void>}
 */
async function applyLiveviewV3() {
  // Wait for the live-view wrapper to appear
  await waitUntil(() => hasElements(document.querySelectorAll(SEL.liveViewWrapper)));

  await dismissAllModals();

  // Hide global chrome
  applyStyle(document.body, 'background', 'black');
  applyStyle(document.getElementsByTagName('header')[0], 'display', 'none');
  applyStyle(document.getElementsByTagName('nav')[0], 'display', 'none');

  // Wait for dashboard widgets and expandable controls
  await waitUntil(
    () =>
      hasElements(document.querySelectorAll(SEL.widgets)) &&
      hasElements(document.querySelectorAll(SEL.liveViewHeader)) &&
      hasElements(document.querySelectorAll(SEL.expandButton)),
  );

  applyStyle(document.querySelectorAll(SEL.widgets)[0], 'display', 'none');
  applyStyle(document.querySelectorAll(SEL.liveViewHeader)[0], 'display', 'none');
  applyStyle(document.querySelectorAll(SEL.expandButton)[0], 'display', 'none');

  const contentEl = document.querySelectorAll(SEL.dashboardContent)[0];
  applyStyle(contentEl, 'display', 'block');
  applyStyle(contentEl, 'padding', '0');

  const wrapperEl = document.querySelectorAll(SEL.liveViewWrapper)[0];
  applyStyle(wrapperEl?.querySelectorAll(SEL.scrollable)[0], 'paddingBottom', '0');
  applyStyle(
    wrapperEl?.querySelectorAll(SEL.viewportWrapper)[0],
    'maxWidth',
    'calc(177.778vh - 50px)',
  );

  // Make camera name labels non-interactive (display only)
  await waitUntil(() => document.querySelectorAll(SEL.cameraNameBtn).length > 0);

  document.querySelectorAll(SEL.cameraNameBtn).forEach((btn) => {
    applyStyle(btn, 'color', 'white');
    applyStyle(btn, 'cursor', 'initial');
    applyStyle(btn, 'pointerEvents', 'none');
  });
}

// (no module.exports – this file is a reference copy, not a runtime module)
