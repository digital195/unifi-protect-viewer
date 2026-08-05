'use strict';

/**
 * @file token.js
 * @description Pure request shaping + parsing for minting the adoption token.
 * Flow (wired in index.js): POST /api/auth/login (admin creds) → session cookie
 * → GET /proxy/protect/api/cameras/manage-payload → mgmt.token (60-min TTL).
 */

/** Builds the UniFi OS login request descriptor. */
function buildLoginRequest(baseUrl, username, password) {
  const origin = new URL(baseUrl).origin;
  return {
    url: `${origin}/api/auth/login`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, rememberMe: false }),
  };
}

/** The Protect manage-payload endpoint that returns the adoption token. */
function managePayloadUrl(baseUrl) {
  return `${new URL(baseUrl).origin}/proxy/protect/api/cameras/manage-payload`;
}

/** Extracts the adoption token from the manage-payload response. */
function parseTokenResponse(json) {
  const token = json && json.mgmt && json.mgmt.token;
  if (!token) throw new Error('manage-payload response missing mgmt.token');
  return token;
}

module.exports = { buildLoginRequest, managePayloadUrl, parseTokenResponse };
