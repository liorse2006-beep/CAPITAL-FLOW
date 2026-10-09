require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const db = require('../server/db');
const { issueToken } = require('../server/services/auth');
const router = require('../server/routes/notifications');
before(async () => {
  await db.ready;
});

async function owner(email) {
  const insert = await db.prepare("INSERT INTO users (email, tier, is_verified) VALUES (?, 'elite', 1)").run(email);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(insert.lastInsertRowid);
  return { id: user.id, token: (await issueToken(user)).accessToken };
}
async function getFeed(user) {
  const app = express();
  app.use('/api', router);
  const server = await new Promise((resolve) => {
    const handle = app.listen(0, '127.0.0.1', () => resolve(handle));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/notifications`, {
      headers: { Authorization: 'Bearer ' + user.token },
    });
    assert.equal(response.status, 200);
    return response.json();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('notification list and full unread count use one owner-scoped database statement', async (t) => {
  const user = await owner('feed-owner@test.local');
  const foreign = await owner('feed-foreign@test.local');
  const rows = Array.from({ length: 105 }, (_, index) => ({
    sql: 'INSERT INTO notifications (user_id, title, body, created_at) VALUES (?, ?, ?, ?)',
    args: [user.id, 'FIX-' + index, 'Synthetic feed', 1000 + index],
  }));
  rows.push({
    sql: 'INSERT INTO notifications (user_id, title, body) VALUES (?, ?, ?)',
    args: [foreign.id, 'FOREIGN', 'Must not leak'],
  });
  await db.transaction(rows);
  const prepare = db.prepare;
  const spy = t.mock.method(db, 'prepare', (...args) => prepare(...args));
  const data = await getFeed(user);
  assert.equal(data.notifications.length, 100);
  assert.equal(data.unreadCount, 105, 'the unread count must not be limited to the displayed hundred');
  assert.equal(data.notifications[0].title, 'FIX-104');
  assert.ok(data.notifications.every((row) => row.title !== 'FOREIGN' && !('unread_count' in row)));
  assert.equal(
    spy.mock.calls.filter((call) => /FROM notifications/i.test(call.arguments[0])).length,
    1,
    'one feed request must not multiply database queue occupancy'
  );
});

test('an empty owner feed returns an empty array and zero, never a null placeholder row', async () => {
  const user = await owner('feed-empty@test.local');
  assert.deepEqual(await getFeed(user), { notifications: [], unreadCount: 0 });
});

test('a read-only notification page retains its rows without inflating the unread count', async () => {
  const user = await owner('feed-read@test.local');
  await db
    .prepare('INSERT INTO notifications (user_id, title, body, is_read) VALUES (?, ?, ?, 1)')
    .run(user.id, 'READ', 'Synthetic read notification');
  const data = await getFeed(user);
  assert.equal(data.notifications.length, 1);
  assert.equal(data.notifications[0].title, 'READ');
  assert.equal(data.notifications[0].is_read, 1);
  assert.equal(data.unreadCount, 0);
});
