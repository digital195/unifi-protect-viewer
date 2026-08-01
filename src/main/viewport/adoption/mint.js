'use strict';

/**
 * @file mint.js
 * @description Real IO wiring for AdoptionClient defaults: pinned HTTPS token
 * minting (:443) and the pinned `ucp4` mTLS WebSocket (:7442). No Electron —
 * `dataDir` is injected by the caller (window.js supplies
 * `app.getPath('userData')/viewport`). Both TLS sites go through
 * pinning.js's `buildTlsOptions` (`rejectUnauthorized:true` + fingerprint
 * assert) — this file never sets `rejectUnauthorized:false` anywhere; that
 * relaxed mode exists exactly once, inside pinning.js's own one-time TOFU
 * probe.
 *
 * `connection.js`'s `open()` already assembles the full UCP header set
 * (sec-websocket-protocol, x-ident, x-type, x-mode, x-fingerprint,
 * x-version, x-adopted, and x-token when present) and calls
 * `wsFactory(url, { cert, key, headers })` with it — so `makeConnection`'s
 * `wsFactory` below MUST NOT rebuild those headers; it only merges the
 * pinned TLS options on top of what it's given.
 */

const https = require('node:https');
const { buildLoginRequest, managePayloadUrl, parseTokenResponse } = require('./token');
const pinning = require('./pinning');

const DEFAULT_PROBE_TIMEOUT_MS = 10000;

/**
 * Wraps `pinning.probeAndPin` with a caller-side deadline. `probeAndPin`
 * itself has no internal timeout: if `tlsConnect` neither completes nor
 * errors — a silent packet drop, a firewalled host — its promise never
 * settles and the caller would
 * hang forever with no user-visible feedback during adoption. This does not
 * touch pinning.js; it only bounds how long mint.js is willing to wait on it.
 */
function probeAndPinWithTimeout({ host, port, dir, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    // Deliberately NOT unref'd: unlike connection.js's idle/reconnect
    // timers (background housekeeping on an already-open link), this timer
    // guards foreground work the caller is actively awaiting (initial token
    // mint / first connect) — it must fire and deliver its rejection even
    // if it's the only thing outstanding, not let the process exit first.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`TLS pin probe for ${host}:${port} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pinning.probeAndPin({ host, port, dir }).then(
      (pin) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(pin);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Pinned HTTPS JSON request. Probes+pins the target host (or reuses an
 * already-pinned host) and issues the request with
 * `pinning.buildTlsOptions(pin)` — never `rejectUnauthorized:false`.
 */
async function httpJson(reqDesc, { cookie, dataDir } = {}) {
  const u = new URL(reqDesc.url);
  const host = u.hostname;
  const port = Number(u.port) || 443;
  const pin = await probeAndPinWithTimeout({ host, port, dir: dataDir });
  const tlsOpts = pinning.buildTlsOptions(pin);
  return new Promise((resolve, reject) => {
    const headers = { ...reqDesc.headers };
    if (cookie) headers.cookie = cookie;
    const req = https.request(
      {
        hostname: host,
        port,
        path: u.pathname + u.search,
        method: reqDesc.method || 'GET',
        headers,
        ...tlsOpts,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, setCookie: res.headers['set-cookie'], body }),
        );
      },
    );
    req.on('error', reject);
    if (reqDesc.body) req.write(reqDesc.body);
    req.end();
  });
}

/**
 * POST login → GET manage-payload → `{ token, cookie }` (pinned HTTPS; used
 * only for initial adopt). The login session cookie is surfaced alongside the
 * token so the adopt flow can reuse the already-authenticated session (e.g.
 * for a post-adopt rename) without a second login.
 */
async function mintToken({ url, username, password, dataDir }) {
  const login = await httpJson(buildLoginRequest(url, username, password), { dataDir });
  if (login.status !== 200) throw new Error(`login HTTP ${login.status}`);
  const cookie = (login.setCookie || []).map((c) => c.split(';')[0]).join('; ');
  const mp = await httpJson({ url: managePayloadUrl(url), method: 'GET' }, { cookie, dataDir });
  if (mp.status !== 200) throw new Error(`manage-payload HTTP ${mp.status}`);
  return { token: parseTokenResponse(JSON.parse(mp.body)), cookie };
}

/**
 * Builds a real AdoptionConnection whose async wsFactory pins TLS onto the
 * `{cert, key, headers}` that `connection.js`'s `open()` already assembles
 * (see file header — the full UCP header set is built there, NOT here). The
 * ws URL is the derived ds URL (`protocol.dsWsUrl`, :7442 — see index.js),
 * so this pins the `ds` daemon's OWN cert, independently of `mintToken`'s
 * :443 probe: pinning.js keys pins by `host:port`, so :443 and :7442 are
 * separate entries even though `dataDir` (and therefore the pins file) is
 * shared between them. A repeat connect to the SAME host:port still reuses
 * its cached pin (no re-probe) — see pinning.js's `probeAndPin`.
 */
function makeConnection(opts) {
  const { AdoptionConnection } = require('./connection');
  const { dataDir } = opts;
  const wsFactory = async (url, { cert, key, headers }) => {
    // Required lazily (not at module top-level) so tests can swap the `ws`
    // module out from under this factory without a real network probe.
    const WebSocket = require('ws');
    const u = new URL(url);
    const host = u.hostname;
    const port = Number(u.port) || 7442;
    const pin = await probeAndPinWithTimeout({ host, port, dir: dataDir });
    const tlsOpts = pinning.buildTlsOptions(pin);
    // Empty protocols arg: subprotocol is asserted via the header (ws would
    // abort if it required the server to echo it). Verified against a live console.
    return new WebSocket(url, [], { cert, key, headers, ...tlsOpts });
  };
  return new AdoptionConnection({ ...opts, wsFactory });
}

module.exports = { mintToken, makeConnection, httpJson, probeAndPinWithTimeout };
