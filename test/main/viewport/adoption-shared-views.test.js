'use strict';
/**
 * Post-online best-effort "Show Shared Multiviews" enforcement.
 * After the adopt goes online, AdoptionClient reuses the mint login cookie to
 * call admin-api.ensureIncludeGlobal so the render account can see shared/public
 * multiviews (else an assigned shared Live View shows as All Cameras). Latches
 * on success, retries on failure, skips keyless reconnects, and never breaks
 * adoption. Emits `sharedViews` with the outcome for the settings UI.
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

// adminApi with ensureIncludeGlobal recording its calls; result read at CALL
// time so latch/retry tests can flip it between successive `online` emissions.
function recordingAdminApi(opts = {}) {
  const calls = { ensure: [] };
  return {
    calls,
    // rename path is a no-op here (found === name → nothing to do, no latch churn)
    findViewerByMac: async () => ({ id: '9', mac: 'AABBCCDDEEFF', name: 'CWD_VIEWPORT' }),
    renameViewer: async () => true,
    ensureIncludeGlobal: async (url, cookie, dep) => {
      calls.ensure.push({ url, cookie, dep });
      if (opts.throws) throw new Error('boom');
      return opts.result === undefined ? { ok: true, changed: false } : opts.result;
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

describe('AdoptionClient post-online shared-views enforcement', () => {
  test('calls ensureIncludeGlobal after online and emits sharedViews', async () => {
    const conn = fakeConn();
    const adminApi = recordingAdminApi({ result: { ok: true, changed: true } });
    const client = new AdoptionClient();
    const events = [];
    client.on('sharedViews', (r) => events.push(r));
    await client.start(baseOpts(conn, adminApi));
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.ensure.length, 1);
    assert.equal(adminApi.calls.ensure[0].url, 'https://nvr'); // admin https URL, not :7442
    assert.equal(adminApi.calls.ensure[0].cookie, 'ck'); // mint login cookie
    assert.equal(typeof adminApi.calls.ensure[0].dep.httpJson, 'function');
    assert.equal(adminApi.calls.ensure[0].dep.dataDir, '/d');
    assert.deepEqual(events, [{ ok: true, changed: true }]);
  });

  test('latches on success — a second online does NOT re-call', async () => {
    const conn = fakeConn();
    const adminApi = recordingAdminApi({ result: { ok: true, changed: false } });
    const client = new AdoptionClient();
    await client.start(baseOpts(conn, adminApi));
    conn.emit('online');
    await tick();
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.ensure.length, 1, 'success latches for the session');
  });

  test('retries on failure — a later online re-calls until it succeeds', async () => {
    const conn = fakeConn();
    const state = { result: { ok: false, reason: 'patch' } };
    const adminApi = {
      calls: { ensure: [] },
      findViewerByMac: async () => ({ id: '9', mac: 'AABBCCDDEEFF', name: 'CWD_VIEWPORT' }),
      renameViewer: async () => true,
      ensureIncludeGlobal: async (url, cookie, dep) => {
        adminApi.calls.ensure.push({ url, cookie, dep });
        return state.result;
      },
    };
    const client = new AdoptionClient();
    await client.start(baseOpts(conn, adminApi));
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.ensure.length, 1);
    state.result = { ok: true, changed: true }; // now it works
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.ensure.length, 2, 'failure did not latch — retried');
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.ensure.length, 2, 'now latched after success');
  });

  test('keyless reconnect (no mint cookie) skips ensureIncludeGlobal', async () => {
    const conn = fakeConn();
    const adminApi = recordingAdminApi();
    const client = new AdoptionClient();
    // No username/password -> no mint -> no cookie -> skip.
    await client.start(baseOpts(conn, adminApi, { username: undefined, password: undefined }));
    conn.emit('online');
    await tick();
    assert.equal(adminApi.calls.ensure.length, 0);
  });

  test('a throwing ensureIncludeGlobal is non-fatal and emits a failure outcome', async () => {
    const conn = fakeConn();
    const adminApi = recordingAdminApi({ throws: true });
    const client = new AdoptionClient();
    const events = [];
    client.on('sharedViews', (r) => events.push(r));
    await client.start(baseOpts(conn, adminApi));
    conn.emit('online');
    await tick();
    assert.deepEqual(events, [{ ok: false, reason: 'exception' }]);
    assert.equal(conn.stopped, undefined, 'adoption connection untouched');
  });
});
