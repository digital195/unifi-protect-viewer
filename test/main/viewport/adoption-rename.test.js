'use strict';
/**
 * Task 4 (Phase 3 polish): post-online best-effort rename.
 * After the initial adopt goes online, AdoptionClient uses the login cookie
 * captured from mintToken to find the viewer by mac and — only when the
 * server-side name differs from the configured deviceName — PATCH-renames it.
 * Keyless reconnects (no cookie) and missing deviceName skip entirely, and a
 * failing admin API must never break the adoption connection (non-fatal).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { AdoptionClient } = require('../../../src/main/viewport/adoption');

const tick = () => new Promise((r) => setImmediate(r));

function fakeConn() {
  const c = new EventEmitter();
  c.open = async () => {};
  c.stop = () => {
    c.stopped = true;
  };
  return c;
}

// Identity is injected (loadIdentity) so no fs access happens; the fake
// adminApi records its calls for assertions. `opts` is read at CALL time, so
// latch tests can flip found/renameOk between successive `online` emissions.
function recordingAdminApi(opts = {}) {
  const calls = { find: [], rename: [] };
  return {
    calls,
    findViewerByMac: async (url, cookie, mac, dep) => {
      calls.find.push({ url, cookie, mac, dep });
      return opts.found === undefined
        ? { id: '9', mac: 'AABBCCDDEEFF', name: 'UP Viewport' }
        : opts.found;
    },
    renameViewer: async (url, cookie, id, name, dep) => {
      calls.rename.push({ url, cookie, id, name, dep });
      if (opts.renameThrows) throw new Error('PATCH boom');
      return opts.renameOk === undefined ? true : opts.renameOk;
    },
  };
}

function baseOpts(conn, adminApi, overrides = {}) {
  return {
    url: 'https://nvr',
    username: 'admin',
    password: 'pw',
    deviceName: 'CWD_VIEWPORT',
    dataDir: '/d',
    mintToken: async () => ({ token: 't', cookie: 'ck' }),
    connectionFactory: () => conn,
    adminApi,
    loadIdentity: () => ({ mac: 'AABBCCDDEEFF', cert: 'x', key: 'y' }),
    ...overrides,
  };
}

describe('AdoptionClient post-online rename', () => {
  test('renames the viewer after online when the server-side name differs', async () => {
    const conn = fakeConn();
    const adminApi = recordingAdminApi(); // found name 'UP Viewport' != 'CWD_VIEWPORT'
    const client = new AdoptionClient();
    const renamed = [];
    client.on('renamed', (r) => renamed.push(r));
    await client.start(baseOpts(conn, adminApi));
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.find.length, 1);
    // find runs against the ORIGINAL admin https URL (not the :7442 ds URL),
    // with the mint login cookie and the identity mac.
    assert.equal(adminApi.calls.find[0].url, 'https://nvr');
    assert.equal(adminApi.calls.find[0].cookie, 'ck');
    assert.equal(adminApi.calls.find[0].mac, 'AABBCCDDEEFF');
    // dep wiring: real pinned httpJson + the profile dataDir.
    assert.equal(typeof adminApi.calls.find[0].dep.httpJson, 'function');
    assert.equal(adminApi.calls.find[0].dep.dataDir, '/d');
    assert.equal(adminApi.calls.rename.length, 1);
    assert.equal(adminApi.calls.rename[0].id, '9');
    assert.equal(adminApi.calls.rename[0].name, 'CWD_VIEWPORT');
    assert.equal(adminApi.calls.rename[0].cookie, 'ck');
    assert.deepEqual(renamed, [{ ok: true, name: 'CWD_VIEWPORT' }]);
  });

  test('skips the PATCH when the viewer name already matches deviceName', async () => {
    const conn = fakeConn();
    const adminApi = recordingAdminApi({
      found: { id: '9', mac: 'AABBCCDDEEFF', name: 'CWD_VIEWPORT' },
    });
    const client = new AdoptionClient();
    const renamed = [];
    client.on('renamed', (r) => renamed.push(r));
    await client.start(baseOpts(conn, adminApi));
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.find.length, 1);
    assert.equal(adminApi.calls.rename.length, 0, 'name already correct -> no PATCH');
    assert.deepEqual(renamed, []);
  });

  test('viewer not found by mac -> no rename, no error', async () => {
    const conn = fakeConn();
    const adminApi = recordingAdminApi({ found: null });
    const client = new AdoptionClient();
    const errs = [];
    client.on('error', (e) => errs.push(e));
    await client.start(baseOpts(conn, adminApi));
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.rename.length, 0);
    assert.deepEqual(errs, []);
  });

  test('keyless reconnect (no creds -> no cookie): never touches the admin API', async () => {
    const conn = fakeConn();
    const adminApi = recordingAdminApi();
    const client = new AdoptionClient();
    await client.start(baseOpts(conn, adminApi, { username: undefined, password: undefined }));
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.find.length, 0, 'no cookie -> rename must be skipped');
    assert.equal(adminApi.calls.rename.length, 0);
  });

  test('no deviceName configured: rename is skipped', async () => {
    const conn = fakeConn();
    const adminApi = recordingAdminApi();
    const client = new AdoptionClient();
    await client.start(baseOpts(conn, adminApi, { deviceName: undefined }));
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.find.length, 0);
    assert.equal(adminApi.calls.rename.length, 0);
  });

  test('a throwing admin API is NON-FATAL: start resolved, connection stays, error has fatal:false', async () => {
    const conn = fakeConn();
    const adminApi = recordingAdminApi({ renameThrows: true });
    const client = new AdoptionClient();
    const errs = [];
    const seen = [];
    client.on('error', (e) => errs.push(e));
    client.on('online', (v) => seen.push(['online', v]));
    client.on('adopted', (a) => seen.push(['adopted', a]));
    await client.start(baseOpts(conn, adminApi)); // must not reject
    conn.emit('online');
    await tick();
    // Rename failed, but adoption itself is untouched.
    assert.deepEqual(seen, [
      ['online', true],
      ['adopted', { viewerId: null }],
    ]);
    assert.equal(conn.stopped, undefined, 'connection must NOT be torn down');
    assert.equal(errs.length, 1);
    assert.equal(errs[0].fatal, false, 'rename failure is cosmetic -> non-fatal');
    assert.match(errs[0].message, /rename skipped: PATCH boom/);
  });

  test('successful rename LATCHES: repeated online events hit the admin API only once', async () => {
    const conn = fakeConn();
    const adminApi = recordingAdminApi(); // 'UP Viewport' != 'CWD_VIEWPORT' -> rename, ok=true
    const client = new AdoptionClient();
    const renamed = [];
    client.on('renamed', (r) => renamed.push(r));
    await client.start(baseOpts(conn, adminApi));
    conn.emit('online');
    await tick();
    conn.emit('online'); // in-session reconnects must NOT re-fetch bootstrap
    await tick();
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.find.length, 1, 'find (bootstrap fetch) must run once per session');
    assert.equal(adminApi.calls.rename.length, 1, 'rename must run once per session');
    assert.deepEqual(renamed, [{ ok: true, name: 'CWD_VIEWPORT' }]);
  });

  test('already-matching name LATCHES too: no re-find on later online events', async () => {
    const conn = fakeConn();
    const adminApi = recordingAdminApi({
      found: { id: '9', mac: 'AABBCCDDEEFF', name: 'CWD_VIEWPORT' },
    });
    const client = new AdoptionClient();
    await client.start(baseOpts(conn, adminApi));
    conn.emit('online');
    await tick();
    conn.emit('online');
    await tick();
    assert.equal(
      adminApi.calls.find.length,
      1,
      'name already correct -> latched after first check',
    );
    assert.equal(adminApi.calls.rename.length, 0);
  });

  test('FAILED rename (renameViewer -> false) does NOT latch: next online retries, then latches on success', async () => {
    const conn = fakeConn();
    const opts = { renameOk: false };
    const adminApi = recordingAdminApi(opts);
    const client = new AdoptionClient();
    const renamed = [];
    client.on('renamed', (r) => renamed.push(r));
    await client.start(baseOpts(conn, adminApi));
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.find.length, 1);
    assert.equal(adminApi.calls.rename.length, 1);
    conn.emit('online'); // transient failure -> must retry
    await tick();
    assert.equal(adminApi.calls.find.length, 2, 'falsy rename must not latch');
    assert.equal(adminApi.calls.rename.length, 2);
    opts.renameOk = true; // server recovers
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.rename.length, 3);
    conn.emit('online'); // now latched
    await tick();
    assert.equal(adminApi.calls.find.length, 3);
    assert.equal(adminApi.calls.rename.length, 3);
    assert.deepEqual(renamed, [
      { ok: false, name: 'CWD_VIEWPORT' },
      { ok: false, name: 'CWD_VIEWPORT' },
      { ok: true, name: 'CWD_VIEWPORT' },
    ]);
  });

  test('viewer not found does NOT latch: a later online sees the device appear and renames it', async () => {
    const conn = fakeConn();
    const opts = { found: null };
    const adminApi = recordingAdminApi(opts);
    const client = new AdoptionClient();
    const renamed = [];
    client.on('renamed', (r) => renamed.push(r));
    await client.start(baseOpts(conn, adminApi));
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.find.length, 1);
    assert.equal(adminApi.calls.rename.length, 0);
    opts.found = { id: '9', mac: 'AABBCCDDEEFF', name: 'UP Viewport' }; // device appears
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.find.length, 2, 'not-found must not latch');
    assert.equal(adminApi.calls.rename.length, 1);
    assert.deepEqual(renamed, [{ ok: true, name: 'CWD_VIEWPORT' }]);
  });

  test('a THROWN admin API call does NOT latch: next online retries', async () => {
    const conn = fakeConn();
    const opts = { renameThrows: true };
    const adminApi = recordingAdminApi(opts);
    const client = new AdoptionClient();
    const errs = [];
    client.on('error', (e) => errs.push(e));
    await client.start(baseOpts(conn, adminApi));
    conn.emit('online');
    await tick();
    assert.equal(errs.length, 1);
    opts.renameThrows = false; // server recovers
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.find.length, 2, 'throw must not latch');
    assert.equal(adminApi.calls.rename.length, 2);
  });

  test('findViewerByMac throw is also non-fatal', async () => {
    const conn = fakeConn();
    const adminApi = recordingAdminApi();
    adminApi.findViewerByMac = async () => {
      throw new Error('bootstrap 502');
    };
    const client = new AdoptionClient();
    const errs = [];
    client.on('error', (e) => errs.push(e));
    await client.start(baseOpts(conn, adminApi));
    conn.emit('online');
    await tick();
    assert.equal(errs.length, 1);
    assert.equal(errs[0].fatal, false);
    assert.match(errs[0].message, /rename skipped: bootstrap 502/);
  });
});
