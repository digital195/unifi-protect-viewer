'use strict';
/**
 * @file admin-api.js
 * @description Pinned Protect admin-API viewer operations (find/rename/delete),
 * reusing mint.js's httpJson (rejectUnauthorized:true + fingerprint pin — never
 * relaxed). Endpoints are the ONLY place in the app that knows the viewer REST
 * paths; verified against a live console.
 */
function origin(u) {
  return new URL(u).origin;
}
function normalizeMac(mac) {
  return String(mac || '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toUpperCase();
}

// UniFi OS requires an X-CSRF-Token header on state-changing requests (PATCH /
// DELETE / POST); a GET (bootstrap) does not. The token is carried inside the
// JWT `TOKEN` session cookie (`csrfToken` claim), so rename/delete derive it
// from the same cookie string they already receive — no extra round-trip, no
// signature change. Returns null if absent/unparseable (caller omits the
// header, preserving today's behavior on a non-UniFi-OS console). Verified
// against a live console (rename → HTTP 200 with header).
function csrfFromCookie(cookie) {
  const m = /(?:^|;\s*)TOKEN=([^;]+)/.exec(cookie || '');
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).csrfToken || null;
  } catch {
    return null;
  }
}
function csrfHeader(cookie) {
  const t = csrfFromCookie(cookie);
  return t ? { 'x-csrf-token': t } : {};
}

async function login(baseUrl, username, password, { httpJson, buildLoginRequest, dataDir }) {
  const res = await httpJson(buildLoginRequest(baseUrl, username, password), { dataDir });
  if (res.status !== 200) throw new Error(`login HTTP ${res.status}`);
  const cookie = (res.setCookie || []).map((c) => c.split(';')[0]).join('; ');
  return { cookie };
}

async function findViewerByMac(baseUrl, cookie, mac, { httpJson, dataDir }) {
  const res = await httpJson(
    { url: origin(baseUrl) + '/proxy/protect/api/bootstrap', method: 'GET' },
    { cookie, dataDir },
  );
  if (res.status !== 200) return null;
  let viewers = [];
  try {
    viewers = JSON.parse(res.body).viewers || [];
  } catch {
    return null;
  }
  const want = normalizeMac(mac);
  // Defensive (DELETE path): an empty/garbage MAC must never match a viewer
  // whose own mac is empty or missing — that would delete an unrelated device.
  if (!want) return null;
  return viewers.find((v) => v && normalizeMac(v.mac) === want) || null;
}

async function renameViewer(baseUrl, cookie, id, name, { httpJson, dataDir }) {
  const res = await httpJson(
    {
      url: origin(baseUrl) + '/proxy/protect/api/viewers/' + id,
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...csrfHeader(cookie) },
      body: JSON.stringify({ name }),
    },
    { cookie, dataDir },
  );
  return res.status === 200;
}

async function deleteViewer(baseUrl, cookie, id, { httpJson, dataDir }) {
  const res = await httpJson(
    {
      url: origin(baseUrl) + '/proxy/protect/api/viewers/' + id,
      method: 'DELETE',
      headers: { ...csrfHeader(cookie) },
    },
    { cookie, dataDir },
  );
  return res.status === 200 || res.status === 204;
}

// ── Account setting: "Show Shared Multiviews" ────────────────────────────────
// A viewport renders through a web session logged in as its admin account. If
// an assigned Live View is a SHARED/public multiview (owned elsewhere / global),
// Protect only shows it to an account that has "Show Shared Multiviews" enabled;
// otherwise /protect/dashboard/<id> silently falls back to "All Cameras". That
// toggle is a per-user server setting: `user.settings.web["liveview.includeGlobal"]`
// (note the literal dotted key). Verified live: GET/PATCH `/proxy/protect/api/users/self`,
// PATCH body `{settings:{web:{…,"liveview.includeGlobal":true}}}` + X-CSRF-Token → 200,
// and it MERGES (other settings.web keys survive), so we read-modify-write.

const INCLUDE_GLOBAL_KEY = 'liveview.includeGlobal';

/** GETs the authenticated user (`users/self`); null on non-200 / parse error. */
async function getSelf(baseUrl, cookie, { httpJson, dataDir }) {
  const res = await httpJson(
    { url: origin(baseUrl) + '/proxy/protect/api/users/self', method: 'GET' },
    { cookie, dataDir },
  );
  if (res.status !== 200) return null;
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

/**
 * Ensures the account's "Show Shared Multiviews" flag is on so shared/public
 * multiviews render instead of falling back to All Cameras. Read-modify-write:
 * PATCHes only when the flag isn't already true, preserving every other
 * settings.web key. Best-effort — never throws to the caller.
 * @returns {Promise<{ok:boolean, changed:boolean, reason?:string}>}
 *   reason: 'read' (couldn't read self) | 'patch' (PATCH rejected) | undefined (ok)
 */
async function ensureIncludeGlobal(baseUrl, cookie, { httpJson, dataDir }) {
  const self = await getSelf(baseUrl, cookie, { httpJson, dataDir });
  if (!self) return { ok: false, changed: false, reason: 'read' };
  const web = (self.settings && self.settings.web) || {};
  if (web[INCLUDE_GLOBAL_KEY] === true) return { ok: true, changed: false };
  // Preserve all existing settings (deep copy) and flip only the one flag.
  // Guard a non-object settings / settings.web (a malformed console response) so
  // this honours its "never throws" contract instead of crashing on a set.
  const src = self.settings && typeof self.settings === 'object' ? self.settings : {};
  const settings = JSON.parse(JSON.stringify(src));
  if (!settings.web || typeof settings.web !== 'object') settings.web = {};
  settings.web[INCLUDE_GLOBAL_KEY] = true;
  const res = await httpJson(
    {
      url: origin(baseUrl) + '/proxy/protect/api/users/self',
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...csrfHeader(cookie) },
      body: JSON.stringify({ settings }),
    },
    { cookie, dataDir },
  );
  return res.status === 200
    ? { ok: true, changed: true }
    : { ok: false, changed: true, reason: 'patch' };
}

module.exports = {
  normalizeMac,
  login,
  findViewerByMac,
  renameViewer,
  deleteViewer,
  getSelf,
  ensureIncludeGlobal,
};
