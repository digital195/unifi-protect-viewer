'use strict';

/**
 * @file identity.js
 * @description The emulated device's stable identity: a self-signed TLS client
 * cert (mTLS) + a locally-administered MAC. Generated once and persisted so the
 * NVR sees the same device across restarts.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const selfsigned = require('selfsigned');

/** Generates a stable locally-administered MAC as 12 uppercase hex chars. */
function generateMac() {
  const b = crypto.randomBytes(6);
  b[0] = (b[0] & 0xfe) | 0x02; // locally-administered, unicast
  return b.toString('hex').toUpperCase();
}

/**
 * Loads the persisted device identity, generating + saving it on first use.
 * @param {string} dir - directory to persist identity files in
 * @returns {{ cert: string, key: string, mac: string, ident: string }}
 */
function loadOrCreateIdentity(dir) {
  const p = (f) => path.join(dir, f);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(p('device.json'))) {
    const meta = JSON.parse(fs.readFileSync(p('device.json'), 'utf8'));
    return {
      cert: fs.readFileSync(p('device.cert.pem'), 'utf8'),
      key: fs.readFileSync(p('device.key.pem'), 'utf8'),
      mac: meta.mac,
      ident: meta.ident,
    };
  }
  const mac = generateMac();
  const ident = crypto.randomUUID();
  const pems = selfsigned.generate([{ name: 'commonName', value: 'camera.ubnt.dev' }], {
    keySize: 2048,
    days: 3650,
    algorithm: 'sha256',
  });
  fs.writeFileSync(p('device.cert.pem'), pems.cert);
  fs.writeFileSync(p('device.key.pem'), pems.private, { mode: 0o600 });
  fs.writeFileSync(p('device.json'), JSON.stringify({ mac, ident }));
  return { cert: pems.cert, key: pems.private, mac, ident };
}

/** SHA-256 fingerprint of the device cert as uppercase colon-hex (x-fingerprint). */
function certFingerprint256(identity) {
  return new crypto.X509Certificate(identity.cert).fingerprint256;
}

module.exports = { loadOrCreateIdentity, generateMac, certFingerprint256 };
