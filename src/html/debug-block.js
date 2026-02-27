/**
 * @file debug-block.js
 * @description Shared Debug & Support block component.
 *
 * Renders a reusable Debug & Support section into a given container element.
 * Used by config.html, index.html and profile-select.html.
 *
 * Usage:
 *   <div id="debugBlock"></div>
 *   <script src="debug-block.js"></script>
 *   <script>renderDebugBlock(document.getElementById('debugBlock'));</script>
 *
 * Buttons:
 *   - Open Log File   → window.electronAPI.openLogFile(null)
 *   - Open DevTools   → window.electronAPI.openDevTools()
 *   - Report Issue    → window.electronAPI.openExternal(GITHUB_ISSUES_URL)
 */

(function () {
  'use strict';

  const GITHUB_ISSUES_URL = 'https://github.com/digital195/unifi-protect-viewer/issues/new/choose';

  /** SVG icons (inline, no external deps) */
  const ICON_LOG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<polyline points="14 2 14 8 20 8"/>' +
    '<line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>' +
    '</svg>';

  const ICON_DEVTOOLS =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>' +
    '</svg>';

  const ICON_ISSUE =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="10"/>' +
    '<line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' +
    '</svg>';

  /**
   * Creates a debug-block button element.
   * @param {string} id
   * @param {string} icon   – SVG markup string
   * @param {string} label
   * @param {Function} handler
   * @returns {HTMLButtonElement}
   */
  function makeButton(id, icon, label, handler) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.className = 'upv-btn upv-btn--secondary upv-debug-btn';
    btn.innerHTML = icon + '<span>' + label + '</span>';
    btn.addEventListener('click', handler);
    return btn;
  }

  /**
   * Renders the Debug & Support block into `container`.
   * Idempotent: calling it twice on the same container does nothing.
   *
   * @param {HTMLElement} container
   */
  function renderDebugBlock(container) {
    if (!container) return;
    if (container.dataset.debugBlockMounted) return; // idempotency guard
    container.dataset.debugBlockMounted = '1';

    // Title
    const title = document.createElement('p');
    title.className = 'upv-section-title';
    title.textContent = 'Debug & Support';

    // Button group wrapper
    const group = document.createElement('div');
    group.className = 'upv-btn-group upv-debug-group';
    group.id = 'debugButtonGroup';

    group.appendChild(
      makeButton('debugOpenLogBtn', ICON_LOG, 'Open Log File', function () {
        window.electronAPI.openLogFile(null);
      }),
    );

    group.appendChild(
      makeButton('debugOpenDevToolsBtn', ICON_DEVTOOLS, 'Open DevTools', function () {
        window.electronAPI.openDevTools();
      }),
    );

    group.appendChild(
      makeButton('debugReportIssueBtn', ICON_ISSUE, 'Report Issue on GitHub', function () {
        window.electronAPI.openExternal(GITHUB_ISSUES_URL);
      }),
    );

    container.appendChild(title);
    container.appendChild(group);
  }

  // Expose globally so HTML pages can call renderDebugBlock(...)
  window.renderDebugBlock = renderDebugBlock;
  window.GITHUB_ISSUES_URL = GITHUB_ISSUES_URL;
})();
