'use strict';
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');

const pinning = require('../../src/main/viewport/adoption/pinning');
const { loadOrCreateIdentity } = require('../../src/main/viewport/adoption/identity');
const {
  mintToken,
  makeConnection,
  httpJson,
  probeAndPinWithTimeout,
} = require('../../src/main/viewport/adoption/mint');

// I1: pins are keyed by host:port, so :443 (mint) and :7442 (ws) get their OWN
// pin — deliberately DIFFERENT here so any accidental cross-port reuse would
// be caught by an equality assertion against the wrong constant.
const PIN_443 = { fp256: 'AA:BB:443', certPem: 'PINNED-PEM-443' };
const PIN_7442 = { fp256: 'CC:DD:7442', certPem: 'PINNED-PEM-7442' };

let dir;
let identity;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upv-mint-'));
  identity = loadOrCreateIdentity(dir);
  // Pre-pin 'nvr' at BOTH ports so every probeAndPin({host:'nvr',...}) call
  // below is a cache hit — no real TLS handshake, no real network, anywhere
  // in this file.
  pinning.savePin(dir, 'nvr', 443, PIN_443);
  pinning.savePin(dir, 'nvr', 7442, PIN_7442);
});
after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  mock.restoreAll();
});

/** Fakes https.request: routes on options.path, replies asynchronously. */
function fakeRequest(routes) {
  return (options, callback) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      setImmediate(() => {
        const route = routes[options.path];
        if (!route) {
          req.emit('error', new Error(`no fake route for ${options.path}`));
          return;
        }
        const res = new EventEmitter();
        res.statusCode = route.status;
        res.headers = route.headers || {};
        callback(res);
        if (route.body) res.emit('data', Buffer.from(route.body));
        res.emit('end');
      });
    };
    return req;
  };
}

describe('mint.httpJson', () => {
  after(() => mock.restoreAll());

  test('uses the pinned TLS options and never rejectUnauthorized:false', async () => {
    mock.method(
      https,
      'request',
      fakeRequest({ '/x': { status: 200, headers: {}, body: '{"ok":true}' } }),
    );
    const res = await httpJson({ url: 'https://nvr/x', method: 'GET' }, { dataDir: dir });
    assert.equal(res.status, 200);
    assert.equal(https.request.mock.calls.length, 1);
    const [options] = https.request.mock.calls[0].arguments;
    assert.equal(options.rejectUnauthorized, true); // pinned, never false
    assert.notEqual(options.rejectUnauthorized, false);
    assert.equal(options.ca, PIN_443.certPem); // :443 pin — never the :7442 one (I1)
    assert.equal(typeof options.checkServerIdentity, 'function');
    assert.equal(options.hostname, 'nvr');
    assert.equal(options.port, 443);
  });
});

describe('mint.mintToken', () => {
  after(() => mock.restoreAll());

  test('performs login -> manage-payload and returns { token, cookie }, pinned throughout', async () => {
    mock.method(
      https,
      'request',
      fakeRequest({
        '/api/auth/login': {
          status: 200,
          headers: { 'set-cookie': ['TOKEN=abc123; Path=/; HttpOnly'] },
          body: '',
        },
        '/proxy/protect/api/cameras/manage-payload': {
          status: 200,
          headers: {},
          body: JSON.stringify({ mgmt: { token: 'MINTED-TOKEN' } }),
        },
      }),
    );
    const minted = await mintToken({
      url: 'https://nvr/',
      username: 'admin',
      password: 'pw',
      dataDir: dir,
    });
    assert.equal(minted.token, 'MINTED-TOKEN');
    // The login session cookie is surfaced so the adopt flow can reuse it
    // (post-adopt rename) without a second login.
    assert.equal(minted.cookie, 'TOKEN=abc123');
    assert.equal(https.request.mock.calls.length, 2);
    for (const call of https.request.mock.calls) {
      const [options] = call.arguments;
      assert.equal(options.rejectUnauthorized, true);
      assert.notEqual(options.rejectUnauthorized, false);
      assert.equal(options.ca, PIN_443.certPem); // both login + manage-payload are :443
    }
    // manage-payload request carried the session cookie from login.
    const [mpOptions] = https.request.mock.calls[1].arguments;
    assert.equal(mpOptions.headers.cookie, 'TOKEN=abc123');
  });

  test('throws when login does not return HTTP 200', async () => {
    mock.method(
      https,
      'request',
      fakeRequest({ '/api/auth/login': { status: 401, headers: {}, body: '' } }),
    );
    await assert.rejects(
      () => mintToken({ url: 'https://nvr/', username: 'admin', password: 'wrong', dataDir: dir }),
      /login HTTP 401/,
    );
  });
});

describe('mint.makeConnection wsFactory', () => {
  after(() => mock.restoreAll());

  test('merges the given {cert,key,headers} with buildTlsOptions(pin); never rejectUnauthorized:false', async () => {
    require('ws'); // ensure it's in require.cache before we swap its exports
    const wsPath = require.resolve('ws');
    const wsModule = require.cache[wsPath];
    const OrigWS = wsModule.exports;
    let captured = null;
    class StubWS extends EventEmitter {
      constructor(url, protocols, opts) {
        super();
        captured = { url, protocols, opts };
        this.readyState = 1;
      }
      close() {}
    }
    wsModule.exports = StubWS;
    try {
      const conn = makeConnection({
        url: 'wss://nvr:7442/x',
        identity,
        token: 'TKN',
        name: 'TV',
        dataDir: dir,
      });
      const headers = {
        'sec-websocket-protocol': 'ucp4',
        'x-ident': identity.mac,
        'x-type': 'UP Viewport',
        'x-mode': '0',
        'x-fingerprint': 'FAKE-FP',
        'x-version': '1.4.33',
        'x-adopted': 'true',
        'x-token': 'TKN',
      };
      // Drive the async wsFactory the way connection.js's open() does: it
      // is already given the complete {cert,key,headers} — wsFactory must
      // not rebuild any of it, only layer pinning on top.
      await conn._wsFactory('wss://nvr:7442/x', {
        cert: identity.cert,
        key: identity.key,
        headers,
      });
      assert.equal(captured.url, 'wss://nvr:7442/x');
      assert.deepEqual(captured.protocols, []);
      // Pass-through, untouched by wsFactory.
      assert.equal(captured.opts.headers, headers);
      assert.equal(captured.opts.cert, identity.cert);
      assert.equal(captured.opts.key, identity.key);
      // Pinned TLS, merged on top — never rejectUnauthorized:false.
      assert.equal(captured.opts.rejectUnauthorized, true);
      assert.notEqual(captured.opts.rejectUnauthorized, false);
      assert.equal(captured.opts.ca, PIN_7442.certPem); // :7442 pin — never the :443 one (I1)
      assert.equal(typeof captured.opts.checkServerIdentity, 'function');
    } finally {
      wsModule.exports = OrigWS;
    }
  });

  // I1: on a UDM, :443 (web/admin, behind the UniFi OS reverse proxy) and
  // :7442 (the `ds` daemon) present DIFFERENT leaf certs. Before the fix,
  // pinning.js cached one pin per HOST, so this second probeAndPin call (for
  // :7442) reused the :443 pin instead of probing its own endpoint — which
  // would make the ds connection's checkServerIdentity fail against the
  // wrong cert on real hardware. Now pins are keyed by host:port, so each
  // endpoint gets its OWN pin — and a second call to the SAME host:port
  // still reuses its cache (no redundant probe).
  test('probes+pins :443 (mint) and :7442 (ws) on the same host INDEPENDENTLY; a repeat connect to the same host:port reuses its own pin', async () => {
    mock.method(https, 'request', fakeRequest({ '/x': { status: 200, headers: {}, body: '{}' } }));
    const probeSpy = mock.method(pinning, 'probeAndPin'); // wraps the real impl ('nvr' pre-pinned in before())

    await httpJson({ url: 'https://nvr/x', method: 'GET' }, { dataDir: dir });
    await httpJson({ url: 'https://nvr/x', method: 'GET' }, { dataDir: dir }); // repeat :443 call

    require('ws'); // ensure it's in require.cache before we swap its exports
    const wsPath = require.resolve('ws');
    const wsModule = require.cache[wsPath];
    const OrigWS = wsModule.exports;
    class StubWS extends EventEmitter {
      constructor() {
        super();
        this.readyState = 1;
      }
      close() {}
    }
    wsModule.exports = StubWS;
    try {
      const conn = makeConnection({ url: 'wss://nvr:7442/x', identity, dataDir: dir });
      await conn._wsFactory('wss://nvr:7442/x', {
        cert: identity.cert,
        key: identity.key,
        headers: {},
      });
    } finally {
      wsModule.exports = OrigWS;
    }

    assert.equal(probeSpy.mock.calls.length, 3);
    const [c1] = probeSpy.mock.calls[0].arguments;
    const [c2] = probeSpy.mock.calls[1].arguments;
    const [c3] = probeSpy.mock.calls[2].arguments;
    assert.deepEqual([c1.host, c1.port, c1.dir], ['nvr', 443, dir]);
    assert.deepEqual([c2.host, c2.port, c2.dir], ['nvr', 443, dir]);
    assert.deepEqual([c3.host, c3.port, c3.dir], ['nvr', 7442, dir]);

    const [pin1, pin2, pin3] = await Promise.all([
      probeSpy.mock.calls[0].result,
      probeSpy.mock.calls[1].result,
      probeSpy.mock.calls[2].result,
    ]);
    assert.deepEqual(pin1, PIN_443);
    assert.deepEqual(pin2, PIN_443); // same host:port -> reused, not re-probed from scratch
    assert.deepEqual(pin3, PIN_7442); // different port -> its OWN pin, never the :443 one
    assert.notDeepEqual(pin3, pin1);
  });
});

describe('mint.probeAndPinWithTimeout', () => {
  after(() => mock.restoreAll());

  test('rejects if the underlying probe never settles within timeoutMs', async () => {
    mock.method(pinning, 'probeAndPin', () => new Promise(() => {})); // never settles
    await assert.rejects(
      () => probeAndPinWithTimeout({ host: 'stuck', port: 443, dir, timeoutMs: 20 }),
      /timed out/i,
    );
  });

  test('resolves normally when the probe settles before the deadline', async () => {
    mock.method(pinning, 'probeAndPin', async () => PIN_443);
    const pin = await probeAndPinWithTimeout({ host: 'nvr', port: 443, dir, timeoutMs: 5000 });
    assert.deepEqual(pin, PIN_443);
  });
});
