'use strict';

/**
 * @file test/main/render-session.test.js
 * @description Unit tests for the tiny process-memory render-session override
 * module (2c fix, whole-branch review finding I1). Pure module — no
 * Electron/Node I/O, no mocking needed — but state is a module-level
 * singleton, so every test resets it explicitly (beforeEach/afterEach) to
 * stay isolated from the other test files that share this same require-cache
 * instance (ipc.test.js, window-viewport-mode.test.js).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const renderSession = require('../../src/main/render-session');

describe('render-session.js', () => {
  beforeEach(() => renderSession.clear());
  afterEach(() => renderSession.clear());

  test('module boundary: exports exactly the three functions', () => {
    assert.deepStrictEqual(Object.keys(renderSession).sort(), [
      'clear',
      'getRenderCredentialOverride',
      'setRenderCredentialOverride',
    ]);
  });

  test('default state: no override set → returns null', () => {
    assert.strictEqual(renderSession.getRenderCredentialOverride(), null);
  });

  test('setRenderCredentialOverride then get → returns the same url/username/password', () => {
    renderSession.setRenderCredentialOverride({
      url: 'https://fallback.local',
      username: 'fbuser',
      password: 'fbpass',
    });
    assert.deepEqual(renderSession.getRenderCredentialOverride(), {
      url: 'https://fallback.local',
      username: 'fbuser',
      password: 'fbpass',
    });
  });

  test('only url/username/password are retained (extra profile fields like id/name are dropped)', () => {
    renderSession.setRenderCredentialOverride({
      id: 'fb',
      name: 'Fallback',
      url: 'https://fallback.local',
      username: 'fbuser',
      password: 'fbpass',
      extra: 'should not survive',
    });
    const result = renderSession.getRenderCredentialOverride();
    assert.deepStrictEqual(Object.keys(result).sort(), ['password', 'url', 'username']);
  });

  test('username/password omitted on the input → become undefined, not dropped/thrown', () => {
    renderSession.setRenderCredentialOverride({ url: 'https://fallback.local' });
    const result = renderSession.getRenderCredentialOverride();
    assert.strictEqual(result.url, 'https://fallback.local');
    assert.strictEqual(result.username, undefined);
    assert.strictEqual(result.password, undefined);
  });

  test('clear() resets to null', () => {
    renderSession.setRenderCredentialOverride({ url: 'https://fallback.local' });
    renderSession.clear();
    assert.strictEqual(renderSession.getRenderCredentialOverride(), null);
  });

  test('clear() is a no-op (does not throw) when nothing was set', () => {
    assert.doesNotThrow(() => renderSession.clear());
    assert.strictEqual(renderSession.getRenderCredentialOverride(), null);
  });

  test('setRenderCredentialOverride(null) clears any existing override', () => {
    renderSession.setRenderCredentialOverride({ url: 'https://fallback.local' });
    renderSession.setRenderCredentialOverride(null);
    assert.strictEqual(renderSession.getRenderCredentialOverride(), null);
  });

  test('setting a new override replaces the previous one entirely', () => {
    renderSession.setRenderCredentialOverride({ url: 'https://first.local', username: 'a' });
    renderSession.setRenderCredentialOverride({ url: 'https://second.local', username: 'b' });
    assert.deepEqual(renderSession.getRenderCredentialOverride(), {
      url: 'https://second.local',
      username: 'b',
      password: undefined,
    });
  });
});
