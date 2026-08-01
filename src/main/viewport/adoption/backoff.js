'use strict';

/** Exponential reconnect backoff, capped. @returns {number} ms */
function nextBackoffMs(attempt, { baseMs = 1000, maxMs = 10000 } = {}) {
  return Math.min(maxMs, baseMs * 2 ** attempt);
}

module.exports = { nextBackoffMs };
