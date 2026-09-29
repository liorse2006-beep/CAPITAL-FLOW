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
const HEALTH_PROBE_TIMEOUT_MS = 2000;
let healthProbePromise = null;
let lastHealthyProbeAt = 0;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Database readiness probe timed out')), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function verifyDatabaseReadiness() {
  const now = Date.now();
  if (lastHealthyProbeAt && now - lastHealthyProbeAt < HEALTH_PROBE_TTL_MS) return Promise.resolve();
  if (healthProbePromise) return healthProbePromise;

  const probe = Promise.resolve(db.ready).then(() => db.prepare('SELECT 1').get());
  healthProbePromise = withTimeout(probe, HEALTH_PROBE_TIMEOUT_MS)
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

// Render and external uptime checks use /health to detect whether this process
// is alive. Keep it independent of the database so a provider outage does not
// make Render remove/restart an otherwise healthy application instance. The
// release workflow also reads releaseCommit from this response.
function sendLiveness(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    releaseCommit: RELEASE_COMMIT,
    timestamp: new Date().toISOString(),
  });
}
router.get('/health', sendLiveness);
router.get('/health/live', sendLiveness);

// Database readiness is only exposed through the token-protected internal
// probe below; no public endpoint reveals database availability.
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
