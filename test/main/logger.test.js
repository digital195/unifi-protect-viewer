'use strict';

/**
 * @file test/main/logger.test.js
 * @description Contract tests for src/main/logger.js
 *
 * Covers:
 *  1.  formatLogLine – ISO timestamp, correct prefix, correct message
 *  2.  resolveLogPath – uses app.getPath('userData') + '/upv.log'
 *  3.  createLogger.log – appends correctly
 *  4.  createLogger.log – handles write errors safely
 *  5.  createLogger without app – null safe
 *  6.  IPC / constant integrity
 *  7.  rotateLog – no rotation below 5 MB
 *  8.  rotateLog – rotation when size exceeds 5 MB
 *  9.  rotateLog – correct archive shifting order
 * 10.  rotateLog – max 3 archives enforced
 * 11.  rotateLog – graceful handling of fs failures
 * 12.  createRotatingLogger – rotation triggered via log()
 * 13.  MAX_LOG_BYTES and MAX_ARCHIVES constants locked
 *
 * Uses ONLY node:test + node:assert/strict.
 * All fs operations are mocked. No real files written.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  createLogger,
  createRotatingLogger,
  rotateLog,
  rotateOnStartup,
  formatLogLine,
  resolveLogPath,
  LOG_IPC_CHANNEL,
  LOG_SOURCE_APP,
  LOG_SOURCE_WINDOW,
  LOG_FILE_NAME,
  MAX_LOG_BYTES,
  MAX_ARCHIVES,
} = require('../../src/main/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeMockApp(userData = '/fake/userData') {
  return {
    getPath: (key) => {
      if (key === 'userData') return userData;
      throw new Error(`unexpected getPath key: ${key}`);
    },
  };
}

/**
 * Builds a mock fs that tracks all calls and supports a configurable
 * virtual filesystem (files map: path → { size }).
 *
 * opts.files  – initial virtual FS: { [path]: { size: number, exists: true } }
 * opts.throwOn – { statSync?, renameSync?, unlinkSync?, appendFileSync? } → throw on call
 */
function makeMockFs(opts = {}) {
  const appendCalls = [];
  const renameCalls = [];
  const unlinkCalls = [];
  const statCalls = [];
  const files = Object.assign({}, opts.files || {});

  const shouldThrow = (op) => opts.throwOn && opts.throwOn[op];

  const mockFs = {
    statSync: (p) => {
      statCalls.push(p);
      if (shouldThrow('statSync')) throw new Error('stat error');
      if (files[p] && files[p].exists !== false) return { size: files[p].size };
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    renameSync: (src, dest) => {
      renameCalls.push({ src, dest });
      if (shouldThrow('renameSync')) throw new Error('rename error');
      // Move in virtual FS
      if (files[src]) {
        files[dest] = { ...files[src] };
        delete files[src];
      }
    },
    unlinkSync: (p) => {
      unlinkCalls.push(p);
      if (shouldThrow('unlinkSync')) throw new Error('unlink error');
      delete files[p];
    },
    appendFileSync: (filePath, data, encoding) => {
      appendCalls.push({ filePath, data, encoding });
      if (opts.throwError) throw new Error('disk full');
    },
    // Accessors for test assertions
    getAppendCalls: () => appendCalls,
    getRenameCalls: () => renameCalls,
    getUnlinkCalls: () => unlinkCalls,
    getStatCalls: () => statCalls,
    getFiles: () => files,
    // Legacy alias
    getCalls: () => appendCalls,
  };
  return mockFs;
}

const LOG_PATH = '/data/upv.log';

// ─────────────────────────────────────────────────────────────────────────────
// § 1 – formatLogLine
// ─────────────────────────────────────────────────────────────────────────────

describe('formatLogLine', () => {
  test('produces ISO timestamp at start', () => {
    const now = new Date('2026-03-01T12:01:22.123Z');
    const line = formatLogLine('app', 'hello', now);
    assert.ok(line.startsWith('2026-03-01T12:01:22.123Z'), `got: ${line}`);
  });

  test('includes correct source prefix [upv app]', () => {
    const now = new Date('2026-03-01T12:00:00.000Z');
    const line = formatLogLine(LOG_SOURCE_APP, 'msg', now);
    assert.ok(line.includes('[upv app]'), `got: ${line}`);
  });

  test('includes correct source prefix [upv window]', () => {
    const now = new Date('2026-03-01T12:00:00.000Z');
    const line = formatLogLine(LOG_SOURCE_WINDOW, 'msg', now);
    assert.ok(line.includes('[upv window]'), `got: ${line}`);
  });

  test('includes the message content', () => {
    const now = new Date('2026-03-01T12:00:00.000Z');
    const line = formatLogLine('app', 'Profile loaded successfully', now);
    assert.ok(line.includes('Profile loaded successfully'), `got: ${line}`);
  });

  test('full format matches expected pattern', () => {
    const now = new Date('2026-03-01T12:01:23.456Z');
    const line = formatLogLine('app', 'Profile loaded successfully', now);
    assert.equal(line, '2026-03-01T12:01:23.456Z [upv app] Profile loaded successfully');
  });

  test('window source full format', () => {
    const now = new Date('2026-03-01T12:01:22.123Z');
    const line = formatLogLine('window', 'Login button clicked', now);
    assert.equal(line, '2026-03-01T12:01:22.123Z [upv window] Login button clicked');
  });

  test('uses current time when no date injected', () => {
    const before = Date.now();
    const line = formatLogLine('app', 'test');
    const after = Date.now();
    const ts = line.split(' ')[0];
    const parsed = new Date(ts).getTime();
    assert.ok(!isNaN(parsed));
    assert.ok(parsed >= before && parsed <= after);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 2 – resolveLogPath
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveLogPath', () => {
  test('returns userData dir + log file name', () => {
    const result = resolveLogPath(makeMockApp('/my/userData'));
    assert.equal(result, path.join('/my/userData', 'upv.log'));
  });

  test('log file name is "upv.log"', () => {
    const result = resolveLogPath(makeMockApp('/some/path'));
    assert.ok(result.endsWith('upv.log'), `got: ${result}`);
  });

  test('LOG_FILE_NAME constant equals upv.log', () => {
    assert.equal(LOG_FILE_NAME, 'upv.log');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 3 – createLogger.log – appends correctly
// ─────────────────────────────────────────────────────────────────────────────

describe('createLogger – appends correctly', () => {
  test('calls appendFileSync with correct path', () => {
    const mockFs = makeMockFs({ files: { [path.join('/data', 'upv.log')]: { size: 0 } } });
    const logger = createLogger({ fs: mockFs, app: makeMockApp('/data') });
    logger.log(LOG_SOURCE_APP, 'startup', new Date('2026-01-01T00:00:00.000Z'));
    const calls = mockFs.getCalls();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].filePath, path.join('/data', 'upv.log'));
  });

  test('written line contains formatted content', () => {
    const mockFs = makeMockFs({ files: { [path.join('/data', 'upv.log')]: { size: 0 } } });
    const logger = createLogger({ fs: mockFs, app: makeMockApp('/data') });
    const now = new Date('2026-03-01T09:00:00.000Z');
    logger.log(LOG_SOURCE_APP, 'test message', now);
    const line = mockFs.getCalls()[0].data;
    assert.ok(line.includes('[upv app]'), `got: ${line}`);
    assert.ok(line.includes('test message'), `got: ${line}`);
    assert.ok(line.includes('2026-03-01T09:00:00.000Z'), `got: ${line}`);
  });

  test('appends newline after each line', () => {
    const mockFs = makeMockFs({ files: { [path.join('/', 'upv.log')]: { size: 0 } } });
    const logger = createLogger({ fs: mockFs, app: makeMockApp('/') });
    logger.log('app', 'msg', new Date());
    const data = mockFs.getCalls()[0].data;
    assert.ok(data.endsWith('\n'));
  });

  test('uses utf8 encoding', () => {
    const mockFs = makeMockFs({ files: { [path.join('/', 'upv.log')]: { size: 0 } } });
    const logger = createLogger({ fs: mockFs, app: makeMockApp('/') });
    logger.log('app', 'msg', new Date());
    assert.equal(mockFs.getCalls()[0].encoding, 'utf8');
  });

  test('getLogPath returns expected path', () => {
    const logger = createLogger({ fs: makeMockFs(), app: makeMockApp('/userdata') });
    assert.equal(logger.getLogPath(), path.join('/userdata', 'upv.log'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 4 – createLogger.log – handles write errors safely
// ─────────────────────────────────────────────────────────────────────────────

describe('createLogger – handles write errors safely', () => {
  test('does not throw when fs.appendFileSync throws', () => {
    const mockFs = makeMockFs({
      throwError: true,
      files: { [path.join('/', 'upv.log')]: { size: 0 } },
    });
    const logger = createLogger({ fs: mockFs, app: makeMockApp('/') });
    assert.doesNotThrow(() => logger.log('app', 'msg', new Date()));
  });

  test('does not throw unhandled rejection on error', async () => {
    const mockFs = makeMockFs({
      throwError: true,
      files: { [path.join('/', 'upv.log')]: { size: 0 } },
    });
    const logger = createLogger({ fs: mockFs, app: makeMockApp('/') });
    await assert.doesNotReject(async () => logger.log('app', 'msg', new Date()));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 5 – createLogger without app
// ─────────────────────────────────────────────────────────────────────────────

describe('createLogger – no app provided', () => {
  test('getLogPath returns null when no app', () => {
    const logger = createLogger({ fs: makeMockFs(), app: null });
    assert.equal(logger.getLogPath(), null);
  });

  test('log() silently does nothing when no app', () => {
    const mockFs = makeMockFs();
    const logger = createLogger({ fs: mockFs, app: null });
    assert.doesNotThrow(() => logger.log('app', 'test', new Date()));
    assert.equal(mockFs.getCalls().length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 6 – IPC channel integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('IPC channel integrity', () => {
  test('LOG_IPC_CHANNEL equals "upv:log"', () => {
    assert.equal(LOG_IPC_CHANNEL, 'upv:log');
  });
  test('LOG_SOURCE_APP equals "app"', () => {
    assert.equal(LOG_SOURCE_APP, 'app');
  });
  test('LOG_SOURCE_WINDOW equals "window"', () => {
    assert.equal(LOG_SOURCE_WINDOW, 'window');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 7 – rotateLog – no rotation below threshold
// ─────────────────────────────────────────────────────────────────────────────

describe('rotateLog – no rotation below threshold', () => {
  test('does not rename when size is exactly 0', () => {
    const fs = makeMockFs({ files: { [LOG_PATH]: { size: 0 } } });
    rotateLog(LOG_PATH, fs);
    assert.equal(fs.getRenameCalls().length, 0);
  });

  test('does not rename when size is 1 byte below MAX_LOG_BYTES', () => {
    const fs = makeMockFs({ files: { [LOG_PATH]: { size: MAX_LOG_BYTES - 1 } } });
    rotateLog(LOG_PATH, fs);
    assert.equal(fs.getRenameCalls().length, 0);
  });

  test('does not rename when size equals MAX_LOG_BYTES exactly', () => {
    const fs = makeMockFs({ files: { [LOG_PATH]: { size: MAX_LOG_BYTES } } });
    rotateLog(LOG_PATH, fs);
    assert.equal(fs.getRenameCalls().length, 0);
  });

  test('does not rename when log file does not exist', () => {
    const fs = makeMockFs({ files: {} }); // no files → statSync throws
    rotateLog(LOG_PATH, fs);
    assert.equal(fs.getRenameCalls().length, 0);
  });

  test('MAX_LOG_BYTES is 5 * 1024 * 1024 (5 MB) – regression lock', () => {
    assert.equal(MAX_LOG_BYTES, 5 * 1024 * 1024);
  });

  test('MAX_ARCHIVES is 3 – regression lock', () => {
    assert.equal(MAX_ARCHIVES, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 8 – rotateLog – rotation when size exceeds 5 MB
// ─────────────────────────────────────────────────────────────────────────────

describe('rotateLog – rotation triggered', () => {
  test('renames upv.log → upv.log.1 when size > MAX_LOG_BYTES', () => {
    const fs = makeMockFs({ files: { [LOG_PATH]: { size: MAX_LOG_BYTES + 1 } } });
    rotateLog(LOG_PATH, fs);
    const renames = fs.getRenameCalls();
    const logToOne = renames.find((r) => r.src === LOG_PATH && r.dest === `${LOG_PATH}.1`);
    assert.ok(logToOne, `expected rename from ${LOG_PATH} to ${LOG_PATH}.1`);
  });

  test('does NOT rename when size equals MAX_LOG_BYTES (boundary)', () => {
    const fs = makeMockFs({ files: { [LOG_PATH]: { size: MAX_LOG_BYTES } } });
    rotateLog(LOG_PATH, fs);
    assert.equal(fs.getRenameCalls().length, 0);
  });

  test('does rename when size is MAX_LOG_BYTES + 1 (boundary)', () => {
    const fs = makeMockFs({ files: { [LOG_PATH]: { size: MAX_LOG_BYTES + 1 } } });
    rotateLog(LOG_PATH, fs);
    assert.ok(fs.getRenameCalls().length > 0, 'at least one rename must occur');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 9 – rotateLog – correct archive shifting order
// ─────────────────────────────────────────────────────────────────────────────

describe('rotateLog – archive shifting order', () => {
  test('shifts upv.log.1 → upv.log.2 when .1 exists and size exceeded', () => {
    const fs = makeMockFs({
      files: {
        [LOG_PATH]: { size: MAX_LOG_BYTES + 1 },
        [`${LOG_PATH}.1`]: { size: 100 },
      },
    });
    rotateLog(LOG_PATH, fs);
    const renames = fs.getRenameCalls();
    const oneToTwo = renames.find((r) => r.src === `${LOG_PATH}.1` && r.dest === `${LOG_PATH}.2`);
    assert.ok(oneToTwo, 'upv.log.1 must be shifted to upv.log.2');
  });

  test('shifts upv.log.2 → upv.log.3 when .2 exists and size exceeded', () => {
    const fs = makeMockFs({
      files: {
        [LOG_PATH]: { size: MAX_LOG_BYTES + 1 },
        [`${LOG_PATH}.2`]: { size: 100 },
      },
    });
    rotateLog(LOG_PATH, fs);
    const renames = fs.getRenameCalls();
    const twoToThree = renames.find((r) => r.src === `${LOG_PATH}.2` && r.dest === `${LOG_PATH}.3`);
    assert.ok(twoToThree, 'upv.log.2 must be shifted to upv.log.3');
  });

  test('full shift: .2→.3 happens BEFORE .1→.2 (order prevents overwrite)', () => {
    const fs = makeMockFs({
      files: {
        [LOG_PATH]: { size: MAX_LOG_BYTES + 1 },
        [`${LOG_PATH}.1`]: { size: 100 },
        [`${LOG_PATH}.2`]: { size: 100 },
      },
    });
    rotateLog(LOG_PATH, fs);
    const renames = fs.getRenameCalls();
    const idxTwoToThree = renames.findIndex(
      (r) => r.src === `${LOG_PATH}.2` && r.dest === `${LOG_PATH}.3`,
    );
    const idxOneToTwo = renames.findIndex(
      (r) => r.src === `${LOG_PATH}.1` && r.dest === `${LOG_PATH}.2`,
    );
    assert.ok(idxTwoToThree !== -1, 'rename .2→.3 must occur');
    assert.ok(idxOneToTwo !== -1, 'rename .1→.2 must occur');
    assert.ok(
      idxTwoToThree < idxOneToTwo,
      `.2→.3 must happen before .1→.2, got indices ${idxTwoToThree} vs ${idxOneToTwo}`,
    );
  });

  test('final rename is upv.log → upv.log.1', () => {
    const fs = makeMockFs({
      files: { [LOG_PATH]: { size: MAX_LOG_BYTES + 1 } },
    });
    rotateLog(LOG_PATH, fs);
    const renames = fs.getRenameCalls();
    const last = renames[renames.length - 1];
    assert.equal(last.src, LOG_PATH);
    assert.equal(last.dest, `${LOG_PATH}.1`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 10 – rotateLog – max archive enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe('rotateLog – max archive enforcement', () => {
  test('upv.log.3 is deleted before shifting .2→.3', () => {
    const fs = makeMockFs({
      files: {
        [LOG_PATH]: { size: MAX_LOG_BYTES + 1 },
        [`${LOG_PATH}.2`]: { size: 100 },
        [`${LOG_PATH}.3`]: { size: 100 },
      },
    });
    rotateLog(LOG_PATH, fs);
    const unlinks = fs.getUnlinkCalls();
    assert.ok(
      unlinks.includes(`${LOG_PATH}.3`),
      `expected ${LOG_PATH}.3 to be unlinked before rename`,
    );
  });

  test('does NOT create upv.log.4 (max archives = 3)', () => {
    const fs = makeMockFs({
      files: {
        [LOG_PATH]: { size: MAX_LOG_BYTES + 1 },
        [`${LOG_PATH}.1`]: { size: 100 },
        [`${LOG_PATH}.2`]: { size: 100 },
        [`${LOG_PATH}.3`]: { size: 100 },
      },
    });
    rotateLog(LOG_PATH, fs);
    const renames = fs.getRenameCalls();
    const toFour = renames.find((r) => r.dest === `${LOG_PATH}.4`);
    assert.equal(toFour, undefined, 'must never create upv.log.4');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 11 – rotateLog – graceful handling of fs failures
// ─────────────────────────────────────────────────────────────────────────────

describe('rotateLog – graceful fs failure handling', () => {
  test('does not throw when statSync throws', () => {
    const fs = makeMockFs({ throwOn: { statSync: true } });
    assert.doesNotThrow(() => rotateLog(LOG_PATH, fs));
  });

  test('does not throw when renameSync throws', () => {
    const fs = makeMockFs({
      files: { [LOG_PATH]: { size: MAX_LOG_BYTES + 1 } },
      throwOn: { renameSync: true },
    });
    assert.doesNotThrow(() => rotateLog(LOG_PATH, fs));
  });

  test('does not throw when unlinkSync throws', () => {
    const fs = makeMockFs({
      files: {
        [LOG_PATH]: { size: MAX_LOG_BYTES + 1 },
        [`${LOG_PATH}.1`]: { size: 100 },
      },
      throwOn: { unlinkSync: true },
    });
    assert.doesNotThrow(() => rotateLog(LOG_PATH, fs));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 12 – createRotatingLogger – rotation triggered via log()
// ─────────────────────────────────────────────────────────────────────────────

describe('createRotatingLogger – startup rotation via log()', () => {
  test('rotates on FIRST log() call (startup rotation)', () => {
    const logPath = path.join('/data', 'upv.log');
    const mockFs = makeMockFs({
      files: { [logPath]: { size: 100 } }, // small file – still rotated on startup
    });
    const logger = createRotatingLogger({ fs: mockFs, app: makeMockApp('/data') });
    logger.log('app', 'first entry', new Date());

    const renames = mockFs.getRenameCalls();
    const rotated = renames.find((r) => r.src === logPath && r.dest === `${logPath}.1`);
    assert.ok(rotated, 'log must be rotated on the first call regardless of size');
    assert.equal(mockFs.getCalls().length, 1, 'must still append after startup rotation');
  });

  test('does NOT rotate again on the SECOND log() call (startup only once)', () => {
    const logPath = path.join('/data', 'upv.log');
    const mockFs = makeMockFs({
      files: { [logPath]: { size: 100 } },
    });
    const logger = createRotatingLogger({ fs: mockFs, app: makeMockApp('/data') });
    logger.log('app', 'first entry', new Date());
    const renamesAfterFirst = mockFs.getRenameCalls().length;
    logger.log('app', 'second entry', new Date());
    const renamesAfterSecond = mockFs.getRenameCalls().length;
    assert.equal(
      renamesAfterFirst,
      renamesAfterSecond,
      'no additional rotation must occur on second log() call',
    );
  });

  test('startup rotation skipped when log file does not exist yet', () => {
    const logPath = path.join('/data', 'upv.log');
    const mockFs = makeMockFs({ files: {} }); // no existing log
    const logger = createRotatingLogger({ fs: mockFs, app: makeMockApp('/data') });
    assert.doesNotThrow(() => logger.log('app', 'first ever entry', new Date()));
    assert.equal(mockFs.getRenameCalls().length, 0, 'no rotation when no log exists yet');
    assert.equal(mockFs.getCalls().length, 1, 'must append even without prior rotation');
  });

  test('size-based rotation still triggers in the same session if log grows beyond MAX_LOG_BYTES', () => {
    const logPath = path.join('/data', 'upv.log');
    // Simulate: log doesn't exist initially (no startup rotation), then grows huge
    const mockFs = makeMockFs({ files: {} });
    const logger = createRotatingLogger({ fs: mockFs, app: makeMockApp('/data') });
    logger.log('app', 'first entry', new Date()); // startup rotation skipped (no file)

    // Now simulate log has grown beyond limit
    mockFs.getFiles()[logPath] = { size: MAX_LOG_BYTES + 1 };
    logger.log('app', 'second entry after growth', new Date());
    const renames = mockFs.getRenameCalls();
    const sizeRotation = renames.find((r) => r.src === logPath && r.dest === `${logPath}.1`);
    assert.ok(
      sizeRotation,
      'size-based rotation must still fire when file grows beyond MAX_LOG_BYTES',
    );
  });

  test('createLogger is a backward-compatible alias for createRotatingLogger', () => {
    assert.strictEqual(typeof createLogger, 'function');
    const a = createLogger({ fs: makeMockFs(), app: makeMockApp() });
    const b = createRotatingLogger({ fs: makeMockFs(), app: makeMockApp() });
    assert.equal(typeof a.log, typeof b.log);
    assert.equal(typeof a.getLogPath, typeof b.getLogPath);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 13 – rotateOnStartup
// ─────────────────────────────────────────────────────────────────────────────

describe('rotateOnStartup', () => {
  test('renames upv.log → upv.log.1 when file exists', () => {
    const fs = makeMockFs({ files: { [LOG_PATH]: { size: 50 } } });
    rotateOnStartup(LOG_PATH, fs);
    const renames = fs.getRenameCalls();
    const logToOne = renames.find((r) => r.src === LOG_PATH && r.dest === `${LOG_PATH}.1`);
    assert.ok(logToOne, 'upv.log must be rotated to upv.log.1 on startup');
  });

  test('does NOT rotate when file does not exist', () => {
    const fs = makeMockFs({ files: {} });
    rotateOnStartup(LOG_PATH, fs);
    assert.equal(fs.getRenameCalls().length, 0, 'no rotation when file is absent');
  });

  test('rotates even when file is very small (1 byte)', () => {
    const fs = makeMockFs({ files: { [LOG_PATH]: { size: 1 } } });
    rotateOnStartup(LOG_PATH, fs);
    const renames = fs.getRenameCalls();
    assert.ok(renames.length > 0, 'must rotate regardless of file size');
  });

  test('shifts existing archives (.1→.2, .2→.3) before moving current log', () => {
    const fs = makeMockFs({
      files: {
        [LOG_PATH]: { size: 50 },
        [`${LOG_PATH}.1`]: { size: 50 },
        [`${LOG_PATH}.2`]: { size: 50 },
      },
    });
    rotateOnStartup(LOG_PATH, fs);
    const renames = fs.getRenameCalls();
    const twoToThree = renames.find((r) => r.src === `${LOG_PATH}.2` && r.dest === `${LOG_PATH}.3`);
    const oneToTwo = renames.find((r) => r.src === `${LOG_PATH}.1` && r.dest === `${LOG_PATH}.2`);
    const logToOne = renames.find((r) => r.src === LOG_PATH && r.dest === `${LOG_PATH}.1`);
    assert.ok(twoToThree, '.2 must be shifted to .3');
    assert.ok(oneToTwo, '.1 must be shifted to .2');
    assert.ok(logToOne, 'log must be moved to .1');
  });

  test('shift order: .2→.3 before .1→.2 before log→.1', () => {
    const fs = makeMockFs({
      files: {
        [LOG_PATH]: { size: 50 },
        [`${LOG_PATH}.1`]: { size: 50 },
        [`${LOG_PATH}.2`]: { size: 50 },
      },
    });
    rotateOnStartup(LOG_PATH, fs);
    const renames = fs.getRenameCalls();
    const idx23 = renames.findIndex((r) => r.src === `${LOG_PATH}.2` && r.dest === `${LOG_PATH}.3`);
    const idx12 = renames.findIndex((r) => r.src === `${LOG_PATH}.1` && r.dest === `${LOG_PATH}.2`);
    const idx01 = renames.findIndex((r) => r.src === LOG_PATH && r.dest === `${LOG_PATH}.1`);
    assert.ok(idx23 < idx12, '.2→.3 must precede .1→.2');
    assert.ok(idx12 < idx01, '.1→.2 must precede log→.1');
  });

  test('does NOT create upv.log.4 (max archives = 3)', () => {
    const fs = makeMockFs({
      files: {
        [LOG_PATH]: { size: 50 },
        [`${LOG_PATH}.1`]: { size: 50 },
        [`${LOG_PATH}.2`]: { size: 50 },
        [`${LOG_PATH}.3`]: { size: 50 },
      },
    });
    rotateOnStartup(LOG_PATH, fs);
    const renames = fs.getRenameCalls();
    const toFour = renames.find((r) => r.dest === `${LOG_PATH}.4`);
    assert.equal(toFour, undefined, 'must never create upv.log.4');
  });

  test('deletes upv.log.3 before shifting .2→.3 (max archives enforced)', () => {
    const fs = makeMockFs({
      files: {
        [LOG_PATH]: { size: 50 },
        [`${LOG_PATH}.2`]: { size: 50 },
        [`${LOG_PATH}.3`]: { size: 50 },
      },
    });
    rotateOnStartup(LOG_PATH, fs);
    const unlinks = fs.getUnlinkCalls();
    assert.ok(unlinks.includes(`${LOG_PATH}.3`), 'upv.log.3 must be deleted before shifting .2→.3');
  });

  test('does not throw when statSync throws', () => {
    const fs = makeMockFs({ throwOn: { statSync: true } });
    assert.doesNotThrow(() => rotateOnStartup(LOG_PATH, fs));
  });

  test('does not throw when renameSync throws', () => {
    const fs = makeMockFs({
      files: { [LOG_PATH]: { size: 50 } },
      throwOn: { renameSync: true },
    });
    assert.doesNotThrow(() => rotateOnStartup(LOG_PATH, fs));
  });
});
