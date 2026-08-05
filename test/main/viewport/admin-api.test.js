'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../../../src/main/viewport/adoption/admin-api');

function fakeHttp(routes) {
  const calls = [];
  const httpJson = async (reqDesc, opts) => {
    calls.push({ reqDesc, opts });
    const key = (reqDesc.method || 'GET') + ' ' + reqDesc.url;
    const r = routes[key];
    if (!r) throw new Error('no route ' + key);
    return typeof r === 'function' ? r(reqDesc, opts) : r;
  };
  return { httpJson, calls };
}
const buildLoginRequest = (url, u, p) => ({
  url: url + '/api/auth/login',
  method: 'POST',
  body: JSON.stringify({ u, p }),
});

test('normalizeMac strips colons and uppercases', () => {
  assert.equal(api.normalizeMac('aa:bb:cc:dd:ee:ff'), 'AABBCCDDEEFF');
  assert.equal(api.normalizeMac('AABBCCDDEEFF'), 'AABBCCDDEEFF');
});

test('login returns joined cookie from set-cookie', async () => {
  const { httpJson } = fakeHttp({
    'POST https://n/api/auth/login': {
      status: 200,
      setCookie: ['TOKEN=x; Path=/', 'JSESSIONID=y; HttpOnly'],
      body: '',
    },
  });
  const out = await api.login('https://n', 'admin', 'pw', {
    httpJson,
    buildLoginRequest,
    dataDir: '/d',
  });
  assert.equal(out.cookie, 'TOKEN=x; JSESSIONID=y');
});

test('findViewerByMac matches colon/case-insensitively via bootstrap', async () => {
  const { httpJson } = fakeHttp({
    'GET https://n/proxy/protect/api/bootstrap': {
      status: 200,
      body: JSON.stringify({ viewers: [{ id: '1', mac: 'AABBCCDDEEFF', name: 'X' }] }),
    },
  });
  const v = await api.findViewerByMac('https://n', 'c', 'aa:bb:cc:dd:ee:ff', {
    httpJson,
    dataDir: '/d',
  });
  assert.equal(v.id, '1');
  const none = await api.findViewerByMac('https://n', 'c', '001122334455', {
    httpJson,
    dataDir: '/d',
  });
  assert.equal(none, null);
});

test('findViewerByMac with an empty mac returns null even when a viewer mac is empty/missing', async () => {
  const { httpJson } = fakeHttp({
    'GET https://n/proxy/protect/api/bootstrap': {
      status: 200,
      body: JSON.stringify({
        viewers: [
          { id: '1', mac: '', name: 'EmptyMac' },
          { id: '2', name: 'MissingMac' },
        ],
      }),
    },
  });
  assert.equal(await api.findViewerByMac('https://n', 'c', '', { httpJson, dataDir: '/d' }), null);
  assert.equal(
    await api.findViewerByMac('https://n', 'c', '::--::', { httpJson, dataDir: '/d' }),
    null,
    'garbage that normalizes to empty must not match either',
  );
});

test('renameViewer PATCHes name and is true only on 200', async () => {
  const { httpJson, calls } = fakeHttp({
    'PATCH https://n/proxy/protect/api/viewers/1': { status: 200, body: '{}' },
  });
  const ok = await api.renameViewer('https://n', 'c', '1', 'New', { httpJson, dataDir: '/d' });
  assert.equal(ok, true);
  assert.deepEqual(JSON.parse(calls[0].reqDesc.body), { name: 'New' });
});

test('renameViewer false on non-200', async () => {
  const { httpJson } = fakeHttp({
    'PATCH https://n/proxy/protect/api/viewers/1': { status: 404, body: '' },
  });
  assert.equal(
    await api.renameViewer('https://n', 'c', '1', 'N', { httpJson, dataDir: '/d' }),
    false,
  );
});

test('deleteViewer true on 200 or 204', async () => {
  const a = fakeHttp({ 'DELETE https://n/proxy/protect/api/viewers/1': { status: 204, body: '' } });
  assert.equal(
    await api.deleteViewer('https://n', 'c', '1', { httpJson: a.httpJson, dataDir: '/d' }),
    true,
  );
  const b = fakeHttp({ 'DELETE https://n/proxy/protect/api/viewers/2': { status: 500, body: '' } });
  assert.equal(
    await api.deleteViewer('https://n', 'c', '2', { httpJson: b.httpJson, dataDir: '/d' }),
    false,
  );
});

test('getSelf returns the parsed user on 200, null on non-200', async () => {
  const ok = fakeHttp({
    'GET https://n/proxy/protect/api/users/self': {
      status: 200,
      body: JSON.stringify({ id: 'u1', settings: { web: { 'liveview.includeGlobal': true } } }),
    },
  });
  const u = await api.getSelf('https://n', 'c', { httpJson: ok.httpJson, dataDir: '/d' });
  assert.equal(u.id, 'u1');
  const bad = fakeHttp({ 'GET https://n/proxy/protect/api/users/self': { status: 403, body: '' } });
  assert.equal(
    await api.getSelf('https://n', 'c', { httpJson: bad.httpJson, dataDir: '/d' }),
    null,
  );
});

test('ensureIncludeGlobal SKIPS the PATCH when the flag is already true', async () => {
  const { httpJson, calls } = fakeHttp({
    'GET https://n/proxy/protect/api/users/self': {
      status: 200,
      body: JSON.stringify({ id: 'u1', settings: { web: { 'liveview.includeGlobal': true } } }),
    },
  });
  const r = await api.ensureIncludeGlobal('https://n', 'c', { httpJson, dataDir: '/d' });
  assert.deepEqual(r, { ok: true, changed: false });
  assert.equal(calls.length, 1, 'must not PATCH when already enabled');
  assert.equal(calls[0].reqDesc.method || 'GET', 'GET');
});

test('ensureIncludeGlobal PATCHes when off, sends CSRF, and PRESERVES other settings.web keys', async () => {
  const jwtCookie = `TOKEN=hdr.${Buffer.from(JSON.stringify({ csrfToken: 'CSRF1' })).toString('base64url')}.sig`;
  const { httpJson, calls } = fakeHttp({
    'GET https://n/proxy/protect/api/users/self': {
      status: 200,
      body: JSON.stringify({
        id: 'u1',
        settings: {
          web: {
            'liveview.includeGlobal': false,
            'liveview.id': 'keep-me',
            allCamerasLiveview: { id: 'all' },
          },
          other: { foo: 1 },
        },
      }),
    },
    'PATCH https://n/proxy/protect/api/users/self': { status: 200, body: '{}' },
  });
  const r = await api.ensureIncludeGlobal('https://n', jwtCookie, { httpJson, dataDir: '/d' });
  assert.deepEqual(r, { ok: true, changed: true });
  const patch = calls.find((c) => c.reqDesc.method === 'PATCH');
  assert.ok(patch, 'must PATCH when the flag is off');
  assert.equal(patch.reqDesc.headers['x-csrf-token'], 'CSRF1');
  const sent = JSON.parse(patch.reqDesc.body).settings;
  assert.equal(sent.web['liveview.includeGlobal'], true, 'flag flipped on');
  assert.equal(sent.web['liveview.id'], 'keep-me', 'other web keys preserved');
  assert.deepEqual(sent.web.allCamerasLiveview, { id: 'all' }, 'allCamerasLiveview preserved');
  assert.deepEqual(sent.other, { foo: 1 }, 'other settings namespaces preserved');
});

test('ensureIncludeGlobal treats an absent flag as off and enables it', async () => {
  const { httpJson, calls } = fakeHttp({
    'GET https://n/proxy/protect/api/users/self': {
      status: 200,
      body: JSON.stringify({ id: 'u1', settings: { web: {} } }),
    },
    'PATCH https://n/proxy/protect/api/users/self': { status: 200, body: '{}' },
  });
  const r = await api.ensureIncludeGlobal('https://n', 'c', { httpJson, dataDir: '/d' });
  assert.deepEqual(r, { ok: true, changed: true });
  assert.ok(calls.find((c) => c.reqDesc.method === 'PATCH'));
});

test('ensureIncludeGlobal returns ok:false reason:read when self is unreadable (no PATCH)', async () => {
  const { httpJson, calls } = fakeHttp({
    'GET https://n/proxy/protect/api/users/self': { status: 401, body: '' },
  });
  const r = await api.ensureIncludeGlobal('https://n', 'c', { httpJson, dataDir: '/d' });
  assert.deepEqual(r, { ok: false, changed: false, reason: 'read' });
  assert.equal(calls.length, 1, 'must not PATCH when self is unreadable');
});

test('ensureIncludeGlobal handles a user with NO settings object (no wipe, no throw)', async () => {
  const { httpJson, calls } = fakeHttp({
    'GET https://n/proxy/protect/api/users/self': {
      status: 200,
      body: JSON.stringify({ id: 'u1' }), // settings entirely absent
    },
    'PATCH https://n/proxy/protect/api/users/self': { status: 200, body: '{}' },
  });
  const r = await api.ensureIncludeGlobal('https://n', 'c', { httpJson, dataDir: '/d' });
  assert.deepEqual(r, { ok: true, changed: true });
  const patch = calls.find((c) => c.reqDesc.method === 'PATCH');
  assert.deepEqual(JSON.parse(patch.reqDesc.body), {
    settings: { web: { 'liveview.includeGlobal': true } },
  });
});

test('getSelf returns null on a 200 with an unparseable body', async () => {
  const { httpJson } = fakeHttp({
    'GET https://n/proxy/protect/api/users/self': { status: 200, body: 'not json' },
  });
  assert.equal(await api.getSelf('https://n', 'c', { httpJson, dataDir: '/d' }), null);
});

test('ensureIncludeGlobal returns ok:false reason:patch when the PATCH is rejected', async () => {
  const { httpJson } = fakeHttp({
    'GET https://n/proxy/protect/api/users/self': {
      status: 200,
      body: JSON.stringify({ settings: { web: { 'liveview.includeGlobal': false } } }),
    },
    'PATCH https://n/proxy/protect/api/users/self': { status: 403, body: '' },
  });
  const r = await api.ensureIncludeGlobal('https://n', 'c', { httpJson, dataDir: '/d' });
  assert.deepEqual(r, { ok: false, changed: true, reason: 'patch' });
});

test('mutations send X-CSRF-Token from the TOKEN cookie JWT; omit it when absent', async () => {
  // UniFi OS carries the csrf token in the JWT TOKEN cookie's payload.
  const jwtCookie = (csrf) =>
    `TOKEN=hdr.${Buffer.from(JSON.stringify({ csrfToken: csrf })).toString('base64url')}.sig; JSESSIONID=y`;

  const r = fakeHttp({
    'PATCH https://n/proxy/protect/api/viewers/1': { status: 200, body: '{}' },
  });
  await api.renameViewer('https://n', jwtCookie('CSRF123'), '1', 'New', {
    httpJson: r.httpJson,
    dataDir: '/d',
  });
  assert.equal(r.calls[0].reqDesc.headers['x-csrf-token'], 'CSRF123');

  const d = fakeHttp({ 'DELETE https://n/proxy/protect/api/viewers/1': { status: 200, body: '' } });
  await api.deleteViewer('https://n', jwtCookie('CSRF999'), '1', {
    httpJson: d.httpJson,
    dataDir: '/d',
  });
  assert.equal(d.calls[0].reqDesc.headers['x-csrf-token'], 'CSRF999');

  // No TOKEN JWT in the cookie (non-UniFi-OS console) → header omitted, old behavior.
  const n = fakeHttp({
    'PATCH https://n/proxy/protect/api/viewers/1': { status: 200, body: '{}' },
  });
  await api.renameViewer('https://n', 'SOMEOTHER=z', '1', 'New', {
    httpJson: n.httpJson,
    dataDir: '/d',
  });
  assert.equal(n.calls[0].reqDesc.headers['x-csrf-token'], undefined);
});
