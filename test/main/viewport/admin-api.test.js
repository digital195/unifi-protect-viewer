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
