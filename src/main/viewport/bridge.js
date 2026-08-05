'use strict';

/**
 * @file bridge.js
 * @description Polls Protect's bootstrap for this Viewport's assigned liveview
 * and emits change events. IO is injected (`fetchBootstrap`) so it is testable
 * without Electron. Used as the fallback when no dedicated device connection
 * (adoption) is configured.
 */

const { EventEmitter } = require('node:events');
const { selectLiveviewId } = require('./assignment');

const DEFAULT_INTERVAL_MS = 5000;

class ViewportBridge extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.name - the viewer device name to track
   * @param {() => Promise<object>} opts.fetchBootstrap - resolves the bootstrap JSON
   * @param {number} [opts.intervalMs]
   * @param {typeof setInterval} [opts.setInterval] - injectable for tests
   * @param {typeof clearInterval} [opts.clearInterval] - injectable for tests
   */
  constructor({
    name,
    fetchBootstrap,
    intervalMs = DEFAULT_INTERVAL_MS,
    setInterval: si = setInterval,
    clearInterval: ci = clearInterval,
  }) {
    super();
    this._name = name;
    this._fetchBootstrap = fetchBootstrap;
    this._intervalMs = intervalMs;
    this._setInterval = si;
    this._clearInterval = ci;
    this._timer = null;
    this._lastLiveviewId = undefined; // undefined = nothing emitted yet
  }

  start() {
    if (this._timer) return;
    this._poll();
    this._timer = this._setInterval(() => this._poll(), this._intervalMs);
  }

  stop() {
    if (this._timer) {
      this._clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _poll() {
    try {
      const bootstrap = await this._fetchBootstrap();
      const liveviewId = selectLiveviewId(bootstrap, this._name);
      this.emit('status', { ok: true, error: null });
      if (liveviewId !== this._lastLiveviewId) {
        this._lastLiveviewId = liveviewId;
        this.emit('assignment', liveviewId);
      }
    } catch (err) {
      this.emit('status', { ok: false, error: err && err.message ? err.message : String(err) });
    }
  }
}

module.exports = { ViewportBridge };
