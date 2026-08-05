'use strict';

/**
 * @file native.js
 * @description Pure bridge from an AdoptionClient's `assignment` events to window
 * navigation. No Electron — `navigate(url)` is injected so window.js owns the
 * BrowserWindow. Dedupes by last target (same-liveview re-shares are no-ops).
 */

const { assignmentTargetUrl } = require('./assignment');

/**
 * @param {object} p
 * @param {import('events').EventEmitter} p.client - an AdoptionClient
 * @param {string} p.baseUrl - the profile/NVR base URL
 * @param {(url:string)=>void} p.navigate - performs the window navigation
 * @param {(msg:string)=>void} [p.log]
 * @returns {{ stop: () => void }}
 */
function startNativeViewport({ client, baseUrl, navigate, log = () => {} }) {
  let currentTarget = null;

  const onOnline = (v) => log(v ? 'device online' : 'device offline');
  const onAssignment = (a) => {
    const liveviewId = a && a.liveviewId ? a.liveviewId : null;
    const target = assignmentTargetUrl(baseUrl, liveviewId);
    if (target === currentTarget) {
      log(`assignment ${liveviewId} (same target, skip)`);
      return;
    }
    currentTarget = target;
    log(`assignment ${liveviewId} → ${target}`);
    navigate(target);
  };
  const onError = (e) => log(`adoption error: ${e && e.message}`);

  client.on('online', onOnline);
  client.on('assignment', onAssignment);
  client.on('error', onError);

  return {
    stop() {
      // Explicitly unsubscribe rather than relying solely on the client
      // ceasing emission after stop() — cheap leak-safety if `client` is
      // reused/restarted or outlives this bridge.
      client.off('online', onOnline);
      client.off('assignment', onAssignment);
      client.off('error', onError);
      client.stop();
    },
  };
}

module.exports = { startNativeViewport };
