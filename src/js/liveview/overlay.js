'use strict';

/**
 * @file overlay.js
 * @description Loading overlay – REFERENCE COPY ONLY.
 *
 * Inlined into src/js/preload.js. Edit here for review, then sync to preload.js.
 */

const FALLBACK_TIMEOUT_MS = 20_000;

const IDS = {
  overlay: '__upv_loader',
  style: '__upv_loader_style',
  text: '__upv_loader_text',
  sub: '__upv_loader_sub',
};

const OVERLAY_HTML = `
  <div id="${IDS.overlay}_inner">
    <div id="${IDS.overlay}_ring"></div>
    <div id="${IDS.overlay}_logo">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="1.5"
           stroke-linecap="round" stroke-linejoin="round">
        <polygon points="23 7 16 12 23 17 23 7"/>
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
      </svg>
    </div>
    <p id="${IDS.text}">Loading cameras\u2026</p>
    <p id="${IDS.sub}">Please wait</p>
  </div>
`;

const OVERLAY_CSS = `
  #${IDS.overlay} {
    position:fixed;inset:0;z-index:999999;background:#0f1117;
    display:flex;align-items:center;justify-content:center;
    transition:opacity .4s ease;
  }
  #${IDS.overlay}.fade-out{opacity:0;pointer-events:none;}
  #${IDS.overlay}_inner{display:flex;flex-direction:column;align-items:center;gap:14px;}
  #${IDS.overlay}_logo{color:#006fff;margin-bottom:4px;}
  #${IDS.overlay}_ring{
    width:44px;height:44px;
    border:3px solid rgba(0,111,255,.2);border-top-color:#006fff;
    border-radius:50%;animation:__upv_spin .8s linear infinite;
  }
  @keyframes __upv_spin{to{transform:rotate(360deg);}}
  #${IDS.text}{font-family:'Segoe UI',system-ui,sans-serif;font-size:15px;font-weight:600;color:#e8ecf4;margin:0;}
  #${IDS.sub} {font-family:'Segoe UI',system-ui,sans-serif;font-size:12px;color:#55607a;margin:0;}
`;

// ── Public API ────────────────────────────────────────────────────────────────

/** Injects the loading overlay (no-op if already present). */
function showOverlay() {
  if (document.getElementById(IDS.overlay)) return;

  const styleEl = document.createElement('style');
  styleEl.id = IDS.style;
  styleEl.textContent = OVERLAY_CSS;
  document.head.appendChild(styleEl);

  const overlayEl = document.createElement('div');
  overlayEl.id = IDS.overlay;
  overlayEl.innerHTML = OVERLAY_HTML;
  document.body.appendChild(overlayEl);

  setTimeout(() => hideOverlay('fallback timeout'), FALLBACK_TIMEOUT_MS);
}

/**
 * Updates the status text inside the overlay.
 * @param {string} text  Primary message
 * @param {string} [sub] Secondary detail message
 */
function setOverlayStatus(text, sub) {
  const textEl = document.getElementById(IDS.text);
  const subEl = document.getElementById(IDS.sub);
  if (textEl && text) textEl.textContent = text;
  if (subEl && sub) subEl.textContent = sub;
}

/**
 * Fades out and removes the overlay.
 * @param {string} [reason] Logged to the console for debugging
 */
function hideOverlay(reason = 'done') {
  const overlayEl = document.getElementById(IDS.overlay);
  if (!overlayEl) return;
  console.log('[upv] overlay hidden:', reason);
  overlayEl.classList.add('fade-out');
  setTimeout(() => {
    document.getElementById(IDS.overlay)?.remove();
    document.getElementById(IDS.style)?.remove();
  }, 450);
}

// ── Viewport adoption status → overlay copy ──────────────────────────────────
// REFERENCE ONLY — the runtime subscription lives inlined in src/js/preload.js
// (this file is the reviewable source copy; preload.js is what actually runs).
//
// In viewport adoption mode, main pushes 'viewportStatus' with
// 'registering' | 'online-unassigned' | 'reconnecting' | 'assigned' while the
// UCP device connection walks the adoption flow (see src/main/window.js). All
// but 'assigned' override the overlay copy; 'assigned' is intentionally
// ignored — from there the normal liveview automation drives the overlay text.
//
// Notes (mirrored from preload.js):
//  - preload.js subscribes directly on its `ipc` IPC helper: with
//    contextIsolation, window.electronAPI only exists in the page's main
//    world, not in the preload's isolated world. The equivalent bridge
//    binding (electronAPI.onViewportStatus) is exposed for main-world pages.
//  - setOverlayStatus() safely no-ops until showOverlay() has created the
//    overlay, and profile mode never receives the channel → inert there.
//  - A reconnect may re-send 'online-unassigned' after 'assigned'; page
//    navigation resets the overlay, so plain text updates are all we need.
//
// Wrapped in a function here (unlike the inlined top-level statement in
// preload.js) so this reference file stays free of undeclared globals.
// @param {{ on:(channel:string, listener:Function)=>void }} ipc – preload's IPC helper
function bindViewportStatusToOverlay(ipc) {
  ipc.on('viewportStatus', (_event, state) => {
    if (state === 'registering') {
      setOverlayStatus('Registering Viewport…', 'Contacting your Protect console');
    } else if (state === 'online-unassigned') {
      setOverlayStatus('Viewport online', 'Assign a Live View to it in Protect → Devices');
    } else if (state === 'reconnecting') {
      setOverlayStatus('Viewport offline', 'Reconnecting to your console…');
    }
    // 'assigned' → the normal liveview loading flow drives the text.
  });
}

// (no module.exports – this file is a reference copy, not a runtime module)
