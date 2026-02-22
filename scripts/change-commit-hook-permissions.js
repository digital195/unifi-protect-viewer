'use strict';

const fs = require('node:fs');

// chmod is a no-op on Windows – skip it to avoid silent failures
if (process.platform !== 'win32') {
  fs.chmodSync('./.husky/pre-commit', 0o755);
  console.log('made .husky/pre-commit executable');
} else {
  console.log('skipping chmod on Windows (not required)');
}
