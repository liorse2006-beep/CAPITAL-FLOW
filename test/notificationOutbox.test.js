require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db');
const notifications = require('../server/services/notifications');
const webPush = require('../server/services/webPush');
const outbox = require('../server/services/notificationOutbox');
before(async () => {
  await db.ready;
});
const accepted = () => ({ configured: true, devices: 1, delivered: 1 });
async function pending(name) {
  const user = await db
    .prepare("INSERT INTO users (email, tier, is_verified) VALUES (?, 'elite', 1)")
    .run(name + '@test.local');
  const userId = Number(user.lastInsertRowid);
  const id = Number(
    await notifications.addNotification(userId, {
      title: 'Market Signal Detected',
      body: 'New market signal detected. Open Capital Flow to view it.',
      scanType: 'capitalFlow',
      results: [{ symbol: 'TEST', price: 10 }],
      pushPayload: { data: { url: '/scanner' } },
    })
  );
  return { id, userId };
}
test('a committed notification survives process-module restart before delivery', async (t) => {
  const row = await pending('outbox-restart');
  delete require.cache[require.resolve('../server/services/notificationOutbox')];
  const recovered = require('../server/services/notificationOutbox');
  const sender = t.mock.method(webPush, 'sendPushToUser', async () => accepted());
  await recovered.dispatchNotification(row.id);
  await recovered.dispatchNotification(row.id);
  assert.equal(sender.mock.callCount(), 1);
  assert.equal(sender.mock.calls[0].arguments[1].data.url, '/scanner?notif=srv-' + row.id);
  assert.equal(
    (await db.prepare('SELECT outcome FROM notification_outbox WHERE notification_id = ?').get(row.id)).outcome,
    'accepted'
  );
});
test('concurrent delivery claims cannot send the same occurrence three times', async (t) => {
  const row = await pending('outbox-race');
  const sender = t.mock.method(webPush, 'sendPushToUser', async () => accepted());
  await Promise.all([
    outbox.dispatchNotification(row.id),
    outbox.dispatchNotification(row.id),
    outbox.dispatchNotification(row.id),
  ]);
  assert.equal(sender.mock.callCount(), 1);
});
test('failed delivery is delayed and retries the identical stable notification', async (t) => {
  const row = await pending('outbox-retry');
  let fail = true;
  const sender = t.mock.method(webPush, 'sendPushToUser', async () => ({ ...accepted(), delivered: fail ? 0 : 1 }));
  await outbox.dispatchNotification(row.id);
  await outbox.dispatchNotification(row.id);
  assert.equal(sender.mock.callCount(), 1);
  let entry = await db.prepare('SELECT * FROM notification_outbox WHERE notification_id = ?').get(row.id);
  assert.equal(entry.finished_at, null);
  assert.ok(entry.next_attempt_at > Date.now() / 1000);
  fail = false;
  await db.prepare('UPDATE notification_outbox SET next_attempt_at = 0 WHERE notification_id = ?').run(row.id);
  await outbox.dispatchNotification(row.id);
  assert.equal(sender.mock.callCount(), 2);
  assert.deepEqual(sender.mock.calls[0].arguments, sender.mock.calls[1].arguments);
  assert.equal(sender.mock.calls[1].arguments[1].tag, 'capital-flow-notification-' + row.id);
  entry = await db.prepare('SELECT * FROM notification_outbox WHERE notification_id = ?').get(row.id);
  assert.equal(entry.attempts, 2);
  assert.equal(entry.outcome, 'accepted');
});
test('an abandoned worker lease is recovered without creating a second notification', async (t) => {
  const row = await pending('outbox-abandoned');
  await db
    .prepare(
      "UPDATE notification_outbox SET attempts = 1, claim_token = 'old-worker', lease_until = 1 WHERE notification_id = ?"
    )
    .run(row.id);
  const sender = t.mock.method(webPush, 'sendPushToUser', async () => accepted());
  await outbox.runNotificationOutboxCycle();
  assert.equal(sender.mock.callCount(), 1);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?').get(row.userId)).total,
    1
  );
});
test('blocked owners cannot receive recovered pushes', async (t) => {
  const row = await pending('outbox-blocked');
  await db.prepare('UPDATE users SET is_blocked = 1 WHERE id = ?').run(row.userId);
  const sender = t.mock.method(webPush, 'sendPushToUser', async () => accepted());
  await outbox.dispatchNotification(row.id);
  assert.equal(sender.mock.callCount(), 0);
  assert.equal(
    (await db.prepare('SELECT outcome FROM notification_outbox WHERE notification_id = ?').get(row.id)).outcome,
    'expired-or-revoked'
  );
});
test('outbox persistence failure rolls back the visible notification', async (t) => {
  const user = await db.prepare("INSERT INTO users (email, tier) VALUES ('outbox-atomic@test.local', 'elite')").run();
  const original = db.transaction;
  t.mock.method(db, 'transaction', (callback) =>
    original((tx) =>
      callback({
        ...tx,
        prepare(sql) {
          if (sql.includes('INSERT INTO notification_outbox')) throw new Error('Synthetic outbox storage failure');
          return tx.prepare(sql);
        },
      })
    )
  );
  await assert.rejects(
    notifications.addNotification(user.lastInsertRowid, { title: 'test', body: 'test', pushPayload: {} }),
    /Synthetic/
  );
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?').get(user.lastInsertRowid)).total,
    0
  );
});

test('history capacity rejects new work without erasing a committed unsent notification', async () => {
  const row = await pending('outbox-capacity');
  for (let index = 1; index < 200; index++)
    await notifications.addNotification(row.userId, { title: 'test', body: 'test', pushPayload: {} });
  await assert.rejects(notifications.addNotification(row.userId, { title: 'extra', body: 'extra', pushPayload: {} }), {
    code: 'WORK_QUEUE_BUSY',
  });
  assert.ok(
    await db
      .prepare('SELECT notification_id FROM notification_outbox WHERE notification_id = ? AND finished_at IS NULL')
      .get(row.id)
  );
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?').get(row.userId)).total,
    200
  );
});

test('outbox wake-up is emitted after commit and never for a rolled-back notification', async () => {
  const bus = require('../server/services/clusterBus');
  let wakeups = 0;
  const unsubscribe = bus.subscribe('notification-outbox', () => {
    wakeups++;
  });
  try {
    const user = await db
      .prepare("INSERT INTO users (email, tier) VALUES ('outbox-commit-wakeup@test.local', 'elite')")
      .run();
    await assert.rejects(
      db.transaction(async (tx) => {
        await notifications.addNotification(user.lastInsertRowid, { title: 'test', body: 'test', pushPayload: {} }, tx);
        assert.equal(wakeups, 0);
        throw new Error('Synthetic rollback');
      }),
      /Synthetic rollback/
    );
    assert.equal(wakeups, 0);
    await db.transaction(async (tx) => {
      await notifications.addNotification(user.lastInsertRowid, { title: 'test', body: 'test', pushPayload: {} }, tx);
      assert.equal(wakeups, 0);
    });
    assert.equal(wakeups, 1);
  } finally {
    unsubscribe();
  }
});
