'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../src/main/viewport/adoption/protocol');

describe('UCP frame codec', () => {
  test('encodeFrame writes [ver=1][type=1][6B BE len][json]', () => {
    const buf = P.encodeFrame({ a: 1 });
    assert.equal(buf[0], 1);
    assert.equal(buf[1], 1);
    assert.equal(buf.readUIntBE(2, 6), buf.length - 8);
    assert.deepEqual(JSON.parse(buf.subarray(8).toString('utf8')), { a: 1 });
  });

  test('parseFrames round-trips two concatenated frames', () => {
    const buf = Buffer.concat([P.encodeFrame({ x: 1 }), P.encodeFrame({ y: 2 })]);
    const frames = P.parseFrames(buf);
    assert.equal(frames.length, 2);
    assert.deepEqual(JSON.parse(frames[0].payload.toString('utf8')), { x: 1 });
    assert.deepEqual(JSON.parse(frames[1].payload.toString('utf8')), { y: 2 });
  });

  test('parseFrames flags a truncated tail instead of throwing', () => {
    const full = P.encodeFrame({ big: 'z' });
    const frames = P.parseFrames(full.subarray(0, full.length - 2));
    assert.equal(frames.length, 1);
    assert.equal(frames[0].truncated, true);
    assert.equal(frames[0].len, full.readUIntBE(2, 6));
  });

  test('pairFrames pairs positionally and returns a remainder', () => {
    const a = P.pairFrames([{ e: 1 }, { b: 1 }, { e: 2 }, { b: 2 }]);
    assert.deepEqual(a.pairs, [
      { envelope: { e: 1 }, body: { b: 1 } },
      { envelope: { e: 2 }, body: { b: 2 } },
    ]);
    assert.deepEqual(a.remainder, []);
    const b = P.pairFrames([{ e: 1 }, { b: 1 }, { e: 2 }]);
    assert.deepEqual(b.pairs, [{ envelope: { e: 1 }, body: { b: 1 } }]);
    assert.deepEqual(b.remainder, [{ e: 2 }]);
  });
});

describe('UCP builders', () => {
  test('buildResponseFrames echoes id/action with type:response', () => {
    const buf = P.buildResponseFrames(
      { action: 'getInfo', id: 42, type: 'request' },
      { ok: 1 },
      1000,
    );
    const frames = P.parseFrames(buf);
    assert.equal(frames.length, 2);
    const env = JSON.parse(frames[0].payload.toString('utf8'));
    const body = JSON.parse(frames[1].payload.toString('utf8'));
    assert.deepEqual(env, { timestamp: 1000, type: 'response', action: 'getInfo', id: 42 });
    assert.deepEqual(body, { ok: 1 });
  });

  test('buildResponseFrames defaults a nullish body to {}', () => {
    const frames = P.parseFrames(
      P.buildResponseFrames({ action: 'networkStatus', id: 5 }, null, 7),
    );
    assert.deepEqual(JSON.parse(frames[1].payload.toString('utf8')), {});
  });

  test('buildDeviceInfo is complete + truthful (modelKey viewer, from identity)', () => {
    const id = { mac: 'AABBCCDDEEFF', ident: 'guid-1', cert: 'x' };
    const info = P.buildDeviceInfo(id, 'Wall TV', { ip: '10.0.0.5', uptime: 12, isAdopted: true });
    assert.equal(info.mac, 'AABBCCDDEEFF');
    assert.equal(info.name, 'Wall TV');
    assert.equal(info.modelKey, 'viewer');
    assert.equal(info.model, 'UP Viewport');
    assert.equal(info.firmwareVersion, '1.4.33');
    assert.equal(info.hardwareRevision, '1');
    assert.equal(info.guid, 'guid-1');
    assert.equal(info.ip, '10.0.0.5');
    assert.equal(info.uptime, 12);
    assert.equal(info.isProvisioned, true);
    assert.equal(info.isAdopted, true);
  });

  test('parseConfigure reads liveview.id from the OBJECT (not as a string)', () => {
    const body = {
      liveview: { name: 'Default', id: '6960302e03b6a203e4000cb7', layout: 5, slots: [] },
    };
    const a = P.parseConfigure(body);
    assert.equal(a.liveviewId, '6960302e03b6a203e4000cb7');
    assert.equal(a.liveview.layout, 5);
  });

  test('parseConfigure returns null when liveview is absent (unassign)', () => {
    assert.equal(P.parseConfigure({ name: 'x' }), null);
    assert.equal(P.parseConfigure({}), null);
    assert.equal(P.parseConfigure(null), null);
  });

  test('replyBodyFor: getInfo -> device info, everything else -> {} ack', () => {
    const id = { mac: 'AABBCCDDEEFF', ident: 'g', cert: 'x' };
    const ctx = { identity: id, name: 'TV', deviceInfoOpts: {} };
    assert.equal(P.replyBodyFor('getInfo', ctx).mac, 'AABBCCDDEEFF');
    for (const a of [
      'networkStatus',
      'configure',
      'changeUserPassword',
      'enableUpdatesChannel',
      'whatever',
    ]) {
      assert.deepEqual(P.replyBodyFor(a, ctx), {});
    }
  });

  test('buildUpgradeHeaders sets ucp4 + x-* and only includes x-token when present', () => {
    const h = P.buildUpgradeHeaders({ mac: 'AABBCCDDEEFF', ident: 'g1', fingerprint: 'AA:BB' });
    assert.equal(h['sec-websocket-protocol'], 'ucp4');
    assert.equal(h['x-ident'], 'AABBCCDDEEFF');
    assert.equal(h['x-type'], 'UP Viewport');
    assert.equal(h['x-mode'], '0');
    assert.equal(h['x-fingerprint'], 'AA:BB');
    assert.equal(h['x-version'], '1.4.33');
    assert.equal(h['x-guid'], 'g1');
    assert.equal('x-token' in h, false);
    const h2 = P.buildUpgradeHeaders({ mac: 'M', fingerprint: 'F', token: 'TKN' });
    assert.equal(h2['x-token'], 'TKN');
  });

  test('buildUpgradeHeaders sets x-ip when ip is given, omits it otherwise', () => {
    const withIp = P.buildUpgradeHeaders({ mac: 'M', fingerprint: 'F', ip: '192.168.50.42' });
    assert.equal(withIp['x-ip'], '192.168.50.42');
    const withoutIp = P.buildUpgradeHeaders({ mac: 'M', fingerprint: 'F' });
    assert.equal('x-ip' in withoutIp, false);
    const emptyIp = P.buildUpgradeHeaders({ mac: 'M', fingerprint: 'F', ip: '' });
    assert.equal('x-ip' in emptyIp, false);
  });
});

describe('localIpForHost (UDP routing probe — no packets sent)', () => {
  // Fake udp4 socket: an EventEmitter with connect(port,host,cb) -> cb(),
  // address() -> {address}, close(). Mirrors node:dgram's Socket surface
  // just enough for localIpForHost's usage.
  const { EventEmitter } = require('node:events');
  class FakeSocket extends EventEmitter {
    constructor(addr) {
      super();
      this._addr = addr;
      this.closed = false;
    }
    connect(_port, _host, cb) {
      cb();
    }
    address() {
      return { address: this._addr };
    }
    close() {
      this.closed = true;
    }
  }

  test('resolves the fake socket source address', async () => {
    const fake = new FakeSocket('192.168.50.42');
    const ip = await P.localIpForHost('192.168.50.1', { dgramFactory: () => fake });
    assert.equal(ip, '192.168.50.42');
    assert.equal(fake.closed, true);
  });

  test('a socket that errors instead of connecting resolves null', async () => {
    class ErroringSocket extends EventEmitter {
      connect() {
        // Simulate an async connect failure instead of invoking the callback.
        setImmediate(() => this.emit('error', new Error('boom')));
      }
      address() {
        throw new Error('should not be called');
      }
      close() {}
    }
    const ip = await P.localIpForHost('192.168.50.1', { dgramFactory: () => new ErroringSocket() });
    assert.equal(ip, null);
  });

  test('a socket that never calls back resolves null after timeoutMs', async () => {
    class HangingSocket extends EventEmitter {
      connect() {
        // Never calls back — but a real dgram socket holds a ref'd OS handle
        // open while connecting, which is what lets localIpForHost's OWN
        // (deliberately unref'd) fallback timer actually get a chance to
        // fire. Mirror that with a ref'd keep-alive interval so this test
        // exercises the timeout path instead of the process/event-loop
        // exiting early because nothing else is pending.
        this._keepAlive = setInterval(() => {}, 1e6);
      }
      address() {
        throw new Error('should not be called');
      }
      close() {
        clearInterval(this._keepAlive);
      }
    }
    const ip = await P.localIpForHost('192.168.50.1', {
      dgramFactory: () => new HangingSocket(),
      timeoutMs: 10,
    });
    assert.equal(ip, null);
  });

  test('a dgramFactory that throws synchronously resolves null', async () => {
    const ip = await P.localIpForHost('192.168.50.1', {
      dgramFactory: () => {
        throw new Error('no dgram for you');
      },
    });
    assert.equal(ip, null);
  });
});

describe('dsWsUrl (ds daemon WebSocket URL derivation — C1)', () => {
  test('derives wss://<host>:7442/viewer/1.0/ws from an https base URL', () => {
    assert.equal(P.dsWsUrl('https://192.168.50.1'), 'wss://192.168.50.1:7442/viewer/1.0/ws');
  });

  test('a non-standard https port in the input is dropped — still yields :7442', () => {
    assert.equal(P.dsWsUrl('https://nvr.local:8443'), 'wss://nvr.local:7442/viewer/1.0/ws');
  });

  test('any path/query on the input base URL is dropped, not merged in', () => {
    assert.equal(P.dsWsUrl('https://nvr.local/protect?x=1'), 'wss://nvr.local:7442/viewer/1.0/ws');
  });

  test('forces wss: even when given a plain http: base URL', () => {
    assert.equal(P.dsWsUrl('http://nvr.local'), 'wss://nvr.local:7442/viewer/1.0/ws');
  });

  test('port and path are overridable', () => {
    assert.equal(
      P.dsWsUrl('https://nvr.local', { port: 1234, path: '/x' }),
      'wss://nvr.local:1234/x',
    );
  });
});
