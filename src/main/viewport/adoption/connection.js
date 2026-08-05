'use strict';

/**
 * @file connection.js
 * @description UCP viewer connection to the NVR device server (ds, :7442). No
 * Electron. Opens a WebSocket (created by an injected, possibly-async
 * `wsFactory` so the state machine is testable without a network), answers the
 * on-connect request sequence, stays Online by holding the socket, and emits
 * the interface events.
 *
 * SCOPE: connect, responder, online-on-open, configure->assignment,
 * changeUserPassword->onPassword persist, stop/cleanup, AND resilience:
 *
 *  - Idle watchdog: the server pings to prove liveness; silence is a dead
 *    link that `ws` won't otherwise surface. Every inbound frame/ping resets
 *    a timer of idleTimeoutMs; on expiry the socket is terminated, which
 *    drives the same unexpected-close reconnect path below.
 *  - Backoff reconnect: an UNEXPECTED close (see _onClose) schedules
 *    another open() after backoffFn(attempt), attempt incrementing per
 *    try and resetting to 0 on the next successful open.
 *  - Fatal classification: a ws upgrade rejected with HTTP 403 (fingerprint
 *    mismatch) or 412 (bad x-mode) can never be fixed by retrying, so it is
 *    surfaced as `error` with `.fatal = true` and reconnect is suppressed
 *    (see _failFatal). Every other failure is treated as transient and
 *    retried with backoff.
 *  - Keyless-after-first-online: the one-time adopt token is consumed by
 *    the first successful open (_onOpen nulls this._token); every
 *    subsequent open() — including all reconnects — authenticates keyless,
 *    via the pinned cert fingerprint alone.
 *
 * All timers go through the injected setTimeoutFn/clearTimeoutFn seams so
 * tests can drive them without a real clock.
 */

const { EventEmitter } = require('node:events');
const P = require('./protocol');
const { certFingerprint256 } = require('./identity');
const { nextBackoffMs } = require('./backoff');

class AdoptionConnection extends EventEmitter {
  constructor({
    url,
    identity,
    token = null,
    name,
    wsFactory,
    nowFn = () => Date.now(),
    deviceInfoOpts = {},
    onPassword = null,
    idleTimeoutMs = 40000,
    backoffFn = nextBackoffMs,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    xType = 'UP Viewport',
    xVersion = '1.4.33',
    localIpFn = P.localIpForHost,
  }) {
    super();
    this._url = url;
    this._identity = identity;
    this._token = token;
    this._name = name;
    this._wsFactory = wsFactory;
    this._now = nowFn;
    this._deviceInfoOpts = deviceInfoOpts;
    this._onPassword = onPassword;
    this._idleTimeoutMs = idleTimeoutMs;
    this._backoffFn = backoffFn;
    this._setTimeout = setTimeoutFn;
    this._clearTimeout = clearTimeoutFn;
    this._xType = xType;
    this._xVersion = xVersion;
    this._localIpFn = localIpFn;
    this._ws = null;
    this._queue = [];
    this._online = false;
    this._attempt = 0;
    this._reconnectTimer = null;
    this._idleTimer = null;
    this._stopped = false;
  }

  /** Opens the ws via the injected factory and wires the on-connect responder. */
  async open() {
    if (this._stopped) return;
    let ws;
    try {
      const fingerprint = certFingerprint256(this._identity);
      // Best-effort: the real viewer LAN IP for the x-ip header (so Protect
      // shows it instead of the ds-daemon-proxy's 127.0.0.1). Never lets a
      // resolution failure (bad URL, probe error/timeout) break the
      // connection — headers just come out unchanged, today's behavior.
      let ip = null;
      try {
        ip = await this._localIpFn(new URL(this._url).hostname).catch(() => null);
      } catch {
        ip = null;
      }
      const headers = {
        ...P.buildUpgradeHeaders({
          mac: this._identity.mac,
          ident: this._identity.ident,
          fingerprint,
          token: this._token,
          ip,
          xType: this._xType,
          xVersion: this._xVersion,
        }),
        'x-adopted': 'true',
      };
      ws = await this._wsFactory(this._url, {
        cert: this._identity.cert,
        key: this._identity.key,
        headers,
      });
    } catch (e) {
      // wsFactory rejecting is a transient (network-level) failure, not a
      // fatal classification (those only arrive via the ws upgrade
      // response/error below) — retry with backoff, unless stop() already
      // raced us here.
      if (this._stopped) return;
      this._emit('error', e);
      this._scheduleReconnect();
      return;
    }
    if (this._stopped) {
      // stop() ran while the (possibly async) wsFactory was in flight —
      // don't wire up a socket the caller no longer wants.
      try {
        ws.close();
      } catch {
        // ignore — socket already going away
      }
      return;
    }
    this._ws = ws;
    this._queue = [];
    ws.on('open', () => this._onOpen());
    ws.on('message', (data) => this._onMessage(data));
    ws.on('ping', () => this._resetIdle());
    ws.on('close', () => this._onClose());
    ws.on('unexpected-response', (_req, res) => this._onUnexpected(res));
    ws.on('error', (e) => {
      // 403/412 normally arrive via 'unexpected-response' above, not here —
      // this branch is defensive in case some ws error path ever carries
      // the status code directly on the error object instead.
      if (e && this._isFatalCode(e.statusCode)) this._failFatal(e.statusCode);
      else this._emit('error', e);
    });
  }

  /** Closes the socket and stops the state machine. Safe pre-open / repeat calls. */
  stop() {
    this._stopped = true;
    if (this._reconnectTimer) this._clearTimeout(this._reconnectTimer);
    if (this._idleTimer) this._clearTimeout(this._idleTimer);
    this._reconnectTimer = null;
    this._idleTimer = null;
    if (this._ws) {
      // Strip listeners BEFORE close() so this intentional close never
      // reaches _onClose — 'closed' (and the reconnect it schedules) only
      // ever fires for an UNEXPECTED disconnect. _scheduleReconnect is also
      // gated on _stopped as defense in depth, so a reconnect can never
      // fire after stop() even if a timer callback is already in flight.
      if (this._ws.removeAllListeners) this._ws.removeAllListeners();
      try {
        this._ws.close();
      } catch {
        // ignore — socket already going away
      }
    }
    this._ws = null;
    this._online = false;
  }

  // Online is CONNECTION-BASED: no handshake is required, just hold the
  // socket open. The one-time adopt token is consumed on first connect:
  // _token is nulled here, so every open() from here on — including every
  // reconnect — builds keyless headers (buildUpgradeHeaders omits x-token
  // when it's null), authenticating via the pinned cert fingerprint alone.
  // A successful open also proves the link is healthy again, so the
  // backoff attempt counter resets.
  _onOpen() {
    this._attempt = 0;
    this._token = null;
    this._online = true;
    this._resetIdle();
    this._emit('open');
    this._emit('online');
  }

  _onMessage(data) {
    if (!Buffer.isBuffer(data)) return;
    // WS messages are atomic ([envelope][body] delivered whole) and always
    // contain complete pairs, so each message is parsed independently — the
    // queue is reset here, NOT carried across messages. Carrying a leftover
    // (e.g. from a truncated/malformed frame within one message) into the
    // next message's parse would silently mis-pair the next message's own
    // envelope/body against the stale leftover, desyncing every echo after
    // it until reconnect.
    this._queue = [];
    for (const f of P.parseFrames(data)) {
      if (f.truncated) continue;
      try {
        this._queue.push(JSON.parse(f.payload.toString('utf8')));
      } catch {
        // skip non-JSON frame
      }
    }
    const { pairs, remainder } = P.pairFrames(this._queue);
    this._queue = remainder;
    for (const { envelope, body } of pairs) this._handlePair(envelope, body);
    // Any inbound frame proves the link is alive — reset the idle watchdog.
    this._resetIdle();
  }

  _handlePair(envelope, body) {
    if (!envelope || envelope.type !== 'request') return;
    const action = envelope.action;
    if (action === 'configure') this._emit('assignment', P.parseConfigure(body));
    if (action === 'changeUserPassword' && body && body.passwordNew && this._onPassword) {
      // See _emit()'s doc: a throwing consumer must not abort processing
      // of the remaining pairs in this message.
      try {
        this._onPassword(body.passwordNew);
      } catch {
        // swallow — consumer's problem, not ours to propagate
      }
    }
    // Every on-connect action gets acked, including enableUpdatesChannel —
    // which MUST be acked but must NEVER open a second socket (confirmed
    // backend behavior). replyBodyFor -> {} for anything but getInfo, and
    // nothing in this method ever calls open()/wsFactory again.
    const replyBody = P.replyBodyFor(action, {
      identity: this._identity,
      name: this._name,
      deviceInfoOpts: this._deviceInfoOpts,
    });
    const out = P.buildResponseFrames(envelope, replyBody, this._now());
    if (this._ws && this._ws.readyState === 1) this._ws.send(out);
  }

  // 'close' on the ws only ever reaches here for an UNEXPECTED disconnect
  // (server hangup, network drop, idle-watchdog termination) — stop()
  // strips all ws listeners before it closes the socket, so an intentional
  // stop() never fires this handler and therefore never schedules a
  // reconnect.
  _onClose() {
    this._online = false;
    if (this._idleTimer) this._clearTimeout(this._idleTimer);
    this._idleTimer = null;
    this._emit('closed');
    this._scheduleReconnect();
  }

  /** Resets the idle watchdog: fires _onIdle() after idleTimeoutMs of silence. */
  _resetIdle() {
    if (this._idleTimer) this._clearTimeout(this._idleTimer);
    this._idleTimer = this._arm(() => this._onIdle(), this._idleTimeoutMs);
  }

  // The server pings on a live link; if idleTimeoutMs passes with no
  // inbound frame/ping at all, the link is presumed dead (ws won't
  // otherwise surface a half-open TCP connection). Terminate it — the
  // resulting 'close' event drives the normal unexpected-close reconnect
  // path in _onClose.
  _onIdle() {
    this._idleTimer = null;
    if (this._ws) {
      try {
        if (this._ws.terminate) this._ws.terminate();
        else this._ws.close();
      } catch {
        // ignore — socket already going away
      }
    }
  }

  _isFatalCode(code) {
    return code === 403 || code === 412;
  }

  // A fingerprint mismatch (403) or bad x-mode (412) can never be fixed by
  // retrying, so it's surfaced to the UI and reconnect is suppressed by
  // latching _stopped — _scheduleReconnect() checks it and bails.
  //
  // IMPORTANT: real `ws` (8.18) does NOT clean up after itself here. Once a
  // consumer listens for 'unexpected-response' (open() does), ws skips its
  // own abortHandshake — so on a real 403/412 no 'close'/'error' event ever
  // follows on its own and the TCP socket would leak forever, stuck in
  // CONNECTING. This method must therefore terminate the socket itself
  // (mirrors stop()/_onIdle's pattern) and drop the reference, exactly as
  // if this were an intentional stop of a half-open connection.
  _failFatal(code) {
    const err = new Error(`fatal UCP upgrade rejected: HTTP ${code}`);
    err.fatal = true;
    this._stopped = true;
    if (this._reconnectTimer) this._clearTimeout(this._reconnectTimer);
    if (this._idleTimer) this._clearTimeout(this._idleTimer);
    this._reconnectTimer = null;
    this._idleTimer = null;
    this._emit('error', err);
    if (this._ws) {
      try {
        if (this._ws.terminate) this._ws.terminate();
        else this._ws.close();
      } catch {
        // ignore — socket already going away
      }
      this._ws = null;
    }
  }

  _onUnexpected(res) {
    const code = res && res.statusCode;
    if (this._isFatalCode(code)) this._failFatal(code);
  }

  // Schedules another open() after backoffFn(attempt), incrementing the
  // attempt counter each call; _onOpen() resets it to 0 on success. Gated
  // on _stopped as the single choke point that keeps a reconnect from ever
  // firing after stop() (or after a fatal 403/412 latches _stopped).
  _scheduleReconnect() {
    if (this._stopped) return;
    const delay = this._backoffFn(this._attempt++);
    this._reconnectTimer = this._arm(() => {
      this._reconnectTimer = null;
      this.open();
    }, delay);
  }

  // Arms a timer via the injected setTimeoutFn and, when it's the real
  // setTimeout (i.e. the timer object supports it), unrefs it — the idle
  // watchdog and reconnect timers are background housekeeping and must
  // never be the reason a process (or a test run) stays alive/hangs.
  // Fake timer doubles used in tests are plain objects with no .unref, so
  // this is a no-op against them.
  _arm(fn, ms) {
    const t = this._setTimeout(fn, ms);
    if (t && typeof t.unref === 'function') t.unref();
    return t;
  }

  /**
   * Emits an event guarded against a throwing listener. A consumer
   * callback that throws must not abort processing of the remaining
   * frames/pairs in the current message, nor unwind out of a ws event
   * handler — so every emit in this class goes through here instead of
   * calling this.emit() directly.
   */
  _emit(event, ...args) {
    try {
      this.emit(event, ...args);
    } catch {
      // swallow — a throwing consumer must not break the state machine
    }
  }
}

module.exports = { AdoptionConnection };
