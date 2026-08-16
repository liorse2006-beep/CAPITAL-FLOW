const assert = require('node:assert/strict');
const { test, after } = require('node:test');

require('./helpers/testEnv');
process.env.ADMIN_EMAIL = 'not-a-recipient';
process.env.STATUS_TARGET_URL = 'http://localhost:3001';
process.env.STATUS_INTERNAL_TOKEN = 'status-test-token';
process.env.STATUS_MONITOR_ENABLED = 'false';

const db = require('../server/db');
const { runStatusCycle } = require('../server/services/statusMonitor');

const originalFetch = global.fetch;
let healthFails = false;

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

global.fetch = async function (url) {
  const value = String(url);
  if (value.includes('query1.finance.yahoo.com')) {
    return jsonResponse(200, { chart: { result: [{ meta: { symbol: 'AAPL' } }] } });
  }
  if (value.endsWith('/health')) {
    return jsonResponse(
      healthFails ? 503 : 200,
      healthFails ? { status: 'error' } : { status: 'ok', db: { status: 'ok' } }
    );
  }
  if (value.endsWith('/api/auth/login') || value.endsWith('/api/news/AAPL'))
    return jsonResponse(401, { error: 'Unauthorized' });
  if (value.endsWith('/status/internal/market-data'))
    return jsonResponse(200, { ok: true, provider: 'test', sample: { symbol: 'AAPL' } });
  return new Response('<html><title>Capital Flow</title><body>Capital Flow</body></html>', { status: 200 });
};

async function clearStatusTables() {
  await db.ready;
  await db.prepare('DELETE FROM status_notification_deliveries').run();
  await db.prepare('DELETE FROM status_incident_updates').run();
  await db.prepare('DELETE FROM status_incidents').run();
  await db.prepare('DELETE FROM status_checks').run();
  await db.prepare('DELETE FROM status_maintenance').run();
  await db.prepare("UPDATE status_components SET enabled = CASE WHEN component_key = 'ssl' THEN 0 ELSE 1 END").run();
}

test('status monitor records checks, confirms an outage, and resolves it after recovery checks', async () => {
  await clearStatusTables();

  await runStatusCycle();
  let checks = await db.prepare('SELECT COUNT(*) AS count FROM status_checks WHERE final_result = 1').get();
  assert.ok(Number(checks.count) >= 7);
  let incidents = await db.prepare('SELECT * FROM status_incidents').all();
  assert.equal(incidents.length, 0);

  healthFails = true;
  await runStatusCycle();
  await runStatusCycle();
  incidents = await db.prepare("SELECT * FROM status_incidents WHERE component_key = 'backend'").all();
  assert.equal(incidents.length, 1);
  assert.notEqual(incidents[0].status, 'resolved');
  assert.ok(incidents[0].failure_count >= 2);

  healthFails = false;
  await runStatusCycle();
  incidents = await db.prepare("SELECT * FROM status_incidents WHERE component_key = 'backend'").all();
  assert.equal(incidents[0].status, 'monitoring');
  await runStatusCycle();
  incidents = await db.prepare("SELECT * FROM status_incidents WHERE component_key = 'backend'").all();
  assert.equal(incidents[0].status, 'resolved');
  assert.ok(Number(incidents[0].outage_seconds) >= 0);
});

after(() => {
  global.fetch = originalFetch;
});
