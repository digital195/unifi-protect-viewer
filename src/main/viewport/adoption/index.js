'use strict';

/**
 * @file index.js
 * @description AdoptionClient — wires identity + (optional) token mint + UCP
 * connection into one device-emulation lifecycle. IO is injectable so wiring is
 * unit-tested. Token minting happens ONLY for the initial adopt (creds present);
 * once the cert fingerprint is pinned server-side, reconnects are keyless — so
 * the admin password is used at most once and never persisted.
 *
 * `conn.url` (an `https://<host>` admin/console URL — a saved profile's URL)
 * serves TWO different endpoints that must NOT be conflated: `mintToken`
 * dials the admin API on :443, but the UCP `ds` device daemon that actually
 * accepts the connection lives on a different port, :7442. This is the ONE
 * chokepoint that derives the ds WS URL (`protocol.dsWsUrl`) and hands it to
 * the connection factory, while `mintToken` keeps receiving `conn.url`
 * untouched.
 */

const { EventEmitter } = require('node:events');
const { loadOrCreateIdentity } = require('./identity');
const { dsWsUrl } = require('./protocol');

class AdoptionClient extends EventEmitter {
  constructor() {
    super();
    this._conn = null;
    this._adopted = false;
    this._renameDone = false;
    this._cookie = null;
    this._renameCtx = null;
  }

  /**
   * @param {object} conn - { url, username?, password?, deviceName, dataDir,
   *   deviceInfoOpts?, mintToken?, connectionFactory?, adminApi?, loadIdentity? }.
   *   Keyless (no username/password) reconnects a pre-adopted, fingerprint-pinned
   *   viewer without minting a token. `adminApi`/`loadIdentity` are test seams
   *   overriding the real ./admin-api and ./identity modules.
   */
  async start(conn) {
    try {
      const loadIdentity = conn.loadIdentity || loadOrCreateIdentity;
      const identity = loadIdentity(conn.dataDir);
      let token = null;
      if (conn.username && conn.password) {
        const mint = conn.mintToken || require('./mint').mintToken;
        const minted = await mint({ ...conn, identity });
        token = minted.token;
        // Login session cookie, reused for the best-effort post-online rename.
        // Keyless reconnects never mint, so this stays null and rename skips.
        this._cookie = minted.cookie || null;
      }
      this._renameCtx = {
        url: conn.url, // admin https URL (:443) — NOT the derived :7442 ds URL
        name: conn.deviceName,
        dataDir: conn.dataDir,
        mac: identity.mac,
        adminApi: conn.adminApi || require('./admin-api'),
      };
      const factory = conn.connectionFactory || require('./mint').makeConnection;
      this._conn = factory({
        url: dsWsUrl(conn.url),
        identity,
        token,
        name: conn.deviceName,
        dataDir: conn.dataDir,
        deviceInfoOpts: { isAdopted: true, ...(conn.deviceInfoOpts || {}) },
      });
      this._conn.on('online', () => {
        this.emit('online', true);
        if (!this._adopted) {
          this._adopted = true;
          // viewerId is not carried on the UCP wire; surface a bare adopted signal.
          this.emit('adopted', { viewerId: null });
        }
        // Best-effort, fire-and-forget: _maybeRename catches its own errors;
        // the trailing catch only guards emit('error') itself throwing when no
        // listener is attached — a rename hiccup must never kill the process.
        this._maybeRename().catch(() => {});
      });
      this._conn.on('closed', () => this.emit('online', false));
      this._conn.on('assignment', (a) => this.emit('assignment', a));
      this._conn.on('error', (e) =>
        this.emit('error', {
          message: e && e.message ? e.message : String(e),
          fatal: !!(e && e.fatal),
        }),
      );
      await this._conn.open();
    } catch (e) {
      const message = e && e.message ? e.message : String(e);
      // Auth failures (bad admin password on a not-yet-adopted device) don't
      // self-heal — retrying the same creds forever just leaves the app stuck
      // on a dead login page. Mark them fatal so window.js's fatal → fallback
      // (or surface-to-config, when no fallback is configured) path fires.
      // mint.js's real error strings are `login HTTP <status>` and
      // `manage-payload HTTP <status>`; only 401/403 are auth-specific — a
      // network error (ECONNREFUSED, timeout) or a 5xx never matches and is
      // emitted non-fatal. But at this mint stage no AdoptionConnection exists
      // yet, so nothing here self-retries: recovery is only via window.js's
      // fallback grace window or an app relaunch.
      const authFailure = /\b(?:login|manage-payload) HTTP (?:401|403)\b/.test(message);
      this.emit('error', { message, fatal: authFailure });
    }
  }

  /**
   * Best-effort: after the adopt goes online, rename the server-side viewer
   * record to the configured deviceName. Only possible when this start() had
   * creds (a mint login cookie exists) — keyless reconnects skip. The name is
   * purely cosmetic, so ANY failure is emitted non-fatal and the next
   * creds-bearing launch simply retries; nothing here may break adoption.
   *
   * Runs at most once per session: `_renameDone` latches after SUCCESS (viewer
   * found AND its name already matched or the PATCH returned ok), so in-session
   * reconnect `online` events stop re-fetching the large bootstrap. It does NOT
   * latch when the viewer wasn't found yet (may appear on a later online), the
   * PATCH returned falsy, or the admin API threw — those all retry on the next
   * online. A fresh launch starts unlatched, preserving cross-launch self-heal.
   */
  async _maybeRename() {
    const ctx = this._renameCtx;
    if (this._renameDone || !ctx || !ctx.name || !this._cookie) return; // done, keyless reconnect (no cookie) or no name -> skip
    try {
      const dep = { httpJson: require('./mint').httpJson, dataDir: ctx.dataDir };
      const viewer = await ctx.adminApi.findViewerByMac(ctx.url, this._cookie, ctx.mac, dep);
      if (viewer) {
        if (viewer.name === ctx.name) {
          this._renameDone = true; // already correct — nothing left to do this session
        } else {
          const ok = await ctx.adminApi.renameViewer(
            ctx.url,
            this._cookie,
            viewer.id,
            ctx.name,
            dep,
          );
          this.emit('renamed', { ok, name: ctx.name });
          if (ok) this._renameDone = true; // falsy = transient failure -> retry next online
        }
      }
    } catch (e) {
      // non-fatal: name is cosmetic; next launch retries
      this.emit('error', { message: `rename skipped: ${e && e.message}`, fatal: false });
    }
  }

  stop() {
    if (this._conn) {
      this._conn.stop();
      this._conn = null;
    }
  }
}

module.exports = { AdoptionClient, AdoptionConnection: require('./connection').AdoptionConnection };
