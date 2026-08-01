'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { startNativeViewport } = require('../../src/main/viewport/native');

function fakeClient() {
  const c = new EventEmitter();
  c.stop = () => {
    c.stopped = true;
  };
  return c;
}

describe('startNativeViewport', () => {
  test('navigates to /protect/dashboard/<id> on an assignment', () => {
    const client = fakeClient();
    const nav = [];
    startNativeViewport({ client, baseUrl: 'https://nvr/protect', navigate: (u) => nav.push(u) });
    client.emit('assignment', { liveviewId: 'lv1', liveview: { id: 'lv1' } });
    assert.deepEqual(nav, ['https://nvr/protect/dashboard/lv1']);
  });

  test('navigates to the base url when unassigned (null assignment)', () => {
    const client = fakeClient();
    const nav = [];
    startNativeViewport({ client, baseUrl: 'https://nvr/protect', navigate: (u) => nav.push(u) });
    client.emit('assignment', null);
    assert.deepEqual(nav, ['https://nvr/protect']);
  });

  test('dedupes a repeat of the same target', () => {
    const client = fakeClient();
    const nav = [];
    startNativeViewport({ client, baseUrl: 'https://nvr/protect', navigate: (u) => nav.push(u) });
    client.emit('assignment', { liveviewId: 'lv1' });
    client.emit('assignment', { liveviewId: 'lv1' });
    assert.equal(nav.length, 1);
  });

  test('stop() stops the client', () => {
    const client = fakeClient();
    const handle = startNativeViewport({
      client,
      baseUrl: 'https://nvr/protect',
      navigate: () => {},
    });
    handle.stop();
    assert.equal(client.stopped, true);
  });

  test('stop() unsubscribes its own listeners from the client (no leak)', () => {
    const client = fakeClient();
    const handle = startNativeViewport({
      client,
      baseUrl: 'https://nvr/protect',
      navigate: () => {},
    });
    assert.ok(client.listenerCount('assignment') > 0, 'assignment listener should be attached');
    assert.ok(client.listenerCount('online') > 0, 'online listener should be attached');
    assert.ok(client.listenerCount('error') > 0, 'error listener should be attached');
    handle.stop();
    assert.equal(client.listenerCount('assignment'), 0, 'assignment listener must be removed');
    assert.equal(client.listenerCount('online'), 0, 'online listener must be removed');
    assert.equal(client.listenerCount('error'), 0, 'error listener must be removed');
  });
});
