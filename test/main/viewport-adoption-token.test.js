'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../src/main/viewport/adoption/token');

describe('adoption token', () => {
  test('login request posts JSON credentials to /api/auth/login', () => {
    const r = T.buildLoginRequest('https://192.168.50.1', 'admin', 'pw');
    assert.equal(r.url, 'https://192.168.50.1/api/auth/login');
    assert.equal(r.method, 'POST');
    assert.match(r.headers['content-type'] || r.headers['Content-Type'], /application\/json/i);
    assert.deepEqual(JSON.parse(r.body), { username: 'admin', password: 'pw', rememberMe: false });
  });

  test('manage-payload url is the protect API path', () => {
    assert.equal(
      T.managePayloadUrl('https://192.168.50.1'),
      'https://192.168.50.1/proxy/protect/api/cameras/manage-payload',
    );
  });

  test('parseTokenResponse returns mgmt.token', () => {
    assert.equal(T.parseTokenResponse({ mgmt: { token: 'ABC' } }), 'ABC');
  });

  test('parseTokenResponse throws when token missing', () => {
    assert.throws(() => T.parseTokenResponse({ mgmt: {} }), /token/i);
    assert.throws(() => T.parseTokenResponse({}), /token/i);
  });
});
