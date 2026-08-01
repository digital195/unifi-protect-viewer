'use strict';

/**
 * @file assignment.js
 * @description Pure helpers for resolving a Viewport's assigned liveview from a
 * Protect bootstrap payload and building the render URL. No Electron/IO here.
 */

/** Finds the viewer object with the given name in a bootstrap payload. */
function findViewer(bootstrap, name) {
  const viewers = (bootstrap && bootstrap.viewers) || [];
  return viewers.find((v) => v && v.name === name) || null;
}

/**
 * Returns the viewer's assigned liveview id, or null if none/absent.
 * The bootstrap JSON exposes the assignment as `liveview`; `liveviewId` is
 * Protect's Postgres column name — accept both to be safe.
 */
function selectLiveviewId(bootstrap, name) {
  const viewer = findViewer(bootstrap, name);
  if (!viewer) return null;
  return viewer.liveview || viewer.liveviewId || null;
}

/** Builds the Protect dashboard URL for a liveview id, or null if no id. */
function liveviewUrl(baseUrl, liveviewId) {
  if (!liveviewId) return null;
  const origin = new URL(baseUrl).origin;
  return `${origin}/protect/dashboard/${liveviewId}`;
}

/** Liveview URL when assigned, otherwise the profile's base URL. */
function assignmentTargetUrl(baseUrl, liveviewId) {
  return liveviewUrl(baseUrl, liveviewId) || baseUrl;
}

module.exports = { findViewer, selectLiveviewId, liveviewUrl, assignmentTargetUrl };
