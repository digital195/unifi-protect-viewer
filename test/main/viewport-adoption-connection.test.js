'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AdoptionConnection } = require('../../src/main/viewport/adoption/connection');
const P = require('../../src/main/viewport/adoption/protocol');
const {
  loadOrCreateIdentity,
  certFingerprint256,
} = require('../../src/main/viewport/adoption/identity');

// Fake ws: records raw binary sends; lets the test push server frames.
// terminate()/close() are the ONLY things that emit 'close' — mirroring
// real `ws`, where a dead/aborted socket only closes because something
// (the watchdog, stop(), the fatal path) actively tore it down, never on
// its own just because 'unexpected-response' or 'error' fired. Tests must
// not hand-emit 'close' to simulate cleanup; they should assert the
// connection called terminate()/close() itself.
class FakeWs extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.readyState = 1;
    this.closed = false;
    this.terminateCalls = 0;
    this.closeCalls = 0;
  }
  send(buf) {
    this.sent.push(buf);
  }
  close() {
    this.closeCalls++;
    this.closed = true;
    this.emit('close');
  }
  terminate() {
    this.terminateCalls++;
    this.closed = true;
    this.emit('close');
  }
}

const tick = () => new Promise((r) => setImmediate(r));

// Real self-signed identity (loadOrCreateIdentity persists a real PEM cert,
// so certFingerprint256 — called by connection.js's open() — works).
let dir;
let identity;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upv-conn-'));
  identity = loadOrCreateIdentity(dir);
});
after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// One NVR->device request as a two-frame binary message.
function requestMsg(action, body, id) {
  return Buffer.concat([
    P.encodeFrame({ timestamp: 1, type: 'request', action, id }),
    P.encodeFrame(body || {}),
  ]);
}

// A raw (non-JSON) frame, for exercising the malformed-frame path.
function rawFrame(payload, ver = 1, type = 1) {
  const head = Buffer.alloc(8);
  head[0] = ver;
  head[1] = type;
  head.writeUIntBE(payload.length, 2, 6);
  return Buffer.concat([head, payload]);
}

// localIpFn defaults to a resolved-null fake here (NOT the real
// P.localIpForHost) so tests stay hermetic — the test fixture's 'nvr'
// hostname isn't a real address and a genuine dgram/DNS probe against it has
// no bounded failure mode in a sandboxed/offline environment. Tests that
// specifically cover the x-ip wiring pass their own localIpFn via `extra`.
function newConn(fake, extra = {}) {
  return new AdoptionConnection({
    url: 'wss://nvr:7442/viewer/1.0/ws',
    identity,
    token: 'TKN',
    name: 'Wall TV',
    wsFactory: () => fake,
    nowFn: () => 1000,
    localIpFn: () => Promise.resolve(null),
    ...extra,
  });
}

describe('AdoptionConnection (UCP core)', () => {
  test('emits online on open (connection-based)', async () => {
    const fake = new FakeWs();
    const conn = newConn(fake);
    const events = [];
    conn.on('online', () => events.push('online'));
    await conn.open();
    fake.emit('open');
    assert.deepEqual(events, ['online']);
  });

  test('open() sends the UCP upgrade header set + cert/key to wsFactory', async () => {
    const fake = new FakeWs();
    let capturedUrl;
    let capturedOpts;
    const conn = newConn(fake, {
      wsFactory: (url, opts) => {
        capturedUrl = url;
        capturedOpts = opts;
        return fake;
      },
    });
    await conn.open();
    assert.equal(capturedUrl, 'wss://nvr:7442/viewer/1.0/ws');
    assert.equal(capturedOpts.cert, identity.cert);
    assert.equal(capturedOpts.key, identity.key);
    assert.deepEqual(capturedOpts.headers, {
      'sec-websocket-protocol': 'ucp4',
      'x-ident': identity.mac,
      'x-type': 'UP Viewport',
      'x-mode': '0',
      'x-fingerprint': certFingerprint256(identity),
      'x-version': '1.4.33',
      'x-guid': identity.ident,
      'x-token': 'TKN',
      'x-adopted': 'true',
    });
  });

  test('open() includes x-ip when the injected localIpFn resolves an address', async () => {
    const fake = new FakeWs();
    let capturedOpts;
    let seenHost;
    const conn = newConn(fake, {
      wsFactory: (url, opts) => {
        capturedOpts = opts;
        return fake;
      },
      localIpFn: (host) => {
        seenHost = host;
        return Promise.resolve('192.168.50.42');
      },
    });
    await conn.open();
    assert.equal(seenHost, 'nvr'); // hostname parsed from this._url
    assert.equal(capturedOpts.headers['x-ip'], '192.168.50.42');
  });

  test('open() omits x-ip when the injected localIpFn resolves null (connection still opens)', async () => {
    const fake = new FakeWs();
    let capturedOpts;
    const conn = newConn(fake, {
      wsFactory: (url, opts) => {
        capturedOpts = opts;
        return fake;
      },
      localIpFn: () => Promise.resolve(null),
    });
    const events = [];
    conn.on('online', () => events.push('online'));
    await conn.open();
    assert.equal('x-ip' in capturedOpts.headers, false);
    fake.emit('open');
    assert.deepEqual(events, ['online']); // still connects/goes online normally
  });

  test('open() omits x-ip when the injected localIpFn rejects (failure does not break the connection)', async () => {
    const fake = new FakeWs();
    let capturedOpts;
    const conn = newConn(fake, {
      wsFactory: (url, opts) => {
        capturedOpts = opts;
        return fake;
      },
      localIpFn: () => Promise.reject(new Error('probe boom')),
    });
    await conn.open();
    assert.equal('x-ip' in capturedOpts.headers, false);
  });

  test('open() omits x-token when no token is set', async () => {
    const fake = new FakeWs();
    let capturedOpts;
    const conn = newConn(fake, {
      token: null,
      wsFactory: (url, opts) => {
        capturedOpts = opts;
        return fake;
      },
    });
    await conn.open();
    assert.equal('x-token' in capturedOpts.headers, false);
  });

  test('answers getInfo with a device-info body (two frames, echoed id)', async () => {
    const fake = new FakeWs();
    const conn = newConn(fake);
    await conn.open();
    fake.emit('open');
    fake.emit('message', requestMsg('getInfo', {}, 7));
    await tick();
    assert.equal(fake.sent.length, 1);
    const frames = P.parseFrames(fake.sent[0]);
    const env = JSON.parse(frames[0].payload.toString('utf8'));
    const body = JSON.parse(frames[1].payload.toString('utf8'));
    assert.deepEqual(env, { timestamp: 1000, type: 'response', action: 'getInfo', id: 7 });
    assert.equal(body.mac, identity.mac);
    assert.equal(body.modelKey, 'viewer');
  });

  test('acks networkStatus/enableUpdatesChannel with {} and opens NO second socket', async () => {
    const fake = new FakeWs();
    let factoryCalls = 0;
    const conn = newConn(fake, {
      wsFactory: () => {
        factoryCalls += 1;
        return fake;
      },
      nowFn: () => 1,
    });
    await conn.open();
    fake.emit('open');
    fake.emit('message', requestMsg('networkStatus', {}, 1));
    fake.emit(
      'message',
      requestMsg('enableUpdatesChannel', { uri: 'wss://nvr:7442', lastUpdateId: 9 }, 2),
    );
    await tick();
    assert.equal(factoryCalls, 1); // never dials the updates channel
    for (const buf of fake.sent) {
      const body = JSON.parse(P.parseFrames(buf)[1].payload.toString('utf8'));
      assert.deepEqual(body, {});
    }
  });

  test('configure emits assignment{liveviewId,liveview} and acks {}', async () => {
    const fake = new FakeWs();
    const conn = newConn(fake);
    const seen = [];
    conn.on('assignment', (a) => seen.push(a));
    await conn.open();
    fake.emit('open');
    fake.emit('message', requestMsg('configure', { liveview: { id: 'lv9', layout: 5 } }, 3));
    await tick();
    assert.deepEqual(seen, [{ liveviewId: 'lv9', liveview: { id: 'lv9', layout: 5 } }]);
    const body = JSON.parse(P.parseFrames(fake.sent[0])[1].payload.toString('utf8'));
    assert.deepEqual(body, {});
  });

  test('configure with no liveview emits assignment(null) (unassign) and acks {}', async () => {
    const fake = new FakeWs();
    const conn = newConn(fake);
    const seen = [];
    conn.on('assignment', (a) => seen.push(a));
    await conn.open();
    fake.emit('open');
    fake.emit('message', requestMsg('configure', {}, 5));
    await tick();
    assert.deepEqual(seen, [null]);
    const body = JSON.parse(P.parseFrames(fake.sent[0])[1].payload.toString('utf8'));
    assert.deepEqual(body, {});
  });

  test('changeUserPassword acks {} and reports passwordNew via onPassword', async () => {
    const fake = new FakeWs();
    const pw = [];
    const conn = newConn(fake, { onPassword: (p) => pw.push(p) });
    await conn.open();
    fake.emit('open');
    fake.emit(
      'message',
      requestMsg('changeUserPassword', { username: 'ubnt', passwordOld: 'a', passwordNew: 'b' }, 4),
    );
    await tick();
    assert.deepEqual(pw, ['b']);
    assert.deepEqual(JSON.parse(P.parseFrames(fake.sent[0])[1].payload.toString('utf8')), {});
  });

  test('a malformed frame in one message does not desync pairing of the next message', async () => {
    const fake = new FakeWs();
    const conn = newConn(fake);
    const seen = [];
    conn.on('assignment', (a) => seen.push(a));
    await conn.open();
    fake.emit('open');
    // A message with a valid envelope but a non-JSON body frame: the body
    // fails JSON.parse and is dropped, leaving an unpaired envelope. If the
    // decode queue carried across messages (the pre-fix bug), this leftover
    // envelope would mis-pair against the NEXT message's own envelope/body.
    const badMsg = Buffer.concat([
      P.encodeFrame({ timestamp: 1, type: 'request', action: 'configure', id: 40 }),
      rawFrame(Buffer.from('not-json', 'utf8')),
    ]);
    fake.emit('message', badMsg);
    fake.emit('message', requestMsg('configure', { liveview: { id: 'lv7', layout: 2 } }, 41));
    await tick();
    assert.deepEqual(seen, [{ liveviewId: 'lv7', liveview: { id: 'lv7', layout: 2 } }]);
    assert.equal(fake.sent.length, 1);
    const env = JSON.parse(P.parseFrames(fake.sent[0])[0].payload.toString('utf8'));
    assert.equal(env.id, 41);
  });

  test('stop() closes the socket and blocks further reconnects', async () => {
    const fake = new FakeWs();
    const conn = newConn(fake);
    await conn.open();
    fake.emit('open');
    conn.stop();
    assert.equal(fake.closed, true);
  });

  test('stop() before open() is a safe no-op', () => {
    const conn = newConn(new FakeWs());
    assert.doesNotThrow(() => conn.stop());
  });

  test('stop() is idempotent when called twice', async () => {
    const fake = new FakeWs();
    const conn = newConn(fake);
    await conn.open();
    fake.emit('open');
    conn.stop();
    assert.doesNotThrow(() => conn.stop());
    assert.equal(fake.closed, true);
  });
});

describe('AdoptionConnection (resilience)', () => {
  // Controllable timer doubles.
  function fakeTimers() {
    const timers = [];
    const setT = (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    };
    const clearT = (t) => {
      if (t) t.cleared = true;
    };
    const runLast = () => {
      const t = timers[timers.length - 1];
      if (t && !t.cleared) t.fn();
    };
    return { setT, clearT, timers, runLast };
  }

  test('reconnects with backoff after an unexpected close, resetting the attempt counter on a successful open', async () => {
    const ft = fakeTimers();
    let calls = 0;
    const sockets = [new FakeWs(), new FakeWs(), new FakeWs()];
    const seenAttempts = [];
    const conn = new AdoptionConnection({
      url: 'wss://nvr:7442/x',
      identity,
      token: 'T',
      name: 'TV',
      wsFactory: () => sockets[calls++],
      nowFn: () => 1,
      backoffFn: (attempt) => {
        seenAttempts.push(attempt);
        return (attempt + 1) * 100;
      },
      setTimeoutFn: ft.setT,
      clearTimeoutFn: ft.clearT,
      localIpFn: () => Promise.resolve(null),
    });
    await conn.open(); // dial #1
    sockets[0].emit('open');
    sockets[0].emit('close'); // unexpected close -> schedules reconnect at attempt 0
    let reconnectTimer = ft.timers[ft.timers.length - 1];
    assert.equal(reconnectTimer.ms, 100); // attempt 0 -> 100ms
    assert.deepEqual(seenAttempts, [0]);
    reconnectTimer.fn(); // fire reconnect -> dial #2
    await tick();
    assert.equal(calls, 2); // wsFactory called again

    // A SUCCESSFUL open on the reconnect must reset the attempt counter to
    // 0 — otherwise an occasionally-flaky long-lived link would ratchet its
    // backoff up forever instead of treating each fresh disconnect as a
    // first offense. Distinguishing this from "kept incrementing" requires
    // a SECOND close-then-reconnect cycle and comparing the attempt seen
    // each time.
    sockets[1].emit('open');
    sockets[1].emit('close'); // another unexpected close
    reconnectTimer = ft.timers[ft.timers.length - 1];
    assert.deepEqual(seenAttempts, [0, 0]); // attempt 0 again, NOT 1 -> proves the reset
    assert.equal(reconnectTimer.ms, 100);
    reconnectTimer.fn(); // fire reconnect -> dial #3
    await tick();
    assert.equal(calls, 3);
  });

  test('read-idle watchdog terminates a silent socket and the resulting close schedules a reconnect', async () => {
    const ft = fakeTimers();
    let calls = 0;
    const sockets = [new FakeWs(), new FakeWs()];
    const conn = new AdoptionConnection({
      url: 'wss://nvr:7442/x',
      identity,
      token: 'T',
      name: 'TV',
      wsFactory: () => sockets[calls++],
      nowFn: () => 1,
      idleTimeoutMs: 500,
      backoffFn: () => 50,
      setTimeoutFn: ft.setT,
      clearTimeoutFn: ft.clearT,
      localIpFn: () => Promise.resolve(null),
    });
    await conn.open();
    sockets[0].emit('open'); // arms the idle timer (timers[0])
    ft.runLast(); // fire the idle timeout -> terminate()
    assert.equal(sockets[0].closed, true);
    // terminate() emits 'close' (as a real dead socket eventually would),
    // which must drive the SAME unexpected-close reconnect path as any
    // other unexpected disconnect: a new backoff timer is scheduled.
    const reconnectTimer = ft.timers[ft.timers.length - 1];
    assert.equal(reconnectTimer.ms, 50);
    reconnectTimer.fn();
    await tick();
    assert.equal(calls, 2); // wsFactory dialed again after the idle-triggered reconnect
  });

  test('403 (fp mismatch) is fatal: terminates the leaked socket itself, emits error.fatal, and does NOT reconnect', async () => {
    // Real `ws` (8.18): once a consumer listens for 'unexpected-response'
    // (open() does), ws SKIPS its own abortHandshake — so on a real 403/412
    // NO 'close'/'error' event ever follows on its own; the TCP socket
    // would leak forever (stuck CONNECTING) unless the connection tears it
    // down itself. FakeWs mirrors this: only terminate()/close() emit
    // 'close', so this test proves _failFatal() actually calls
    // terminate() — it does NOT hand-emit 'close' to simulate cleanup.
    const ft = fakeTimers();
    let calls = 0;
    const fake = new FakeWs();
    const conn = new AdoptionConnection({
      url: 'wss://nvr:7442/x',
      identity,
      token: 'T',
      name: 'TV',
      wsFactory: () => {
        calls++;
        return fake;
      },
      nowFn: () => 1,
      setTimeoutFn: ft.setT,
      clearTimeoutFn: ft.clearT,
      localIpFn: () => Promise.resolve(null),
    });
    const errs = [];
    conn.on('error', (e) => errs.push(e));
    await conn.open();
    fake.emit('unexpected-response', {}, { statusCode: 403 });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].fatal, true);
    assert.equal(fake.terminateCalls, 1); // the connection itself cleaned up the socket
    assert.equal(fake.closeCalls, 0); // via terminate(), not close()
    assert.equal(ft.timers.length, 0); // no reconnect scheduled
    assert.equal(calls, 1);
  });

  test('drops the token after the first successful open (keyless reconnect)', async () => {
    // NOTE: adapted from the brief's literal `o.token` shape to the real
    // wsFactory contract shipped in Task 5 — open() passes {cert, key,
    // headers}, and the token rides in headers['x-token'] (or is absent).
    const seenTokens = [];
    let calls = 0;
    const sockets = [new FakeWs(), new FakeWs()];
    const conn = new AdoptionConnection({
      url: 'wss://nvr:7442/x',
      identity,
      token: 'TKN',
      name: 'TV',
      wsFactory: (_url, o) => {
        seenTokens.push(o.headers['x-token'] || null);
        return sockets[calls++];
      },
      nowFn: () => 1,
      backoffFn: () => 1,
      setTimeoutFn: (fn) => ({ fn }),
      clearTimeoutFn: () => {},
      localIpFn: () => Promise.resolve(null),
    });
    await conn.open();
    sockets[0].emit('open'); // consumes token
    sockets[0].emit('close');
    // manually drive the reconnect the fake timer captured
    await conn.open();
    assert.equal(seenTokens[0], 'TKN');
    assert.equal(seenTokens[1], null); // keyless
  });

  test('stop() cancels a pending reconnect timer; no reconnect fires even if the stale callback runs', async () => {
    const ft = fakeTimers();
    let calls = 0;
    const fake = new FakeWs();
    const conn = new AdoptionConnection({
      url: 'wss://nvr:7442/x',
      identity,
      token: 'T',
      name: 'TV',
      wsFactory: () => {
        calls++;
        return fake;
      },
      nowFn: () => 1,
      backoffFn: (n) => (n + 1) * 100,
      setTimeoutFn: ft.setT,
      clearTimeoutFn: ft.clearT,
      localIpFn: () => Promise.resolve(null),
    });
    await conn.open();
    fake.emit('open');
    fake.emit('close'); // unexpected close -> schedules a reconnect timer
    const reconnectTimer = ft.timers[ft.timers.length - 1];
    assert.equal(reconnectTimer.cleared, false);
    conn.stop();
    assert.equal(reconnectTimer.cleared, true); // stop() cancelled it
    // Even if a stale timer callback still fires (e.g. a real timer that
    // was mid-flight when clearTimeout ran), the internal _stopped guard in
    // open() must make it a no-op: no second wsFactory call.
    reconnectTimer.fn();
    await tick();
    assert.equal(calls, 1);
  });

  test("stop() clears an armed idle watchdog directly — not merely inherited from a prior close's cleanup", async () => {
    // NOTE: _onClose() also clears the idle timer as part of its own
    // cleanup, so a test that goes open -> close -> stop() would pass this
    // assertion for the WRONG reason (already cleared before stop() ever
    // ran). Isolate stop()'s own idle-clear branch by calling it with the
    // idle timer armed and NO intervening close.
    const ft = fakeTimers();
    let calls = 0;
    const fake = new FakeWs();
    const conn = new AdoptionConnection({
      url: 'wss://nvr:7442/x',
      identity,
      token: 'T',
      name: 'TV',
      wsFactory: () => {
        calls++;
        return fake;
      },
      nowFn: () => 1,
      setTimeoutFn: ft.setT,
      clearTimeoutFn: ft.clearT,
      localIpFn: () => Promise.resolve(null),
    });
    await conn.open();
    fake.emit('open'); // arms ONLY the idle watchdog
    assert.equal(ft.timers.length, 1);
    const idleTimer = ft.timers[0];
    assert.equal(idleTimer.cleared, false);
    conn.stop(); // must clear it directly — _onClose never ran
    assert.equal(idleTimer.cleared, true);
    // Firing the (cleared) idle callback anyway must not resurrect the
    // connection: no terminate on a socket stop() already tore down
    // (stop() nulls this._ws), and no reconnect scheduled.
    idleTimer.fn();
    await tick();
    assert.equal(calls, 1);
    assert.equal(ft.timers.length, 1); // stop() did not itself schedule anything
  });

  test('a throwing consumer callback (assignment listener or onPassword) does not abort processing of the remaining pairs in one message', async () => {
    const fake = new FakeWs();
    const seenAssign = [];
    const conn = newConn(fake, {
      onPassword: () => {
        throw new Error('onPassword boom');
      },
    });
    conn.on('assignment', (a) => {
      seenAssign.push(a);
      if (seenAssign.length === 1) throw new Error('assignment boom');
    });
    await conn.open();
    fake.emit('open');
    // One WS message carrying THREE request pairs back to back: configure
    // (assignment listener throws), changeUserPassword (onPassword
    // throws), configure again. All three must still get acked, and the
    // second configure's assignment must still be observed.
    const msg = Buffer.concat([
      P.encodeFrame({ timestamp: 1, type: 'request', action: 'configure', id: 10 }),
      P.encodeFrame({ liveview: { id: 'lvA', layout: 1 } }),
      P.encodeFrame({ timestamp: 1, type: 'request', action: 'changeUserPassword', id: 11 }),
      P.encodeFrame({ username: 'ubnt', passwordOld: 'a', passwordNew: 'b' }),
      P.encodeFrame({ timestamp: 1, type: 'request', action: 'configure', id: 12 }),
      P.encodeFrame({ liveview: { id: 'lvB', layout: 2 } }),
    ]);
    fake.emit('message', msg);
    await tick();
    assert.equal(seenAssign.length, 2);
    assert.deepEqual(seenAssign[1], { liveviewId: 'lvB', liveview: { id: 'lvB', layout: 2 } });
    assert.equal(fake.sent.length, 3); // all three pairs still acked
  });
});
