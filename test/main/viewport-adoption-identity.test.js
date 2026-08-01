'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const process = require('node:process');
const { loadOrCreateIdentity } = require('../../src/main/viewport/adoption/identity');

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upv-id-'));
});
after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('adoption identity', () => {
  test('generates a PEM cert + key and a 12-hex mac', () => {
    const id = loadOrCreateIdentity(dir);
    assert.match(id.cert, /-----BEGIN CERTIFICATE-----/);
    assert.match(id.key, /-----BEGIN (RSA )?PRIVATE KEY-----/);
    assert.match(id.mac, /^[0-9A-F]{12}$/);
    assert.equal(typeof id.ident, 'string');
  });

  test('is stable across calls (persisted, not regenerated)', () => {
    const a = loadOrCreateIdentity(dir);
    const b = loadOrCreateIdentity(dir);
    assert.equal(a.cert, b.cert);
    assert.equal(a.key, b.key);
    assert.equal(a.mac, b.mac);
    assert.equal(a.ident, b.ident);
  });

  test(
    'persists the private key with 0600 perms (POSIX)',
    { skip: process.platform === 'win32' },
    () => {
      loadOrCreateIdentity(dir);
      const mode = fs.statSync(path.join(dir, 'device.key.pem')).mode & 0o777;
      assert.equal(mode, 0o600);
    },
  );
});

const crypto = require('node:crypto');
const { certFingerprint256 } = require('../../src/main/viewport/adoption/identity');

describe('certFingerprint256', () => {
  test('returns uppercase colon-hex SHA-256 matching X509Certificate', () => {
    const id = loadOrCreateIdentity(dir);
    const fp = certFingerprint256(id);
    assert.match(fp, /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
    assert.equal(fp, new crypto.X509Certificate(id.cert).fingerprint256);
  });
});
