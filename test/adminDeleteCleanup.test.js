// Admin deletion must remove all user-owned records and invalidate sessions;
// the schema intentionally has no FK cascade for the legacy application
// tables, so this is an explicit regression test for the cleanup transaction.
process.env.ADMIN_TOKEN = 'delete-test-admin-token-1234567890123456789012';
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');
const adminRouter = require('../server/routes/admin');
const { issueToken } = require('../server/services/auth');
const { resolveToken } = require('../server/middleware/authMiddleware');

before(async () => {
  await db.ready;
});

function startAdminApp() {
  const app = express();
  app.use(express.json());
  app.use('/', adminRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('admin user deletion cleans owned records and kills active sessions', async () => {
  const result = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
    .run('admin-delete-cleanup@test.local');
  const userId = result.lastInsertRowid;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const { accessToken } = await issueToken(user);
  assert.ok(await resolveToken(accessToken));

  await db.prepare('INSERT INTO watchlist (user_id, symbol) VALUES (?, ?)').run(userId, 'AAPL');
  await db.prepare('INSERT INTO watchlist_alerts (user_id, symbol, min_ratio) VALUES (?, ?, ?)').run(userId, 'AAPL', 2);
  await db
    .prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)')
    .run(userId, 'https://push.example/delete', 'p', 'a');
  await db
    .prepare('INSERT INTO feedback (user_id, email, message) VALUES (?, ?, ?)')
    .run(userId, user.email, 'cleanup');
  await db
    .prepare("INSERT INTO scheduled_scans (user_id, scan_type, scan_time) VALUES (?, 'capitalFlow', '09:00')")
    .run(userId);
  await db.prepare('INSERT INTO notifications (user_id, title, body) VALUES (?, ?, ?)').run(userId, 'n', 'b');
  await db.prepare('INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)').run(userId, 'user', 'hello');
  await db
    .prepare('INSERT INTO ai_usage (usage_date, scope, user_id, calls) VALUES (?, ?, ?, ?)')
    .run('2099-01-01', 'capi', userId, 1);
  await db
    .prepare('INSERT INTO otp_codes (email, code, type, expires_at) VALUES (?, ?, ?, ?)')
    .run(user.email, '123456', 'verify_email', 4102444800);

  const server = await startAdminApp();
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/admin/api/users/${userId}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Token': process.env.ADMIN_TOKEN },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await resolveToken(accessToken), null);
    assert.strictEqual(await db.prepare('SELECT id FROM users WHERE id = ?').get(userId), undefined);
    for (const table of [
      'user_sessions',
      'watchlist',
      'watchlist_alerts',
      'push_subscriptions',
      'feedback',
      'scheduled_scans',
      'notifications',
      'chat_messages',
      'ai_usage',
    ]) {
      assert.strictEqual(
        await db.prepare(`SELECT 1 FROM ${table} WHERE user_id = ? LIMIT 1`).get(userId),
        undefined,
        table
      );
    }
    assert.strictEqual(await db.prepare('SELECT 1 FROM otp_codes WHERE email = ?').get(user.email), undefined);
  } finally {
    server.close();
  }
});
