const express = require('express');
const { reportError } = require('../utils/reportError');
const router = express.Router();
const db = require('../db');
const { STATUS_INTERNAL_TOKEN } = require('../config');

// Health checks are called by Render, the independent status service, and
// external keep-alive monitors. A burst of identical probes must not occupy
// the entire database pool and make the real application appear down. Keep
// the probe fail-closed, but coalesce concurrent checks and reuse a successful
// result only for a very short freshness window.
const HEALTH_PROBE_TTL_MS = 1000;
let healthProbePromise = null;
let lastHealthyProbeAt = 0;

function verifyDatabaseReadiness() {
  const now = Date.now();
  if (lastHealthyProbeAt && now - lastHealthyProbeAt < HEALTH_PROBE_TTL_MS) return Promise.resolve();
  if (healthProbePromise) return healthProbePromise;

  healthProbePromise = Promise.resolve(db.ready)
    .then(() => db.prepare('SELECT 1').get())
    .then(() => {
      lastHealthyProbeAt = Date.now();
    })
    .finally(() => {
      healthProbePromise = null;
    });

  return healthProbePromise;
}

// Render exposes the exact source commit at runtime. Returning this public,
// non-secret identifier lets the release workflow prove that the domain is
// serving the commit that passed CI instead of merely accepting a deploy hook.
// Local and non-Render environments deliberately report "unknown".
const RELEASE_COMMIT_CANDIDATE = String(process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || '').trim();
const RELEASE_COMMIT = /^[0-9a-f]{40}$/i.test(RELEASE_COMMIT_CANDIDATE) ? RELEASE_COMMIT_CANDIDATE : 'unknown';

function hasValidStatusToken(req) {
  return Boolean(STATUS_INTERNAL_TOKEN) && req.get('x-status-check-token') === STATUS_INTERNAL_TOKEN;
}

router.get('/health', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    // A database connection alone is not enough for readiness: schema
    // migrations and the one-active-Radar invariant must have completed before
    // the platform starts routing traffic to this process.
    await verifyDatabaseReadiness();
    res.json({
      status: 'ok',
      releaseCommit: RELEASE_COMMIT,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    reportError(err, '[health]');
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
    });
  }
});

router.get('/status/internal/database', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!hasValidStatusToken(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await verifyDatabaseReadiness();
    return res.json({ status: 'ok', db: { status: 'ok' }, timestamp: new Date().toISOString() });
  } catch (err) {
    reportError(err, '[health database probe]');
    return res.status(503).json({ status: 'error', timestamp: new Date().toISOString() });
  }
});

module.exports = router;
