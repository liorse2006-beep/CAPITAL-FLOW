const assert = require('node:assert/strict');
const { test, after } = require('node:test');

require('./helpers/testEnv');
process.env.ADMIN_EMAIL = 'not-a-recipient';
process.env.STATUS_TARGET_URL = 'http://localhost:3001';
process.env.STATUS_INTERNAL_TOKEN = 'status-test-token-which-is-long-enough';
process.env.STATUS_MONITOR_ENABLED = 'false';

const db = require('../server/db');
const {
  getHeartbeatHealth,
  pruneStatusData,
  runHeartbeatWatchdog,
  runStatusCycle,
  shouldEmailIncident,
} = require('../server/services/statusMonitor');

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
  if (value.endsWith('/status/internal/database')) {
    return jsonResponse(
      healthFails ? 503 : 200,
      healthFails ? { status: 'error' } : { status: 'ok', db: { status: 'ok' } }
    );
  }
  if (value.endsWith('/health'))
    return jsonResponse(healthFails ? 503 : 200, healthFails ? { status: 'error' } : { status: 'ok' });
  if (value.endsWith('/api/auth/login')) return jsonResponse(401, { error: 'Unauthorized' });
  if (value.endsWith('/status/internal/market-data'))
    return jsonResponse(200, { ok: true, provider: 'test', sample: { symbol: 'AAPL' } });
  if (value.endsWith('/status/internal/news-data'))
    return jsonResponse(200, { ok: true, provider: 'test', sample: { symbol: 'AAPL', articleCount: 1 } });
  return new Response('<html><title>Capital Flow</title><body>Capital Flow</body></html>', { status: 200 });
};

async function clearStatusTables() {
  await db.ready;
  await db.prepare('DELETE FROM status_notification_deliveries').run();
  await db.prepare('DELETE FROM status_incident_updates').run();
  await db.prepare('DELETE FROM status_incidents').run();
  await db.prepare('DELETE FROM status_checks').run();
  await db.prepare('DELETE FROM status_daily_rollups').run();
  await db.prepare('DELETE FROM status_maintenance').run();
  await db.prepare("UPDATE status_components SET enabled = CASE WHEN component_key = 'ssl' THEN 0 ELSE 1 END").run();
}

test('status email policy alerts only for user-impacting components', () => {
  assert.equal(shouldEmailIncident({ key: 'yahoo', group: 'External dependencies', emailOnIncident: false }), false);
  assert.equal(shouldEmailIncident({ key: 'market-data', group: 'Critical functionality' }), true);
  assert.equal(shouldEmailIncident({ key: 'website', group: 'Core platform' }), true);
});

test('status monitor sends the shared probe token only to protected probes', async () => {
  const headers = [];
  const original = global.fetch;
  global.fetch = async (_url, options) => {
    headers.push(options?.headers || {});
    return jsonResponse(200, { status: 'ok', db: { status: 'ok' } });
  };
  try {
    await runStatusCycle();
    assert.ok(
      headers.some((value) => value['x-status-check-token']),
      'protected database probe receives token'
    );
    assert.ok(
      headers.some((value) => !value['x-status-check-token']),
      'ordinary public checks never receive token'
    );
  } finally {
    global.fetch = original;
  }
});

test('status heartbeat reports fresh, starting, and stale worker states', () => {
  const current = Math.floor(Date.now() / 1000);
  const fresh = getHeartbeatHealth({ last_cycle_at: current, last_cycle_status: 'success' });
  assert.equal(fresh.healthy, true);
  assert.equal(fresh.status, 'success');
  assert.equal(fresh.lastCycleAt, current);

  const starting = getHeartbeatHealth({});
  assert.equal(starting.healthy, true);
  assert.equal(starting.status, 'starting');

  const stale = getHeartbeatHealth({
    last_cycle_at: current - 3600,
    last_cycle_status: 'success',
  });
  assert.equal(stale.healthy, false);
  assert.equal(stale.status, 'stale');
  assert.match(stale.reason, /expected interval/i);

  const failed = getHeartbeatHealth({
    last_cycle_at: current,
    last_cycle_status: 'error',
    last_cycle_error: 'cycle failed',
  });
  assert.equal(failed.healthy, false);
  assert.equal(failed.status, 'stale');
  assert.equal(failed.reason, 'cycle failed');
});

test('heartbeat watchdog is safely disabled when the monitor is disabled', async () => {
  const result = await runHeartbeatWatchdog();
  assert.deepEqual(result, { healthy: true, status: 'disabled' });
});

test('raw status checks are converted into durable daily rollups before retention pruning', async () => {
  await clearStatusTables();
  const oldTimestamp = Math.floor(Date.now() / 1000) - 200 * 86400;
  await db
    .prepare(
      `INSERT INTO status_checks
       (cycle_id, component_key, checked_at, attempt, endpoint, check_type, success, state, final_result)
       VALUES (?, 'website', ?, 1, '/', 'http-content', 1, 'operational', 1)`
    )
    .run('retention-rollup-test', oldTimestamp);

  await pruneStatusData();
  const raw = await db
    .prepare("SELECT COUNT(*) AS count FROM status_checks WHERE cycle_id = 'retention-rollup-test'")
    .get();
  const rollup = await db
    .prepare("SELECT * FROM status_daily_rollups WHERE day = date(?, 'unixepoch') AND component_key = 'website'")
    .get(oldTimestamp);
  assert.equal(Number(raw.count), 0);
  assert.equal(Number(rollup.total_checks), 1);
  assert.equal(Number(rollup.successful_checks), 1);
});

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
