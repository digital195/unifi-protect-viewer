'use strict';

/**
 * @file test/main/secure.test.js
 * @description Behavioral contract tests for src/main/secure.js.
 * No real Electron: a fake safeStorage is injected via the `deps` parameter,
 * so these tests run under plain Node 22.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const secure = require('../../src/main/secure');

// ── Fake safeStorage ─────────────────────────────────────────────────────────
// encryptString: prepends 'X' and returns a Buffer; decryptString reverses it.
// Distinct from base64 so tests can prove both transforms were applied.
function makeFakeSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from('X' + s, 'utf8'),
    decryptString: (buf) => {
      const s = buf.toString('utf8');
      if (!s.startsWith('X')) throw new Error('bad ciphertext');
      return s.slice(1);
    },
  };
}

let warnings;
let deps;

describe('secure.js – encryptSecret / decryptSecret', () => {
  beforeEach(() => {
    warnings = [];
    deps = { safeStorage: makeFakeSafeStorage(), warn: (m) => warnings.push(m) };
  });

  test('module exports exactly the expected symbols', () => {
    assert.deepStrictEqual(
      Object.keys(secure).sort(),
      [
        'ENC_PREFIX',
        'PLAIN_PREFIX',
        'decryptSecret',
        'encryptSecret',
        'isSecretEncryptionAvailable',
      ].sort(),
    );
    assert.equal(secure.ENC_PREFIX, 'enc:');
    assert.equal(secure.PLAIN_PREFIX, 'plain:');
  });

  test('encrypt → enc: prefix + base64 ciphertext when encryption is available', () => {
    const stored = secure.encryptSecret('hunter2', deps);
    assert.ok(stored.startsWith('enc:'), `expected enc: prefix, got ${stored}`);
    const ciphertext = Buffer.from(stored.slice(4), 'base64').toString('utf8');
    assert.equal(ciphertext, 'Xhunter2'); // fake transform applied, NOT the plaintext
    assert.equal(warnings.length, 0);
  });

  test('round-trip: decryptSecret(encryptSecret(x)) === x', () => {
    assert.equal(secure.decryptSecret(secure.encryptSecret('hunter2', deps), deps), 'hunter2');
  });

  test('encrypt falls back to plain: prefix and WARNS when encryption unavailable', () => {
    const noEnc = {
      safeStorage: makeFakeSafeStorage({ available: false }),
      warn: (m) => warnings.push(m),
    };
    const stored = secure.encryptSecret('hunter2', noEnc);
    assert.equal(stored, 'plain:hunter2');
    assert.equal(warnings.length, 1, 'must warn — never silently claim encryption');
  });

  test('encryptSecret("") returns "" (no prefix, no warn)', () => {
    assert.equal(secure.encryptSecret('', deps), '');
    assert.equal(warnings.length, 0);
  });

  test('decryptSecret routes plain: prefix without touching safeStorage', () => {
    const noStorage = { safeStorage: null, warn: (m) => warnings.push(m) };
    assert.equal(secure.decryptSecret('plain:hunter2', noStorage), 'hunter2');
  });

  test('decryptSecret tolerates a legacy bare string as plaintext', () => {
    const noStorage = { safeStorage: null, warn: (m) => warnings.push(m) };
    assert.equal(secure.decryptSecret('hunter2', noStorage), 'hunter2');
  });

  test('decryptSecret("") and decryptSecret(undefined) return ""', () => {
    assert.equal(secure.decryptSecret('', deps), '');
    assert.equal(secure.decryptSecret(undefined, deps), '');
  });

  test('decryptSecret returns "" and warns when decryption fails', () => {
    const stored = 'enc:' + Buffer.from('not-our-ciphertext', 'utf8').toString('base64');
    assert.equal(secure.decryptSecret(stored, deps), '');
    assert.equal(warnings.length, 1);
  });

  test('isSecretEncryptionAvailable reflects the injected impl', () => {
    assert.equal(secure.isSecretEncryptionAvailable(deps), true);
    assert.equal(
      secure.isSecretEncryptionAvailable({
        safeStorage: makeFakeSafeStorage({ available: false }),
      }),
      false,
    );
  });

  test('isSecretEncryptionAvailable returns false when the impl throws', () => {
    const throwing = {
      safeStorage: {
        isEncryptionAvailable: () => {
          throw new Error('boom');
        },
      },
    };
    assert.equal(secure.isSecretEncryptionAvailable(throwing), false);
  });
});
