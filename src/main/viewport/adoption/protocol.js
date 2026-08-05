'use strict';

/**
 * @file protocol.js
 * @description Pure UCP viewer wire logic. No IO, no Electron. Frame codec
 * `[1B ver=01][1B type=01][6B BE len][JSON]`, positional envelope+body pairing,
 * response/deviceInfo/configure builders, and upgrade headers. Unit-tested with
 * fixtures captured from a live console.
 *
 * Also carries `dsWsUrl` — a small pure URL derivation (host in, ds WS URL
 * out) needed because the admin API (:443) and the `ds` device daemon
 * (:7442) are different services at different ports on the same NVR; see
 * its own doc comment below.
 */

/** Encode one UCP frame: [ver][type][6B BE len][utf8 JSON]. */
function encodeFrame(obj, ver = 1, type = 1) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(8);
  head[0] = ver;
  head[1] = type;
  head.writeUIntBE(body.length, 2, 6);
  return Buffer.concat([head, body]);
}

/** Parse all complete frames in a buffer; a short tail is flagged truncated. */
function parseFrames(buf) {
  const out = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    const ver = buf[off];
    const type = buf[off + 1];
    const len = buf.readUIntBE(off + 2, 6);
    const end = off + 8 + len;
    if (end > buf.length) {
      out.push({ ver, type, len, truncated: true, avail: buf.length - off - 8 });
      break;
    }
    out.push({ ver, type, len, payload: buf.subarray(off + 8, end) });
    off = end;
  }
  return out;
}

/**
 * Pair decoded frame objects positionally: [0]=envelope, [1]=body, [2]=envelope…
 * A trailing odd object is returned in `remainder` so a persistent frame queue
 * can carry it to the next message. Never content-sniffs; never assumes one pair.
 */
function pairFrames(objs) {
  const pairs = [];
  let i = 0;
  while (i + 1 <= objs.length - 1) {
    pairs.push({ envelope: objs[i], body: objs[i + 1] });
    i += 2;
  }
  return { pairs, remainder: objs.slice(i) };
}

/** Two-frame response: [envelope{type:'response',action,id,timestamp}][body]. */
function buildResponseFrames(envelope, body, nowMs) {
  const respEnv = { timestamp: nowMs, type: 'response', action: envelope.action, id: envelope.id };
  return Buffer.concat([encodeFrame(respEnv), encodeFrame(body || {})]);
}

/** Complete, truthful getInfo body derived from identity + opts. */
function buildDeviceInfo(identity, name, opts = {}) {
  return {
    mac: identity.mac,
    name,
    model: opts.model || 'UP Viewport',
    modelKey: 'viewer',
    firmwareVersion: opts.firmwareVersion || '1.4.33',
    hardwareRevision: opts.hardwareRevision || '1',
    guid: identity.ident,
    ip: opts.ip || '127.0.0.1',
    uptime: typeof opts.uptime === 'number' ? opts.uptime : 0,
    isProvisioned: true,
    isAdopted: opts.isAdopted === true,
    features: opts.features || {},
  };
}

/** The native assignment: liveview is an OBJECT; absent -> null (unassign). */
function parseConfigure(body) {
  const lv = body && body.liveview;
  if (!lv || typeof lv !== 'object') return null;
  const liveviewId = lv.id || lv._id || null;
  if (!liveviewId) return null;
  return { liveviewId, liveview: lv };
}

/** Reply body for an on-connect request action. getInfo -> info; else -> {} ack. */
function replyBodyFor(action, ctx) {
  if (action === 'getInfo')
    return buildDeviceInfo(ctx.identity, ctx.name, ctx.deviceInfoOpts || {});
  return {};
}

/** WebSocket upgrade headers for verifyUcpClientHttp (subprotocol set via header). */
function buildUpgradeHeaders({
  mac,
  ident,
  fingerprint,
  token,
  ip,
  xType = 'UP Viewport',
  xVersion = '1.4.33',
}) {
  const h = {
    'sec-websocket-protocol': 'ucp4',
    'x-ident': mac,
    'x-type': xType,
    'x-mode': '0',
    'x-fingerprint': fingerprint,
    'x-version': xVersion,
  };
  if (ident) h['x-guid'] = ident;
  if (token) h['x-token'] = token;
  if (typeof ip === 'string' && ip) h['x-ip'] = ip;
  return h;
}

/**
 * Resolves the OS's SOURCE IP for reaching `host` — a UDP "routing probe".
 * Connecting a udp4 socket to an arbitrary port on `host` sends NO packets
 * (UDP connect() only sets the kernel's default peer for routing purposes);
 * it just makes the kernel pick a route, and `socket.address().address` is
 * the local interface IP that route would use. This is how the app learns
 * its own LAN-facing IP without hardcoding an interface name, for the `x-ip`
 * upgrade header (see buildUpgradeHeaders) so Protect shows the viewer's
 * real IP instead of the ds-daemon-proxy's 127.0.0.1.
 *
 * Pure Node (`dgram`), NOT Electron — `dgramFactory` is injectable so tests
 * can drive a fake socket without touching the real network. Never rejects:
 * any failure (bad host, closed socket, timeout) resolves `null`, and the
 * caller (connection.js's open()) treats that as "omit x-ip", the safe
 * pre-existing fallback.
 */
function localIpForHost(host, { timeoutMs = 500, dgramFactory } = {}) {
  const createSocket = dgramFactory || require('node:dgram').createSocket;
  return new Promise((resolve) => {
    let settled = false;
    let socket;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (socket) {
        try {
          socket.close();
        } catch {
          // ignore — socket already going away
        }
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    if (timer.unref) timer.unref();
    try {
      socket = createSocket('udp4');
      socket.on('error', () => finish(null));
      socket.connect(9, host, () => {
        try {
          finish(socket.address().address);
        } catch {
          finish(null);
        }
      });
    } catch {
      finish(null);
    }
  });
}

/**
 * Derives the `ds` daemon's WebSocket URL from the NVR's https base URL
 * (e.g. a saved profile's `https://<host>` — also used as-is for the admin
 * API and for native render). The admin/mint API lives on :443 behind the
 * UniFi OS reverse proxy; the UCP `ds` device daemon that actually accepts
 * viewer adoption lives on a SEPARATE port, :7442, on the SAME host. Only
 * the hostname is carried over — any port/path/query on the input is
 * discarded, never merged in, so a profile URL that happens to include a
 * non-standard https port (or a path, e.g. `/protect`) still yields plain
 * `wss://<hostname>:7442/viewer/1.0/ws`.
 */
function dsWsUrl(baseUrl, { port = 7442, path = '/viewer/1.0/ws' } = {}) {
  const { hostname } = new URL(baseUrl);
  return `wss://${hostname}:${port}${path}`;
}

module.exports = {
  encodeFrame,
  parseFrames,
  pairFrames,
  buildResponseFrames,
  buildDeviceInfo,
  parseConfigure,
  replyBodyFor,
  buildUpgradeHeaders,
  localIpForHost,
  dsWsUrl,
};
