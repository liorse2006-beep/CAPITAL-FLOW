// Durable per-user notification history — backs the in-app bell so a push
// the user never actually saw (computer off, dismissed on the phone before
// reading it) is still there the next time they open the app.

const db = require('../db');

// Keeps the table from growing without bound for a very active watchlist —
// trimmed on every insert rather than a separate cron job.
const MAX_PER_USER = 200;

async function addNotification(userId, { symbol, title, body }) {
  await db
    .prepare('INSERT INTO notifications (user_id, symbol, title, body) VALUES (?, ?, ?, ?)')
    .run(userId, symbol || null, title, body);
  await db
    .prepare(
      `DELETE FROM notifications WHERE user_id = ? AND id NOT IN (
         SELECT id FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
       )`
    )
    .run(userId, userId, MAX_PER_USER);
}

async function getNotifications(userId, limit) {
  return db
    .prepare('SELECT id, symbol, title, body, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit || 100);
}

async function getUnreadCount(userId) {
  const row = await db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(userId);
  return row ? row.c : 0;
}

async function markAllRead(userId) {
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
}

async function removeNotification(userId, id) {
  await db.prepare('DELETE FROM notifications WHERE user_id = ? AND id = ?').run(userId, id);
}

async function clearAll(userId) {
  await db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
}

module.exports = { addNotification, getNotifications, getUnreadCount, markAllRead, removeNotification, clearAll };
