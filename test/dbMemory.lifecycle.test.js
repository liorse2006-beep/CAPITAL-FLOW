require('./helpers/testEnv');
process.env.TURSO_DB_URL = 'file::memory:';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db');
test('memory-mode callback transactions keep their schema and committed notifications', async () => {
  await db.ready;
  const user = await db
    .prepare("INSERT INTO users (email, tier) VALUES ('memory-transaction@test.local', 'elite')")
    .run();
  const notifications = require('../server/services/notifications');
  const id = await notifications.addNotification(user.lastInsertRowid, {
    title: 'test',
    body: 'test',
    pushPayload: {},
  });
  assert.equal((await notifications.getNotificationDetail(user.lastInsertRowid, id)).title, 'test');
  assert.ok(await db.prepare('SELECT notification_id FROM notification_outbox WHERE notification_id = ?').get(id));
});
