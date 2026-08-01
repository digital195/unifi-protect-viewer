'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { nextBackoffMs } = require('../../src/main/viewport/adoption/backoff');

describe('adoption backoff', () => {
  test('grows exponentially from base', () => {
    assert.equal(nextBackoffMs(0, {}), 1000);
    assert.equal(nextBackoffMs(1, {}), 2000);
    assert.equal(nextBackoffMs(2, {}), 4000);
    assert.equal(nextBackoffMs(3, {}), 8000);
  });
  test('caps at maxMs', () => {
    assert.equal(nextBackoffMs(10, {}), 10000);
    assert.equal(nextBackoffMs(4, { maxMs: 5000 }), 5000);
  });
});
