'use strict';

/**
 * @file mock-store.js
 * @description In-memory mock for electron-store.
 *
 * Behaves like a full electron-store instance with
 * get/set/has/delete/clear, but stores everything in RAM.
 */

class MockStore {
  constructor() {
    this._data = {};
  }

  get(key, defaultValue) {
    return key in this._data ? this._data[key] : defaultValue;
  }

  set(key, value) {
    this._data[key] = value;
  }

  has(key) {
    return key in this._data;
  }

  delete(key) {
    delete this._data[key];
  }

  clear() {
    this._data = {};
  }

  /** Helper: return full store contents (for assertions). */
  _dump() {
    return { ...this._data };
  }

  /** Helper: seed store with data directly (for test setup). */
  _seed(data) {
    this._data = { ...data };
  }
}

module.exports = MockStore;
