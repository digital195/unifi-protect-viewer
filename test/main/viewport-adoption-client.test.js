'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AdoptionClient } = require('../../src/main/viewport/adoption');

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upv-cl-'));
});
after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});
const tick = () => new Promise((r) => setImmediate(r));

function fakeConn() {
  const c = new EventEmitter();
  c.open = async () => {};
  c.stop = () => {
    c.stopped = true;
  };
  return c;
}

describe('AdoptionClient', () => {
  test('mints a token (creds present), re-emits online/adopted/assignment as objects', async () => {
    const conn = fakeConn();
    const client = new AdoptionClient();
    let mintedWith = null;
    const seen = [];
    client.on('online', (v) => seen.push(['online', v]));
    client.on('adopted', (a) => seen.push(['adopted', a]));
    client.on('assignment', (a) => seen.push(['assignment', a]));
    await client.start({
      url: 'https://nvr',
      username: 'admin',
      password: 'pw',
      deviceName: 'TV',
      dataDir: dir,
      mintToken: async (c) => {
        mintedWith = c;
        return { token: 'TOKEN', cookie: 'TOKEN=abc' };
      },
      connectionFactory: () => conn,
    });
    assert.equal(mintedWith.username, 'admin');
    conn.emit('online');
    conn.emit('assignment', { liveviewId: 'lv3', liveview: { id: 'lv3' } });
    await tick();
    assert.deepEqual(seen, [
      ['online', true],
      ['adopted', { viewerId: null }],
      ['assignment', { liveviewId: 'lv3', liveview: { id: 'lv3' } }],
    ]);
    client.stop();
    assert.ok(conn.stopped);
  });

  test('keyless: no creds -> does NOT mint a token', async () => {
    const conn = fakeConn();
    const client = new AdoptionClient();
    let minted = false;
    await client.start({
      url: 'https://nvr',
      deviceName: 'TV',
      dataDir: dir,
      mintToken: async () => {
        minted = true;
        return { token: 'X', cookie: 'TOKEN=x' };
      },
      connectionFactory: (opts) => {
        assert.equal(opts.token, null); // keyless connect
        return conn;
      },
    });
    assert.equal(minted, false);
  });

  test('emits error when token minting fails, does not throw', async () => {
    const client = new AdoptionClient();
    const errs = [];
    client.on('error', (e) => errs.push(e));
    await client.start({
      url: 'https://nvr',
      username: 'admin',
      password: 'bad',
      deviceName: 'TV',
      dataDir: dir,
      mintToken: async () => {
        throw new Error('login 401');
      },
      connectionFactory: () => {
        throw new Error('should not reach');
      },
    });
    assert.equal(errs.length, 1);
    assert.match(errs[0].message, /401/);
  });

  test('passes through fatal errors from the connection', async () => {
    const conn = fakeConn();
    const client = new AdoptionClient();
    const errs = [];
    client.on('error', (e) => errs.push(e));
    await client.start({
      url: 'https://nvr',
      deviceName: 'TV',
      dataDir: dir,
      connectionFactory: () => conn,
    });
    const fatal = new Error('fatal UCP upgrade rejected: HTTP 403');
    fatal.fatal = true;
    conn.emit('error', fatal);
    await tick();
    assert.equal(errs[0].fatal, true);
    assert.match(errs[0].message, /403/);
  });

  test('creds present: mintFn is called once and the minted token is passed to connectionFactory', async () => {
    const conn = fakeConn();
    const client = new AdoptionClient();
    let mintCalls = 0;
    let seenToken;
    await client.start({
      url: 'https://nvr',
      username: 'admin',
      password: 'pw',
      deviceName: 'TV',
      dataDir: dir,
      mintToken: async () => {
        mintCalls += 1;
        return { token: 'MINTED-TOKEN', cookie: 'TOKEN=abc' };
      },
      connectionFactory: (opts) => {
        seenToken = opts.token;
        return conn;
      },
    });
    assert.equal(mintCalls, 1);
    assert.equal(seenToken, 'MINTED-TOKEN');
  });

  test('stop() is idempotent and null-safe', async () => {
    const client = new AdoptionClient();
    // Calling stop() before start() must not throw.
    assert.doesNotThrow(() => client.stop());

    const conn = fakeConn();
    let stopCalls = 0;
    const origStop = conn.stop;
    conn.stop = () => {
      stopCalls += 1;
      origStop();
    };
    await client.start({
      url: 'https://nvr',
      deviceName: 'TV',
      dataDir: dir,
      connectionFactory: () => conn,
    });
    assert.doesNotThrow(() => client.stop());
    assert.doesNotThrow(() => client.stop()); // repeat call after already stopped
    assert.equal(stopCalls, 1);
  });

  test('C1: derives the ds ws URL (wss://host:7442/viewer/1.0/ws) for the connection factory, from an https profile URL', async () => {
    const conn = fakeConn();
    const client = new AdoptionClient();
    let factoryOpts = null;
    await client.start({
      url: 'https://192.168.50.1/protect',
      deviceName: 'TV',
      dataDir: dir,
      connectionFactory: (opts) => {
        factoryOpts = opts;
        return conn;
      },
    });
    // NOT :443 (the admin/web URL as-is) — the ds daemon that accepts the
    // adoption connection lives on :7442, a separate service.
    assert.equal(factoryOpts.url, 'wss://192.168.50.1:7442/viewer/1.0/ws');
  });

  test('C1: mintToken still receives the original https base URL, untouched by the ds URL derivation', async () => {
    const conn = fakeConn();
    const client = new AdoptionClient();
    let mintedUrl = null;
    await client.start({
      url: 'https://192.168.50.1/protect',
      username: 'admin',
      password: 'pw',
      deviceName: 'TV',
      dataDir: dir,
      mintToken: async (c) => {
        mintedUrl = c.url;
        return { token: 'TOKEN', cookie: 'TOKEN=abc' };
      },
      connectionFactory: () => conn,
    });
    assert.equal(mintedUrl, 'https://192.168.50.1/protect');
  });

  // ── I#1 (Task 6 review): mint-failure fatal classification ────────────────
  // Auth failures (bad admin creds) don't self-heal – must surface as fatal
  // so window.js's fatal path (fallback / surface-to-config) fires instead of
  // leaving the app stuck on a dead login page. Network/transient mint errors
  // stay non-fatal – the underlying connection already retries those.

  test('I#1: mint fails with login HTTP 401 (bad creds) -> fatal error', async () => {
    const client = new AdoptionClient();
    const errs = [];
    client.on('error', (e) => errs.push(e));
    await client.start({
      url: 'https://nvr',
      username: 'admin',
      password: 'wrong',
      deviceName: 'TV',
      dataDir: dir,
      mintToken: async () => {
        throw new Error('login HTTP 401');
      },
      connectionFactory: () => {
        throw new Error('should not reach');
      },
    });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].fatal, true, 'HTTP 401 on login is an auth failure -> fatal');
    assert.match(errs[0].message, /login HTTP 401/);
  });

  test('I#1: mint fails with manage-payload HTTP 403 (bad/expired session) -> fatal error', async () => {
    const client = new AdoptionClient();
    const errs = [];
    client.on('error', (e) => errs.push(e));
    await client.start({
      url: 'https://nvr',
      username: 'admin',
      password: 'wrong',
      deviceName: 'TV',
      dataDir: dir,
      mintToken: async () => {
        throw new Error('manage-payload HTTP 403');
      },
      connectionFactory: () => {
        throw new Error('should not reach');
      },
    });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].fatal, true, 'HTTP 403 on manage-payload is an auth failure -> fatal');
  });

  test('I#1: mint fails with a NETWORK/transient error (ECONNREFUSED) -> NOT fatal (retryable)', async () => {
    const client = new AdoptionClient();
    const errs = [];
    client.on('error', (e) => errs.push(e));
    await client.start({
      url: 'https://nvr',
      username: 'admin',
      password: 'pw',
      deviceName: 'TV',
      dataDir: dir,
      mintToken: async () => {
        throw new Error('connect ECONNREFUSED 192.168.1.1:443');
      },
      connectionFactory: () => {
        throw new Error('should not reach');
      },
    });
    assert.equal(errs.length, 1);
    assert.equal(errs[0].fatal, false, 'a network error must stay retryable, not fatal');
  });

  test('I#1: mint fails with a transient 5xx (login HTTP 500) -> NOT fatal (retryable)', async () => {
    const client = new AdoptionClient();
    const errs = [];
    client.on('error', (e) => errs.push(e));
    await client.start({
      url: 'https://nvr',
      username: 'admin',
      password: 'pw',
      deviceName: 'TV',
      dataDir: dir,
      mintToken: async () => {
        throw new Error('login HTTP 500');
      },
      connectionFactory: () => {
        throw new Error('should not reach');
      },
    });
    assert.equal(errs.length, 1);
    assert.equal(
      errs[0].fatal,
      false,
      'a 5xx is a server-side transient error, not an auth failure',
    );
  });

  test('adopted fires exactly once even when online repeats (reconnect)', async () => {
    const conn = fakeConn();
    const client = new AdoptionClient();
    const seen = [];
    client.on('online', (v) => seen.push(['online', v]));
    client.on('adopted', (a) => seen.push(['adopted', a]));
    await client.start({
      url: 'https://nvr',
      deviceName: 'TV',
      dataDir: dir,
      connectionFactory: () => conn,
    });
    conn.emit('online');
    conn.emit('closed');
    conn.emit('online'); // simulated reconnect
    await tick();
    const onlineTrueEvents = seen.filter(([type, v]) => type === 'online' && v === true);
    const adoptedEvents = seen.filter(([type]) => type === 'adopted');
    assert.equal(onlineTrueEvents.length, 2);
    assert.equal(adoptedEvents.length, 1);
    assert.deepEqual(adoptedEvents[0][1], { viewerId: null });
  });
});
