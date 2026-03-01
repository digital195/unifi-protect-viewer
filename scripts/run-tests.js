#!/usr/bin/env node
'use strict';

/**
 * Cross-platform test runner helper.
 * Recursively finds all *.test.js files under tests/unit/ and passes them to node --test.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function findTestFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(full);
    }
  }
  return files;
}

const testDir = path.join(__dirname, '..', 'test');
const testFiles = findTestFiles(testDir);

if (testFiles.length === 0) {
  console.error('No test files found in', testDir);
  process.exit(1);
}

const args = ['--test', ...testFiles];

// Pass through coverage flag if requested
if (process.argv.includes('--coverage')) {
  args.splice(1, 0, '--experimental-test-coverage');
}

const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
