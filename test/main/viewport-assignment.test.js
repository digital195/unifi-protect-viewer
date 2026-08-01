'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  findViewer,
  selectLiveviewId,
  liveviewUrl,
  assignmentTargetUrl,
} = require('../../src/main/viewport/assignment');

const bootstrap = {
  viewers: [
    { id: 'a1', name: 'Other', liveviewId: 'xxx' },
    { id: 'b2', name: 'Wall TV', liveviewId: '699e37cc0208bf03e4273775' },
    { id: 'c3', name: 'Empty', liveviewId: '' },
  ],
};

describe('assignment helpers', () => {
  test('findViewer matches by name', () => {
    assert.equal(findViewer(bootstrap, 'Wall TV').id, 'b2');
  });
  test('findViewer returns null when absent or bootstrap malformed', () => {
    assert.equal(findViewer(bootstrap, 'Nope'), null);
    assert.equal(findViewer(null, 'Wall TV'), null);
    assert.equal(findViewer({}, 'Wall TV'), null);
  });
  test('selectLiveviewId returns the assigned id', () => {
    assert.equal(selectLiveviewId(bootstrap, 'Wall TV'), '699e37cc0208bf03e4273775');
  });
  test('selectLiveviewId returns null for empty or missing', () => {
    assert.equal(selectLiveviewId(bootstrap, 'Empty'), null);
    assert.equal(selectLiveviewId(bootstrap, 'Nope'), null);
  });
  test('selectLiveviewId reads the bootstrap API field name `liveview`', () => {
    const apiBootstrap = { viewers: [{ name: 'ApiField', liveview: 'lvAPI' }] };
    assert.equal(selectLiveviewId(apiBootstrap, 'ApiField'), 'lvAPI');
  });
  test('selectLiveviewId returns null for empty `liveview` with no liveviewId', () => {
    const apiBootstrap = { viewers: [{ name: 'ApiEmpty', liveview: '' }] };
    assert.equal(selectLiveviewId(apiBootstrap, 'ApiEmpty'), null);
  });
  test('liveviewUrl builds dashboard URL from origin', () => {
    assert.equal(
      liveviewUrl('https://192.168.50.1/protect/dashboard', '699e37cc0208bf03e4273775'),
      'https://192.168.50.1/protect/dashboard/699e37cc0208bf03e4273775',
    );
  });
  test('liveviewUrl returns null when no liveviewId', () => {
    assert.equal(liveviewUrl('https://192.168.50.1/x', null), null);
  });
  test('assignmentTargetUrl falls back to baseUrl when unassigned', () => {
    assert.equal(
      assignmentTargetUrl('https://192.168.50.1/protect/dashboard', null),
      'https://192.168.50.1/protect/dashboard',
    );
    assert.equal(
      assignmentTargetUrl('https://192.168.50.1/protect/dashboard', 'b2id'),
      'https://192.168.50.1/protect/dashboard/b2id',
    );
  });
});
