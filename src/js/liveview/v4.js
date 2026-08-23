'use strict';

/**
 * @file v4.js
 * @description Liveview handler Protect 4.x / 5.x / 6.x / 7.x+ – REFERENCE COPY ONLY.
 *
 * All modern Protect versions (>= 4.x, including 7.x and beyond) share the
 * same UI structure introduced in 4.x and are handled identically here.
 * Future versions are supported automatically as long as the DOM selectors
 * remain stable.
 *
 * Legacy 3.x is handled by v3.js (isLegacyVersion3() guard in preload.js).
 *
 * Inlined into src/js/preload.js. Edit here for review, then sync to preload.js.
 */

const SEL = {
  fullscreenWrapper: '[class^=liveView__FullscreenWrapper]',
  liveViewWrapper: '[class^=liveView__LiveViewWrapper]',
  widgets: '[class^=dashboard__Widgets]',
  expandButton: 'button[class^=dashboard__ExpandButton]',
  expandButtonRoot: '[class^=ExpandButton__Root]',
  dashboardContent: '[class^=dashboard__Content]',
  commonWidget: '[class^=common__Widget]',
  scrollable: '[class^=dashboard__Scrollable]',
  viewportWrapper: '[class^=liveview__ViewportsWrapper]',
  viewports: '[class^="liveview__Viewports-"]',
  optionButtons: '[data-testid="option"]',
  timelineButtons:
    '[class^=LiveViewGridSlot__PlayerOptions] [class^=PlayerTopLeftControls__ButtonGroup]',
  viewportErrors: '[class^=ViewportError__Wrapper]',
  styledNav: '[class^=Nav__StyledNavigation]',
};

/**
 * Returns the max-width the viewport wrapper may occupy while keeping every
 * grid slot at 16:9.
 *
 * Protect sizes the camera grid itself, but only *after* measuring the
 * wrapper — so capping the wrapper at single-camera width makes Protect
 * compute correspondingly small slots. The cap must therefore account for how
 * many columns and rows the current liveview layout actually uses: a 2-wide
 * grid is 32:9, not 16:9.
 *
 * @param {Element|null|undefined} viewportsEl  the liveview__Viewports grid
 * @returns {string} CSS max-width value
 */
function computeViewportMaxWidth(viewportsEl) {
  const SLOT_ASPECT = 1.7777777777777777; // 16:9
  let cols = 1;
  let rows = 1;
  try {
    if (viewportsEl) {
      const cs = getComputedStyle(viewportsEl);
      const count = (v) => (v || '').split(/\s+/).filter((t) => t && t !== 'none').length;
      cols = count(cs.gridTemplateColumns) || 1;
      rows = count(cs.gridTemplateRows) || 1;
    }
  } catch (e) {
    console.warn('[upv] v4+: grid measurement failed –', e && e.message);
  }
  return `calc(100vh * ${SLOT_ASPECT} * ${cols} / ${rows})`;
}

/**
 * Persists the max-width via a <style> tag, because the inline value is lost
 * when the user navigates away from liveview and back (React re-mount).
 * Rewrites the rule when the value changes, so a layout switch is not left
 * pinned to a stale cap.
 */
function persistViewportMaxWidth(viewportWrapperEl, maxWidth) {
  const styleId = '__upv_viewport_maxwidth';
  const wrapperClass = viewportWrapperEl
    ? Array.from(viewportWrapperEl.classList).find((c) =>
        c.startsWith('liveview__ViewportsWrapper'),
      )
    : null;
  const selector = wrapperClass ? `.${wrapperClass}` : '[class^=liveview__ViewportsWrapper]';
  let styleEl = document.getElementById(styleId);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  const rule = `${selector}{max-width:${maxWidth}!important;max-height:100vh!important;overflow:hidden!important;}`;
  if (styleEl.textContent !== rule) {
    styleEl.textContent = rule;
    console.log(
      `[upv] v4+: persisted maxWidth="${maxWidth}" + maxHeight/overflow via <style id="${styleId}">`,
    );
  }
}

/** Measures the current grid and applies the matching cap. */
function fitViewportToGrid(liveViewEl, SEL) {
  const root = liveViewEl ?? document;
  const wrapperEl = root.querySelector(SEL.viewportWrapper);
  if (!wrapperEl) return;
  const maxWidth = computeViewportMaxWidth(root.querySelector(SEL.viewports));
  applyStyle(wrapperEl, 'maxWidth', maxWidth);
  persistViewportMaxWidth(wrapperEl, maxWidth);
}

/**
 * Re-fits when the liveview layout changes (s2 -> s4) or the window resizes.
 * Converges: an unchanged cap rewrites nothing, so the observer cannot loop.
 */
function watchGridLayout(liveViewEl, SEL) {
  if (window.__upv_grid_watcher) return;
  window.__upv_grid_watcher = true;

  const refit = () => fitViewportToGrid(liveViewEl, SEL);
  window.addEventListener('resize', refit);

  const viewportsEl = (liveViewEl ?? document).querySelector(SEL.viewports);
  if (viewportsEl) {
    // The layout is encoded in a class token (e.g. "s2"), so watch class only.
    new MutationObserver(refit).observe(viewportsEl, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }
  console.log('[upv] v4+: grid layout watcher installed');
}

/**
 * Strips the Unifi 4.x+ UI chrome, expands the liveview fullscreen and caps
 * the viewport wrapper to the grid's true aspect (no scrollbars, no crop).
 * @returns {Promise<void>}
 */
async function applyLiveviewV4andNewer() {
  console.log('[upv] v4+: waiting for fullscreen wrapper');
  await waitUntil(() => hasElements(document.querySelectorAll(SEL.fullscreenWrapper)));
  console.log('[upv] v4+: fullscreen wrapper found');
  await dismissAllModals();

  console.log('[upv] v4+: hiding global chrome (header, nav)');
  applyStyle(document.body, 'background', 'black');
  applyStyle(document.getElementsByTagName('header')[0], 'display', 'none');
  applyStyle(document.getElementsByTagName('nav')[0], 'display', 'none');
  applyStyle(document.querySelectorAll(SEL.styledNav)[0], 'display', 'none');

  console.log('[upv] v4+: hiding dashboard chrome, expanding viewport');
  applyStyle(document.querySelectorAll(SEL.widgets)[0], 'display', 'none');
  applyStyle(document.querySelectorAll(SEL.expandButton)[0], 'display', 'none');
  applyStyle(document.querySelectorAll(SEL.fullscreenWrapper)[0], 'backgroundColor', 'black');

  const contentEl = document.querySelectorAll(SEL.dashboardContent)[0];
  applyStyle(contentEl, 'display', 'block');
  applyStyle(contentEl, 'padding', '0');
  applyStyle(document.querySelector(SEL.expandButtonRoot), 'display', 'none');

  const liveViewEl = document.querySelectorAll(SEL.liveViewWrapper)[0];
  applyStyle(liveViewEl?.querySelectorAll(SEL.commonWidget)[0], 'border', '0');
  applyStyle(liveViewEl?.querySelectorAll(SEL.scrollable)[0], 'paddingBottom', '0');
  const viewportWrapperEl = liveViewEl?.querySelectorAll(SEL.viewportWrapper)[0];
  applyStyle(viewportWrapperEl, 'maxHeight', '100vh');
  applyStyle(viewportWrapperEl, 'overflow', 'hidden');

  // Cap the wrapper to the grid's true aspect (cols/rows), not a single 16:9
  // slot – Protect measures this wrapper to size the camera slots, so a
  // single-camera cap shrinks a multi-camera grid. See computeViewportMaxWidth.
  fitViewportToGrid(liveViewEl, SEL);
  watchGridLayout(liveViewEl, SEL);

  console.log('[upv] v4+: waiting for per-camera option buttons');
  const optionsFound = await waitUntil(() =>
    hasElements(document.querySelectorAll(SEL.optionButtons)),
  );
  if (optionsFound) {
    const n = document.querySelectorAll(SEL.optionButtons).length;
    console.log(`[upv] v4+: hiding ${n} option button(s)`);
    document
      .querySelectorAll(SEL.optionButtons)
      .forEach((btn) => applyStyle(btn, 'display', 'none'));
  } else {
    console.warn('[upv] v4+: option buttons not found within timeout');
  }

  console.log('[upv] v4+: waiting for "Go to Timeline" button group (max 1 s)');
  const timelineFound = await waitUntil(
    () => hasElements(document.querySelectorAll(SEL.timelineButtons)),
    1_000,
  );
  if (timelineFound) {
    const n = document.querySelectorAll(SEL.timelineButtons).length;
    console.log(`[upv] v4+: hiding ${n} timeline button group(s)`);
    document
      .querySelectorAll(SEL.timelineButtons)
      .forEach((btn) => applyStyle(btn, 'display', 'none'));
  } else {
    console.log('[upv] v4+: no timeline buttons found (may not be present in this layout)');
  }

  const errorSlots = document.querySelectorAll(SEL.viewportErrors);
  if (errorSlots.length > 0) {
    console.log(`[upv] v4+: painting ${errorSlots.length} error/missing camera slot(s) black`);
    errorSlots.forEach((el) => applyStyle(el, 'backgroundColor', 'black'));
  }
  console.log('[upv] v4+: done');
}

// (no module.exports – this file is a reference copy, not a runtime module)
