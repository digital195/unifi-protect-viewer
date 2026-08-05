'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe('adoption deps', () => {
  test('ws is installed and exposes WebSocket', () => {
    const WebSocket = require('ws');
    assert.equal(typeof WebSocket, 'function');
  });
  test('selfsigned is installed and exposes generate', () => {
    const selfsigned = require('selfsigned');
    assert.equal(typeof selfsigned.generate, 'function');
  });
});
