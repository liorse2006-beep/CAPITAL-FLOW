require('./helpers/testEnv');
const { test, before, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db');
const radar = require('../server/services/radar');
const scanner = require('../server/services/scanner');
const maScanner = require('../server/services/maScanner');
const push = require('../server/services/webPush');
const runner = require('../server/services/scheduledScanRunner');
before(async () => {
  await db.ready;
});
afterEach(async () => {
  await db.prepare('UPDATE capital_flow_radars SET active = 0').run();
});
const row = {
  symbol: 'AAPL',
  price: 190,
  volume: 4e6,
  avgVolume: 2e6,
  volumeRatio: 2,
  marketCap: 2e12,
  sector: 'Technology',
  maValue: 185,
  maDistance: 2,
  maDirection: 'above',
  maPeriod: 20,
  maInterval: '1d',
};
async function fixture(name, t) {
  const created = await db
    .prepare("INSERT INTO users (email, tier, is_verified) VALUES (?, 'elite', 1)")
    .run(name + '@test.local');
  const userId = Number(created.lastInsertRowid);
  const expiresOn = runner.israelToday(new Date(Date.now() + 7 * 86400000));
  const recipe = await radar.createRadar(userId, { name, mode: 'all', scheduleTime1: '11:00', expiresOn });
  const current = new Date();
  const now = new Date(current.getTime() + ((660 - runner.israelNowMinutes(current) + 1440) % 1440) * 60000);
  const scan = t.mock.method(scanner, 'scanTickers', async () => ({
    results: [row],
    errors: [],
    checkedSymbols: ['AAPL'],
    dataStatus: 'complete',
    dataAsOf: new Date().toISOString(),
  }));
  t.mock.method(maScanner, 'scanMA', async () => ({
    results: [{ ...row, dataQuality: 'complete' }],
    errors: [],
    checkedSymbols: ['AAPL'],
    dataStatus: 'complete',
    dataAsOf: new Date().toISOString(),
  }));
  const sender = t.mock.method(push, 'sendPushToUser', async () => ({ configured: false, devices: 0 }));
  return { userId, recipe, now, scan, sender };
}
test('Radar outbox write failure leaves a failed, retryable occurrence rather than a completed empty run', async (t) => {
  const f = await fixture('radar-outbox-rollback', t);
  const original = db.transaction;
  let fail = true;
  t.mock.method(db, 'transaction', (callback) =>
    original(
      typeof callback === 'function'
        ? (tx) =>
            callback({
              ...tx,
              prepare(sql) {
                if (fail && sql.includes('INSERT INTO notification_outbox'))
                  throw new Error('Synthetic outbox failure');
                return tx.prepare(sql);
              },
            })
        : callback
    )
  );
  await runner.runRadarScheduledScans(f.now, { ignoreMarketHours: true });
  let occurrence = await db.prepare('SELECT status FROM radar_schedule_runs WHERE radar_id = ?').get(f.recipe.id);
  assert.equal(occurrence.status, 'failed');
  assert.equal(f.sender.mock.callCount(), 0);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?').get(f.userId)).total,
    0
  );
  fail = false;
  await runner.runRadarScheduledScans(new Date(f.now.getTime() + 4 * 60000), { ignoreMarketHours: true });
  occurrence = await db.prepare('SELECT status, attempts FROM radar_schedule_runs WHERE radar_id = ?').get(f.recipe.id);
  assert.equal(occurrence.status, 'completed');
  assert.equal(occurrence.attempts, 2);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?').get(f.userId)).total,
    1
  );
});
test('a recipe edited during provider work cannot publish the obsolete schedule', async (t) => {
  const f = await fixture('radar-edited-during-scan', t);
  f.scan.mock.mockImplementation(async () => {
    await radar.updateRadar(f.userId, f.recipe.id, { scheduleTime1: '12:00' });
    return { results: [row], errors: [], checkedSymbols: ['AAPL'], dataStatus: 'complete' };
  });
  await runner.runRadarScheduledScans(f.now, { ignoreMarketHours: true });
  assert.equal(f.sender.mock.callCount(), 0);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?').get(f.userId)).total,
    0
  );
  assert.notEqual(
    (await db.prepare('SELECT status FROM radar_schedule_runs WHERE radar_id = ?').get(f.recipe.id)).status,
    'completed'
  );
});
test('a stale failure token cannot overwrite newer successful Radar metadata', async (t) => {
  const f = await fixture('radar-stale-failure', t);
  const date = runner.israelToday(f.now);
  await db
    .prepare(
      "INSERT INTO radar_schedule_runs (radar_id, run_date, scheduled_time, claim_token, lease_until) VALUES (?, ?, '11:00', 'current-worker', ?)"
    )
    .run(f.recipe.id, date, Math.floor(Date.now() / 1000) + 120);
  await db
    .prepare(
      "UPDATE capital_flow_radars SET last_data_status = 'complete', last_scan_run_id = 'newer-scan', last_data_as_of = ? WHERE id = ?"
    )
    .run(new Date().toISOString(), f.recipe.id);
  await radar.processRadarScan([], new Date().toISOString(), {
    radarIds: [f.recipe.id],
    dataStatus: 'unavailable',
    runClaims: { [f.recipe.id]: { runDate: date, scheduledTime: '11:00', claimToken: 'obsolete-worker' } },
  });
  const current = await radar.getRadarRowForUser(f.userId, f.recipe.id);
  assert.equal(current.last_data_status, 'complete');
  assert.equal(current.last_scan_run_id, 'newer-scan');
});
test('a downgraded owner causes no Radar provider work or new claims', async (t) => {
  const f = await fixture('radar-ineligible-before-scan', t);
  await db.prepare("UPDATE users SET tier = 'premium' WHERE id = ?").run(f.userId);
  await runner.runRadarScheduledScans(f.now, { ignoreMarketHours: true });
  assert.equal(f.scan.mock.callCount(), 0);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS total FROM radar_schedule_runs WHERE radar_id = ?').get(f.recipe.id)).total,
    0
  );
});
