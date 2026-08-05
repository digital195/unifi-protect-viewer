'use strict';

/**
 * @file pinning.js
 * @description TOFU (trust-on-first-use) pinning of the NVR TLS cert. No Electron.
 * Captures the console cert on first connect (the trust decision happens in that
 * LAN first-use window), persists it per `host:port`, and verifies via a leaf-as-CA
 * pin plus a fingerprint256 checkServerIdentity — because with
 * rejectUnauthorized:false Node never calls checkServerIdentity, so we keep
 * rejectUnauthorized:true. Pins are keyed by `host:port`, NOT host alone: on a
 * UDM the admin API (:443, behind the UniFi OS reverse proxy) and the `ds`
 * device daemon (:7442) present DIFFERENT leaf certs, so each endpoint must be
 * probed and pinned independently — sharing one pin across ports would make the
 * ds connection's checkServerIdentity fail against the :443 web-proxy cert.
 * A repeat probe of the SAME host:port still reuses
 * its cached pin. Fails loudly on change.
 */

const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');

function pinsFile(dir) {
  return path.join(dir, 'nvr-pins.json');
}

/** The pin-map key for one endpoint: distinct ports on the same host pin separately. */
function pinKey(host, port) {
  return `${host}:${port}`;
}

/** Load the "host:port"->pin map (or {} if none). */
function loadPins(dir) {
  try {
    return JSON.parse(fs.readFileSync(pinsFile(dir), 'utf8'));
  } catch {
    return {};
  }
}

/** Persist a pin for one host:port endpoint (0700 dir / 0600 file). */
function savePin(dir, host, port, pin) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const pins = loadPins(dir);
  pins[pinKey(host, port)] = pin;
  fs.writeFileSync(pinsFile(dir), JSON.stringify(pins), { mode: 0o600 });
}

/** TLS options that trust ONLY the pinned leaf and assert its fingerprint. */
function buildTlsOptions(pin) {
  return {
    ca: pin.certPem,
    rejectUnauthorized: true,
    checkServerIdentity: (host, cert) =>
      cert && cert.fingerprint256 === pin.fp256
        ? undefined
        : new Error(
            `NVR cert fingerprint changed for ${host} (expected ${pin.fp256}) — refusing to connect`,
          ),
  };
}

function pemFromRaw(raw) {
  const b64 = raw
    .toString('base64')
    .match(/.{1,64}/g)
    .join('\n');
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

/**
 * Return the pinned {fp256,certPem} for one host:port endpoint,
 * capturing+persisting on first use of THAT endpoint.
 *
 * SECURITY NOTE: the capture connection below is the ONLY place in this module
 * (and the only sanctioned place anywhere in the adoption flow) where
 * `rejectUnauthorized:false` is used. It is a one-time trust-on-first-use probe
 * that opens a brief LAN-MITM window during initial adoption of a console — an
 * attacker on the local network at that exact moment could hand us a forged
 * leaf. Once captured, the fingerprint is persisted and every subsequent
 * connection to THIS host:port MUST go through buildTlsOptions(), which pins
 * the leaf as CA + asserts fingerprint256 with rejectUnauthorized:true. The
 * admin API (:443) and the ds daemon (:7442) are each probed and pinned on
 * their own — see the file header. Never reuse this relaxed path for
 * steady-state traffic.
 */
async function probeAndPin({ host, port = 443, dir, tlsConnect = tls.connect }) {
  const existing = loadPins(dir)[pinKey(host, port)];
  if (existing) return existing;
  const pin = await new Promise((resolve, reject) => {
    const socket = tlsConnect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate(true);
      if (!cert || !cert.fingerprint256 || !cert.raw) {
        socket.destroy();
        return reject(new Error('no peer certificate to pin'));
      }
      const out = { fp256: cert.fingerprint256, certPem: pemFromRaw(cert.raw) };
      socket.destroy();
      resolve(out);
    });
    socket.on('error', reject);
  });
  savePin(dir, host, port, pin);
  return pin;
}

module.exports = { loadPins, savePin, buildTlsOptions, probeAndPin };
