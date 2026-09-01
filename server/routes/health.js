const express = require('express');
const { reportError } = require('../utils/reportError');
const router = express.Router();
const db = require('../db');
const { STATUS_INTERNAL_TOKEN } = require('../config');

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
    await db.ready;
    await db.prepare('SELECT 1').get();
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
    await db.ready;
    await db.prepare('SELECT 1').get();
    return res.json({ status: 'ok', db: { status: 'ok' }, timestamp: new Date().toISOString() });
  } catch (err) {
    reportError(err, '[health database probe]');
    return res.status(503).json({ status: 'error', timestamp: new Date().toISOString() });
  }
});

module.exports = router;
