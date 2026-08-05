'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ViewportBridge } = require('../../src/main/viewport/bridge');

// Inject a no-op interval so only the immediate first poll runs during tests.
const noopTimers = { setInterval: () => 1, clearInterval: () => {} };
const tick = () => new Promise((r) => setImmediate(r));

describe('ViewportBridge', () => {
  test('emits assignment with liveviewId on first successful poll', async () => {
    const bootstrap = { viewers: [{ name: 'TV', liveviewId: 'lv1' }] };
    const bridge = new ViewportBridge({
      name: 'TV',
      fetchBootstrap: async () => bootstrap,
      ...noopTimers,
    });
    const seen = [];
    bridge.on('assignment', (id) => seen.push(id));
    bridge.start();
    await tick();
    assert.deepEqual(seen, ['lv1']);
  });

  test('does not re-emit assignment when unchanged, re-emits on change', async () => {
    let current = 'lv1';
    const bridge = new ViewportBridge({
      name: 'TV',
      fetchBootstrap: async () => ({ viewers: [{ name: 'TV', liveviewId: current }] }),
      ...noopTimers,
    });
    const seen = [];
    bridge.on('assignment', (id) => seen.push(id));
    bridge.start();
    await tick();
    await bridge._poll(); // same value → no emit
    current = 'lv2';
    await bridge._poll(); // changed → emit
    assert.deepEqual(seen, ['lv1', 'lv2']);
  });

  test('emits status ok:false with message when fetch throws, no assignment', async () => {
    const bridge = new ViewportBridge({
      name: 'TV',
      fetchBootstrap: async () => {
        throw new Error('HTTP 401');
      },
      ...noopTimers,
    });
    const statuses = [];
    const assignments = [];
    bridge.on('status', (s) => statuses.push(s));
    bridge.on('assignment', (id) => assignments.push(id));
    bridge.start();
    await tick();
    assert.equal(assignments.length, 0);
    assert.equal(statuses[0].ok, false);
    assert.match(statuses[0].error, /401/);
  });
});
