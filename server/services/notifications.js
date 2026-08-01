// Durable per-user notification history — backs the in-app bell so a push
// the user never actually saw (computer off, dismissed on the phone before
// reading it) is still there the next time they open the app.

const db = require('../db');

// Keeps the table from growing without bound for a very active watchlist —
// trimmed on every insert rather than a separate cron job.
const MAX_PER_USER = 200;

// A scheduled scan's own results can run into the hundreds — cap what gets
// stored per notification so one busy scan can't bloat the row (and the
// results view is meant to be a quick glance, not a full re-scan anyway).
const MAX_RESULTS_STORED = 50;

/** Returns the new notification's id, so a caller (scheduled scans) can build
 * a "show me exactly this run" deep link into the push payload. */
async function addNotification(userId, { symbol, title, body, scanType, results }) {
  const resultsJson =
    Array.isArray(results) && results.length > 0 ? JSON.stringify(results.slice(0, MAX_RESULTS_STORED)) : null;
  const res = await db
    .prepare('INSERT INTO notifications (user_id, symbol, title, body, scan_type, results_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, symbol || null, title, body, scanType || null, resultsJson);
  await db
    .prepare(
      `DELETE FROM notifications WHERE user_id = ? AND id NOT IN (
         SELECT id FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
       )`
    )
    .run(userId, userId, MAX_PER_USER);
  return res.lastInsertRowid;
}

async function getNotifications(userId, limit) {
  return db
    .prepare('SELECT id, symbol, title, body, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit || 100);
}

/** One notification's full detail, including its scan results if it has any
 * — scoped to the owning user, and marks it read since opening it is the
 * clearest possible "I saw this" signal. Returns undefined if it doesn't
 * exist or belongs to someone else. */
async function getNotificationDetail(userId, id) {
  const row = await db
    .prepare('SELECT id, symbol, title, body, scan_type, results_json, created_at FROM notifications WHERE user_id = ? AND id = ?')
    .get(userId, id);
  if (!row) return undefined;
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id = ?').run(userId, id);
  let results = null;
  if (row.results_json) {
    try {
      results = JSON.parse(row.results_json);
    } catch (_) {
      results = null;
    }
  }
  return {
    id: row.id,
    symbol: row.symbol,
    title: row.title,
    body: row.body,
    scanType: row.scan_type,
    results,
    createdAt: row.created_at,
  };
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

module.exports = {
  addNotification,
  getNotifications,
  getNotificationDetail,
  getUnreadCount,
  markAllRead,
  removeNotification,
  clearAll,
};
