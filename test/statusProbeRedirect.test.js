const assert = require('node:assert/strict');
const http = require('node:http');
const { after, test } = require('node:test');

require('./helpers/testEnv');
process.env.ADMIN_EMAIL = 'not-a-recipient';
process.env.STATUS_ALERT_RECIPIENTS = '';
process.env.RESEND_API_KEY = '';
process.env.GMAIL_USER = '';
process.env.GMAIL_APP_PASSWORD = '';
process.env.STATUS_MONITOR_ENABLED = 'false';
process.env.STATUS_INTERNAL_TOKEN = 'isolated-probe-token-not-a-real-secret';

const originalFetch = global.fetch;
let origin;
let sink;
let db;
let runStatusCycle;
let redirectStatus = 302;
let originHeaders = [];
let sinkHeaders = [];

async function setup() {
  if (origin) return;
  sink = http.createServer((req, res) => {
    sinkHeaders.push(req.headers);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', db: { status: 'ok' } }));
  });
  await new Promise((resolve) => sink.listen(0, '127.0.0.1', resolve));
  origin = http.createServer((req, res) => {
    originHeaders.push(req.headers);
    if (redirectStatus) {
      res.writeHead(redirectStatus, { Location: `http://127.0.0.1:${sink.address().port}/collect` });
      res.end();
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', db: { status: 'ok' } }));
    }
  });
  await new Promise((resolve) => origin.listen(0, '127.0.0.1', resolve));
  process.env.STATUS_TARGET_URL = `http://127.0.0.1:${origin.address().port}`;
  global.fetch = (input, options) => {
    assert.equal(new URL(String(input)).hostname, '127.0.0.1', 'only loopback fixtures are allowed');
    return originalFetch(input, options);
  };
  db = require('../server/db');
  ({ runStatusCycle } = require('../server/services/statusMonitor'));
  await db.ready;
}

async function checkOnly(key) {
  await setup();
  originHeaders = [];
  sinkHeaders = [];
  await db.prepare('UPDATE status_components SET enabled = CASE WHEN component_key = ? THEN 1 ELSE 0 END').run(key);
  const cycle = await runStatusCycle();
  assert.equal(cycle.results.length, 1);
  return cycle.results[0].final;
}

for (const status of [301, 302, 303, 307, 308]) {
  test(`protected monitor rejects HTTP ${status} without forwarding its credential`, async () => {
    redirectStatus = status;
    const result = await checkOnly('database');
    assert.equal(result.success, false);
    assert.equal(result.statusCode, status);
    assert.equal(originHeaders.length, 2, 'both bounded attempts stay at the configured origin');
    assert.ok(originHeaders.every((headers) => headers['x-status-check-token'] === process.env.STATUS_INTERNAL_TOKEN));
    assert.equal(sinkHeaders.length, 0, 'the redirected server never receives a request');
  });
}

test('protected monitor still accepts a valid direct response', async () => {
  redirectStatus = null;
  const result = await checkOnly('database');
  assert.equal(result.success, true);
  assert.equal(originHeaders.length, 1);
  assert.equal(sinkHeaders.length, 0);
});

test('ordinary public health checks can follow redirects without a probe credential', async () => {
  redirectStatus = 302;
  const result = await checkOnly('backend');
  assert.equal(result.success, true);
  assert.equal(originHeaders.length, 1);
  assert.equal(sinkHeaders.length, 1);
  assert.equal(originHeaders[0]['x-status-check-token'], undefined);
  assert.equal(sinkHeaders[0]['x-status-check-token'], undefined);
});

after(async () => {
  global.fetch = originalFetch;
  if (db) await db.close();
  await Promise.all([origin, sink].filter(Boolean).map((server) => new Promise((resolve) => server.close(resolve))));
});
