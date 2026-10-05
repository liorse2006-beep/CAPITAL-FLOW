require('./helpers/testEnv');
const { test, before, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db');
const scanner = require('../server/services/scanner');
const push = require('../server/services/webPush');
const runner = require('../server/services/scheduledScanRunner');
const notifications = require('../server/services/notifications');
before(async () => {
  await db.ready;
});
afterEach(async () => {
  await db.prepare('UPDATE scheduled_scans SET active = 0').run();
});
const snapshot = () => ({
  results: [{ symbol: 'AAPL', price: 100, quoteDataStatus: 'complete' }],
  processed: 2,
  errors: ['MSFT'],
  dataStatus: 'partial',
  dataAsOf: new Date().toISOString(),
});

async function schedule(name, overrides = {}) {
  const user = await db
    .prepare("INSERT INTO users (email, is_verified, tier) VALUES (?, 1, 'elite')")
    .run(`${name}@test.local`);
  const row = await db
    .prepare(
      "INSERT INTO scheduled_scans (user_id, scan_type, scan_time, scan_date, active) VALUES (?, 'capitalFlow', ?, ?, 1)"
    )
    .run(user.lastInsertRowid, overrides.time || '00:00', overrides.date || null);
  return { userId: user.lastInsertRowid, id: row.lastInsertRowid };
}

test('two independent cycle entrypoints create one durable occurrence and notification', async (t) => {
  const row = await schedule('scheduler-two-runners');
  const scan = t.mock.method(scanner, 'scanTickers', async () => snapshot());
  const sender = t.mock.method(push, 'sendPushToUser', async () => ({ configured: false }));
  await Promise.all([runner.runScheduledScansCycle(), runner.runScheduledScansCycle()]);
  assert.equal(scan.mock.callCount(), 1);
  assert.equal(sender.mock.callCount(), 1);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?').get(row.userId)).total,
    1
  );
  const ledger = await db
    .prepare('SELECT completed_at, notification_id FROM scheduled_scan_runs WHERE schedule_id = ?')
    .get(row.id);
  assert.ok(ledger.completed_at);
  assert.ok(ledger.notification_id);
});

test('one-time schedule overdue beyond the fire window catches up once after a restart', async (t) => {
  const row = await schedule('scheduler-overdue', { date: '2020-01-01', time: '23:59' });
  t.mock.method(scanner, 'scanTickers', async () => snapshot());
  const sender = t.mock.method(push, 'sendPushToUser', async () => ({ configured: false }));
  await runner.runScheduledScansCycle();
  await runner.runScheduledScansCycle();
  assert.equal(sender.mock.callCount(), 1);
  assert.equal((await db.prepare('SELECT active FROM scheduled_scans WHERE id = ?').get(row.id)).active, 0);
});

for (const phase of ['INSERT INTO notifications', 'DELETE FROM notifications']) {
  test(`failure during ${phase} rolls back completion and allows a later retry`, async (t) => {
    const row = await schedule(`scheduler-rollback-${phase.startsWith('INSERT') ? 'insert' : 'prune'}`, {
      date: '2020-01-01',
    });
    t.mock.method(scanner, 'scanTickers', async () => snapshot());
    const sender = t.mock.method(push, 'sendPushToUser', async () => ({ configured: false }));
    const original = db.transaction;
    let inject = true;
    t.mock.method(db, 'transaction', (callback) =>
      original((tx) =>
        callback({
          ...tx,
          prepare(sql) {
            if (inject && sql.includes(phase)) throw new Error('Synthetic notification storage failure');
            return tx.prepare(sql);
          },
        })
      )
    );
    await runner.runScheduledScansCycle();
    assert.equal(
      (await db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?').get(row.userId)).total,
      0
    );
    assert.equal((await db.prepare('SELECT active FROM scheduled_scans WHERE id = ?').get(row.id)).active, 1);
    assert.equal(
      (await db.prepare('SELECT completed_at FROM scheduled_scan_runs WHERE schedule_id = ?').get(row.id)).completed_at,
      null
    );
    assert.equal(sender.mock.callCount(), 0);
    inject = false;
    await runner.runScheduledScansCycle();
    assert.equal(
      (await db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?').get(row.userId)).total,
      1
    );
    assert.equal(sender.mock.callCount(), 1);
  });
}

test('expired pending lease is recovered but a completed occurrence cannot be reopened', async (t) => {
  const row = await schedule('scheduler-recovery');
  const key = `${row.id}:${runner.israelToday()}:00:00`;
  await db
    .prepare(
      'INSERT INTO scheduled_scan_runs (run_key, schedule_id, user_id, claim_token, lease_until) VALUES (?, ?, ?, ?, 0)'
    )
    .run(key, row.id, row.userId, 'abandoned-owner');
  t.mock.method(scanner, 'scanTickers', async () => snapshot());
  t.mock.method(push, 'sendPushToUser', async () => ({ configured: false }));
  await runner.runScheduledScansCycle();
  const record = await db.prepare('SELECT * FROM scheduled_scan_runs WHERE run_key = ?').get(key);
  assert.ok(record.completed_at);
  assert.notEqual(record.claim_token, 'abandoned-owner');
  await db.prepare('UPDATE scheduled_scans SET last_run_at = NULL WHERE id = ?').run(row.id);
  await runner.runScheduledScansCycle();
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?').get(row.userId)).total,
    1
  );
});

test('downgrade during provider wait prevents deferred notification persistence and push', async (t) => {
  const row = await schedule('scheduler-downgrade');
  t.mock.method(scanner, 'scanTickers', async () => {
    await db.prepare("UPDATE users SET tier = 'premium' WHERE id = ?").run(row.userId);
    return snapshot();
  });
  const sender = t.mock.method(push, 'sendPushToUser', async () => ({ configured: false }));
  await runner.runScheduledScansCycle();
  assert.equal(sender.mock.callCount(), 0);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?').get(row.userId)).total,
    0
  );
});

test('partial metadata and source timestamp survive persistence and detail retrieval', async (t) => {
  const row = await schedule('scheduler-metadata');
  const data = snapshot();
  t.mock.method(scanner, 'scanTickers', async () => data);
  t.mock.method(push, 'sendPushToUser', async () => ({ configured: false }));
  await runner.runScheduledScansCycle();
  const notification = await db.prepare('SELECT id FROM notifications WHERE user_id = ?').get(row.userId);
  const detail = await notifications.getNotificationDetail(row.userId, notification.id);
  assert.equal(detail.dataStatus, 'partial');
  assert.equal(detail.dataAsOf, data.dataAsOf);
  assert.equal(detail.results.length, 1);
  assert.equal(detail.body, 'New market signal detected. Open Capital Flow to view it.');
  assert.equal(await notifications.getNotificationDetail(row.userId + 100000, notification.id), undefined);
});
