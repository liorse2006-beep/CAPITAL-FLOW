// Regression for the health-monitor fix: the old monitor.js was designed to
// run as a PM2 cron job, but the Docker entrypoint runs `node server.js`
// directly with no PM2 — so it never actually executed in production, and a
// real outage would never have emailed anyone. server/services/healthMonitor.js
// ports the same "3 consecutive failures → alert, then a recovery email"
// logic into an in-process setInterval instead.
process.env.PORT = '58734'; // fixed, unlikely-to-collide port this test's own /health server binds to
process.env.GMAIL_USER = 'monitor-test@test.local';
process.env.GMAIL_APP_PASSWORD = 'app-password-placeholder';
process.env.ADMIN_EMAIL = 'admin-alerts@test.local';

require('./helpers/testEnv');
const { test, before, after, mock } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const nodemailer = require('nodemailer');

const db = require('../server/db');
before(async () => {
  await db.ready;
});

const { checkHealth } = require('../server/services/healthMonitor');

// A controllable /health server on the exact port healthMonitor.js targets
// (built from process.env.PORT at module load time, above).
let healthApp, healthStatus;
before(async () => {
  healthStatus = 200;
  const app = express();
  app.get('/health', (req, res) => res.status(healthStatus).json({ status: healthStatus === 200 ? 'ok' : 'error' }));
  await new Promise((resolve) => {
    healthApp = app.listen(Number(process.env.PORT), resolve);
  });
});
after(() => healthApp && healthApp.close());

test('does not alert on a single transient failure (stays under the threshold)', async (t) => {
  const sendMail = mock.fn(async () => ({}));
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail }));

  healthStatus = 503;
  await new Promise((resolve) => {
    checkHealth();
    setTimeout(resolve, 50);
  });

  assert.strictEqual(sendMail.mock.callCount(), 0, 'one failure alone must not trigger an alert');
});

test('alerts exactly once after 3 consecutive failures, then sends a recovery email once healthy again', async (t) => {
  const sendMail = mock.fn(async () => ({}));
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail }));

  healthStatus = 503;
  // 2nd and 3rd consecutive failure (continuing the count from the previous
  // test, which already logged one) — cumulative threshold is 3.
  await new Promise((resolve) => {
    checkHealth();
    setTimeout(resolve, 50);
  });
  await new Promise((resolve) => {
    checkHealth();
    setTimeout(resolve, 50);
  });

  assert.strictEqual(sendMail.mock.callCount(), 1, 'must alert exactly once on crossing the threshold');
  assert.match(sendMail.mock.calls[0].arguments[0].subject, /SERVER DOWN/);

  // A further failure past the threshold must NOT re-alert (already alerted).
  await new Promise((resolve) => {
    checkHealth();
    setTimeout(resolve, 50);
  });
  assert.strictEqual(sendMail.mock.callCount(), 1, 'must not re-alert while already in the alerted state');

  // Recovery.
  healthStatus = 200;
  await new Promise((resolve) => {
    checkHealth();
    setTimeout(resolve, 50);
  });
  assert.strictEqual(sendMail.mock.callCount(), 2, 'must send exactly one recovery email once healthy again');
  assert.match(sendMail.mock.calls[1].arguments[0].subject, /recovered/i);

  // A subsequent healthy check must not send anything further.
  await new Promise((resolve) => {
    checkHealth();
    setTimeout(resolve, 50);
  });
  assert.strictEqual(sendMail.mock.callCount(), 2, 'a plain healthy check after recovery must stay silent');
});
