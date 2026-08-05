'use strict';

/**
 * @file secure.js
 * @description Secret-at-rest helper over Electron safeStorage.
 *
 * Stored format is self-describing via a prefix:
 *   'enc:'   + base64(safeStorage.encryptString(plain))  — OS-encrypted
 *   'plain:' + plain                                     — safeStorage unavailable
 *                                                          (e.g. WSL2 without a keyring)
 * A legacy bare string (no prefix) is treated as plaintext.
 *
 * All functions accept an optional `deps = { safeStorage, warn }` so unit tests
 * inject a fake safeStorage — require('electron') only happens when no fake is
 * given, keeping this module loadable in plain Node.
 */

const ENC_PREFIX = 'enc:';
const PLAIN_PREFIX = 'plain:';

function resolveDeps(deps) {
  const warn = deps && deps.warn ? deps.warn : (msg) => console.warn(`[secure] ${msg}`);
  if (deps && 'safeStorage' in deps) return { safeStorage: deps.safeStorage, warn };
  // Lazy require: only touched at runtime inside Electron.
  const { safeStorage } = require('electron');
  return { safeStorage, warn };
}

/** @returns {boolean} whether OS-backed secret encryption is usable right now. */
function isSecretEncryptionAvailable(deps) {
  const { safeStorage } = resolveDeps(deps);
  try {
    return !!(safeStorage && safeStorage.isEncryptionAvailable());
  } catch (_) {
    return false;
  }
}

/**
 * Encrypts a secret for storage. Empty input stays empty.
 * @param {string} plain
 * @returns {string} 'enc:'-prefixed ciphertext, or 'plain:'-prefixed fallback (warned).
 */
function encryptSecret(plain, deps) {
  if (!plain) return '';
  const d = resolveDeps(deps);
  if (isSecretEncryptionAvailable(d)) {
    return ENC_PREFIX + d.safeStorage.encryptString(plain).toString('base64');
  }
  d.warn('safeStorage encryption unavailable – storing secret with plain: marker');
  return PLAIN_PREFIX + plain;
}

/**
 * Decrypts a stored secret. Routes on the enc:/plain: prefix; a legacy bare
 * string is returned as-is. A failed decrypt returns '' (and warns) so callers
 * degrade to "no password" instead of crashing at launch.
 * @param {string} stored
 * @returns {string} the plaintext secret, or ''.
 */
function decryptSecret(stored, deps) {
  if (!stored) return '';
  if (stored.startsWith(PLAIN_PREFIX)) return stored.slice(PLAIN_PREFIX.length);
  if (stored.startsWith(ENC_PREFIX)) {
    const d = resolveDeps(deps);
    try {
      return d.safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'));
    } catch (e) {
      d.warn(`failed to decrypt stored secret: ${e.message}`);
      return '';
    }
  }
  return stored; // legacy bare value = plaintext
}

module.exports = {
  encryptSecret,
  decryptSecret,
  isSecretEncryptionAvailable,
  ENC_PREFIX,
  PLAIN_PREFIX,
};
