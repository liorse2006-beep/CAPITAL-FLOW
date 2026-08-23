'use strict';

// Independent status host entrypoint.
//
// This process intentionally boots only the status router, its status store,
// and the monitoring worker. It never imports the main application server or
// frontend. In production, STATUS_TURSO_DB_URL is required so a failure or
// redeploy of the main application's database cannot take status storage down
// with it.
const path = require('path');

if (process.env.NODE_ENV === 'production') {
  const statusDbUrl = String(process.env.STATUS_TURSO_DB_URL || '').trim();
  const statusDbAuthToken = String(process.env.STATUS_TURSO_AUTH_TOKEN || '').trim();
  if (!statusDbUrl) {
    console.error('[status-service] STATUS_TURSO_DB_URL is required in production.');
    process.exit(1);
  }
  if (!statusDbAuthToken) {
    console.error('[status-service] STATUS_TURSO_AUTH_TOKEN is required in production.');
    process.exit(1);
  }
  if (!process.env.STATUS_INTERNAL_TOKEN || process.env.STATUS_INTERNAL_TOKEN.trim().length < 32) {
    console.error(
      '[status-service] STATUS_INTERNAL_TOKEN (the same strong value used by the main app) is required in production.'
    );
    process.exit(1);
  }
  process.env.TURSO_DB_URL = statusDbUrl;
  process.env.TURSO_AUTH_TOKEN = statusDbAuthToken;
}

// The independent status host must never try to authenticate against the
// application's user/session database. Its status operations console uses
// only the separately configured static status-admin credential; the full
// user-admin page remains on the main application.
process.env.INDEPENDENT_STATUS_SERVICE = 'true';

const express = require('express');
const helmet = require('helmet');
const db = require('./server/db');
const statusRouter = require('./server/routes/status');
const {
  getHeartbeatHealth,
  getMeta,
  startStatusMonitor,
  startStatusWatchdog,
} = require('./server/services/statusMonitor');
const { startScheduledStatusBackup } = require('./server/services/statusDbBackup');
const { PORT } = require('./server/config');
const { safeErrorSummary } = require('./server/utils/reportError');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '1h' }));

app.get('/', (_req, res) => res.redirect('/status'));

app.get('/health', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await db.prepare('SELECT 1').get();
    const heartbeat = getHeartbeatHealth(await getMeta());
    if (!heartbeat.healthy) {
      return res.status(503).json({
        status: 'error',
        service: 'status',
        heartbeat: { status: heartbeat.status, ageSeconds: heartbeat.ageSeconds },
        timestamp: new Date().toISOString(),
      });
    }
    res.json({ status: 'ok', service: 'status', heartbeat: heartbeat.status, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[status-service] health failure:', safeErrorSummary(err));
    res.status(503).json({ status: 'error', service: 'status' });
  }
});

app.use('/', statusRouter);

db.ready
  .then(() => {
    startStatusMonitor();
    startStatusWatchdog();
    startScheduledStatusBackup();
    app.listen(PORT, () => {
      console.log(`Independent status service running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[status-service] database initialization failed:', safeErrorSummary(err));
    process.exit(1);
  });

module.exports = app;
