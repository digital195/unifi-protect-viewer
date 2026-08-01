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

module.exports = { normalizeMac, login, findViewerByMac, renameViewer, deleteViewer };
