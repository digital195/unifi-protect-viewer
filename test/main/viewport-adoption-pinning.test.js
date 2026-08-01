'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const P = require('../../src/main/viewport/adoption/pinning');

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upv-pin-'));
});
after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('pinning', () => {
  test('buildTlsOptions accepts a matching fingerprint, rejects a changed one', () => {
    const opts = P.buildTlsOptions({ fp256: 'AA:BB', certPem: 'PEM' });
    assert.equal(opts.rejectUnauthorized, true);
    assert.equal(opts.ca, 'PEM');
    assert.equal(opts.checkServerIdentity('nvr', { fingerprint256: 'AA:BB' }), undefined);
    const err = opts.checkServerIdentity('nvr', { fingerprint256: 'CC:DD' });
    assert.ok(err instanceof Error);
    assert.match(err.message, /fingerprint changed/i);
  });

  test('probeAndPin captures + persists per host:port, reuses cache for the SAME host:port', async () => {
    let connects = 0;
    const tlsConnect = (o, onSecure) => {
      connects += 1;
      const sock = new EventEmitter();
      sock.getPeerCertificate = () => ({ fingerprint256: 'AA:BB', raw: Buffer.from('rawcert') });
      sock.destroy = () => {};
      setImmediate(onSecure);
      return sock;
    };
    const first = await P.probeAndPin({ host: 'nvr', port: 443, dir, tlsConnect });
    assert.equal(first.fp256, 'AA:BB');
    assert.match(first.certPem, /BEGIN CERTIFICATE/);
    assert.equal(connects, 1);
    const cached = await P.probeAndPin({ host: 'nvr', port: 443, dir, tlsConnect });
    assert.equal(cached.fp256, 'AA:BB');
    assert.equal(connects, 1); // no second TLS probe — same host:port reuses its pin
    assert.deepEqual(P.loadPins(dir)['nvr:443'], first);
  });

  // I1: on a UDM, :443 (UniFi OS reverse proxy) and :7442 (ds daemon) present
  // DIFFERENT leaf certs. A shared host-only pin would make the ds connect's
  // checkServerIdentity fail against the :443 cert. Pins must be keyed by
  // host:port so each endpoint is probed and pinned independently.
  test('probeAndPin pins :443 and :7442 on the SAME host independently — no cross-port reuse', async () => {
    let connects = 0;
    const tlsConnect = (o, onSecure) => {
      connects += 1;
      const sock = new EventEmitter();
      // Distinct cert per port, as real UDM hardware presents.
      sock.getPeerCertificate = () => ({
        fingerprint256: o.port === 443 ? 'AA:BB:443' : 'CC:DD:7442',
        raw: Buffer.from(`rawcert-${o.port}`),
      });
      sock.destroy = () => {};
      setImmediate(onSecure);
      return sock;
    };
    const pin443 = await P.probeAndPin({ host: 'udm', port: 443, dir, tlsConnect });
    const pin7442 = await P.probeAndPin({ host: 'udm', port: 7442, dir, tlsConnect });
    assert.equal(connects, 2); // each port probed on its own
    assert.equal(pin443.fp256, 'AA:BB:443');
    assert.equal(pin7442.fp256, 'CC:DD:7442');
    assert.notDeepEqual(pin443, pin7442);
    assert.deepEqual(P.loadPins(dir)['udm:443'], pin443);
    assert.deepEqual(P.loadPins(dir)['udm:7442'], pin7442);
    // Re-probing either endpoint now reuses its OWN pin — no growth in connects.
    const pin443Again = await P.probeAndPin({ host: 'udm', port: 443, dir, tlsConnect });
    const pin7442Again = await P.probeAndPin({ host: 'udm', port: 7442, dir, tlsConnect });
    assert.equal(connects, 2);
    assert.deepEqual(pin443Again, pin443);
    assert.deepEqual(pin7442Again, pin7442);
  });

  test('savePin merges multiple host:port keys — a later save does not drop an earlier one', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'upv-pin-multi-'));
    try {
      const pinA = { fp256: 'AA:AA', certPem: 'PEM-A' };
      const pinB = { fp256: 'BB:BB', certPem: 'PEM-B' };
      const pinC = { fp256: 'CC:CC', certPem: 'PEM-C' };
      P.savePin(d, 'hostA', 443, pinA);
      P.savePin(d, 'hostA', 7442, pinB); // same host, different port -> its own key
      P.savePin(d, 'hostB', 443, pinC);
      const pins = P.loadPins(d);
      assert.deepEqual(pins['hostA:443'], pinA);
      assert.deepEqual(pins['hostA:7442'], pinB);
      assert.deepEqual(pins['hostB:443'], pinC);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test('probeAndPin rejects on a TLS connection error and persists nothing', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'upv-pin-err-'));
    try {
      const tlsConnect = () => {
        const sock = new EventEmitter();
        sock.getPeerCertificate = () => ({});
        sock.destroy = () => {};
        setImmediate(() => sock.emit('error', new Error('ECONNREFUSED')));
        return sock;
      };
      await assert.rejects(() => P.probeAndPin({ host: 'nvr-err', port: 443, dir: d, tlsConnect }));
      assert.equal(P.loadPins(d)['nvr-err:443'], undefined);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test('probeAndPin rejects when the peer certificate is missing/empty and persists nothing', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'upv-pin-nocert-'));
    try {
      const tlsConnect = (o, onSecure) => {
        const sock = new EventEmitter();
        sock.getPeerCertificate = () => ({}); // no fingerprint256, no raw
        sock.destroy = () => {};
        setImmediate(onSecure);
        return sock;
      };
      await assert.rejects(
        () => P.probeAndPin({ host: 'nvr-nocert', port: 443, dir: d, tlsConnect }),
        /no peer certificate/i,
      );
      assert.equal(P.loadPins(d)['nvr-nocert:443'], undefined);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});
