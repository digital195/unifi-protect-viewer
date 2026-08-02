'use strict';

/**
 * @file shared-views-status.js
 * @description In-memory holder for this launch's "Show Shared Multiviews"
 * auto-enable outcome. window.js sets it from the AdoptionClient's `sharedViews`
 * event; ipc.js reads it for the `viewportSharedViewsStatus` IPC so config.html
 * can warn only when the auto-enable actually ran and failed. A standalone
 * module (rather than living in window.js) avoids a window.js ↔ ipc.js require
 * cycle. State resets on process start; never holds secrets.
 */

let _status = { ran: false, ok: false, reason: null };

module.exports = {
  /** @param {{ok?:boolean, reason?:string}} s */
  set(s) {
    _status = { ran: true, ok: !!(s && s.ok), reason: (s && s.reason) || null };
  },
  /** @returns {{ran:boolean, ok:boolean, reason:string|null}} */
  get() {
    return { ..._status };
  },
};
