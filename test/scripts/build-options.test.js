'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildPackagerOptions } = require('../../scripts/build.js');

function makeEnv(overrides = {}) {
  return { UPV_PLATFORM: 'darwin', UPV_ARCH: 'arm64', ...overrides };
}

test('darwin target on darwin host → ad-hoc osxSign by default', () => {
  const options = buildPackagerOptions(makeEnv(), 'darwin');
  assert.deepEqual(options.osxSign, {
    identity: '-',
    identityValidation: false,
    continueOnError: false,
  });
});

test('UPV_MAC_SIGN_IDENTITY overrides the signing identity', () => {
  const env = makeEnv({ UPV_MAC_SIGN_IDENTITY: 'Developer ID Application: Example' });
  const options = buildPackagerOptions(env, 'darwin');
  assert.equal(options.osxSign.identity, 'Developer ID Application: Example');
  // Validation stays off, so the value is used as the codesign identity directly.
  assert.equal(options.osxSign.identityValidation, false);
});

test('darwin target on non-darwin host → no osxSign key', () => {
  const options = buildPackagerOptions(makeEnv(), 'win32');
  assert.ok(!('osxSign' in options));
});

test('win32 target → no osxSign, win32metadata present', () => {
  const options = buildPackagerOptions(
    makeEnv({ UPV_PLATFORM: 'win32', UPV_ARCH: 'x64' }),
    'win32',
  );
  assert.ok(!('osxSign' in options));
  assert.equal(options.win32metadata.FileDescription, 'Unifi Protect Viewer');
  assert.equal(options.win32metadata.ProductName, 'Unifi Protect Viewer');
  assert.equal(typeof options.win32metadata.CompanyName, 'string');
});

test('darwin target → appBundleId set; win32 target → not set', () => {
  const darwin = buildPackagerOptions(makeEnv(), 'darwin');
  assert.equal(darwin.appBundleId, 'com.digital195.unifi-protect-viewer');
  const win32 = buildPackagerOptions(makeEnv({ UPV_PLATFORM: 'win32' }), 'win32');
  assert.ok(!('appBundleId' in win32));
});
