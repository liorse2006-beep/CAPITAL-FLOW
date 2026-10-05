// Durable per-user notification history — backs the in-app bell so a push
// the user never actually saw (computer off, dismissed on the phone before
// reading it) is still there the next time they open the app.

const db = require('../db');

// Keeps the table from growing without bound for a very active watchlist —
// trimmed on every insert rather than a separate cron job.
const MAX_PER_USER = 200;

// Keep the complete result snapshot for a scheduled run. The current scanner
// universe is finite (515 symbols), and the notification row is already
// bounded by MAX_PER_USER. Truncating here made the notification detail show
// a different, incomplete scan from the one that actually ran.

/** Returns the new notification's id, so a caller (scheduled scans) can build
 * a "show me exactly this run" deep link into the push payload. */
async function addNotification(
  userId,
  { symbol, title, body, scanType, results, dataStatus, dataAsOf, pushPayload },
  target
) {
  if (!target)
    return db.transaction((tx) =>
      addNotification(userId, { symbol, title, body, scanType, results, dataStatus, dataAsOf, pushPayload }, tx)
    );
  if (pushPayload) {
    // Never discard previously committed delivery work to admit more work.
    // The caller's transaction rolls back and its durable job can retry.
    if (db.dialect === 'postgres') await target.prepare('SELECT id FROM users WHERE id = ? FOR UPDATE').get(userId);
    const pending = await target
      .prepare('SELECT COUNT(*) AS total FROM notification_outbox WHERE user_id = ? AND finished_at IS NULL')
      .get(userId);
    if (Number(pending.total) >= MAX_PER_USER) {
      const error = new Error('Notification queue is at capacity');
      error.code = 'WORK_QUEUE_BUSY';
      throw error;
    }
  }
  const resultsJson = Array.isArray(results) && results.length > 0 ? JSON.stringify(results) : null;
  const res = await target
    .prepare(
      'INSERT INTO notifications (user_id, symbol, title, body, scan_type, results_json, data_status, data_as_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      userId,
      symbol || null,
      title,
      body,
      scanType || null,
      resultsJson,
      ['complete', 'partial', 'unavailable', 'stale'].includes(dataStatus) ? dataStatus : null,
      dataAsOf && Number.isFinite(Date.parse(dataAsOf)) ? new Date(dataAsOf).toISOString() : null
    );
  await target
    .prepare(
      `DELETE FROM notifications WHERE user_id = ? AND id NOT IN (SELECT notification_id FROM notification_outbox WHERE user_id = ? AND finished_at IS NULL) AND id NOT IN (
         SELECT id FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
       )`
    )
    .run(userId, userId, userId, MAX_PER_USER);
  const id = res.lastInsertRowid;
  if (pushPayload) {
    const baseUrl = pushPayload.data?.url || '/scanner';
    await require('./notificationOutbox').enqueueNotification(target, id, userId, {
      ...pushPayload,
      title,
      body,
      data: { ...pushPayload.data, url: scanType ? baseUrl.split('?')[0] + '?notif=srv-' + id : baseUrl },
    });
  }
  await target
    .prepare(
      'DELETE FROM notification_outbox WHERE user_id = ? AND notification_id NOT IN (SELECT id FROM notifications WHERE user_id = ?)'
    )
    .run(userId, userId);
  await target
    .prepare(
      'DELETE FROM notification_push_receipts WHERE user_id = ? AND notification_id NOT IN (SELECT id FROM notifications WHERE user_id = ?)'
    )
    .run(userId, userId);
  return id;
}

/**
 * Atomically consume a one-shot watchlist alert and persist its notification.
 * The delete and insert run on the same transaction connection. We branch in
 * JavaScript after the delete instead of relying on SQLite's connection-local
 * changes() function, so the exact same atomic behavior works on PostgreSQL.
 * If the notification insert fails, the write transaction rolls the alert
 * deletion back and the next scan can retry it safely.
 */
async function consumeWatchlistAlert(userId, symbol, { title, body, pushPayload, expectedAlert }) {
  return db.transaction(async (tx) => {
    if (!(await require('./deferredAccess').hasDeferredAccess(userId, tx))) {
      return { consumed: false, notificationId: null };
    }
    const guard = expectedAlert
      ? expectedAlert.type === 'price'
        ? ' AND type = ? AND target_price = ? AND starting_side = ?'
        : ' AND type = ? AND min_ratio = ?'
      : '';
    const args = expectedAlert
      ? expectedAlert.type === 'price'
        ? ['price', expectedAlert.targetPrice, expectedAlert.startingSide]
        : ['volume', expectedAlert.minRatio]
      : [];
    const deleted = await tx
      .prepare('DELETE FROM watchlist_alerts WHERE user_id = ? AND symbol = ?' + guard)
      .run(userId, symbol, ...args);
    if (Number(deleted?.changes ?? deleted?.rowsAffected ?? 0) < 1) {
      return { consumed: false, notificationId: null };
    }

    const insertedId = await addNotification(userId, { symbol, title, body, pushPayload }, tx);
    const notificationId = insertedId == null ? null : Number(insertedId);
    if (notificationId == null) throw new Error('Notification insert did not return an id.');

    return { consumed: true, notificationId };
  });
}

async function getNotifications(userId, limit) {
  return db
    .prepare(
      'SELECT id, symbol, title, body, scan_type, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    )
    .all(userId, limit || 100);
}

/** One notification's full detail, including its scan results if it has any
 * — scoped to the owning user, and marks it read since opening it is the
 * clearest possible "I saw this" signal. Returns undefined if it doesn't
 * exist or belongs to someone else. */
async function getNotificationDetail(userId, id) {
  const row = await db
    .prepare(
      'SELECT id, symbol, title, body, scan_type, results_json, data_status, data_as_of, created_at FROM notifications WHERE user_id = ? AND id = ?'
    )
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
    dataStatus: row.data_status || 'unknown',
    dataAsOf: row.data_as_of || null,
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
  await db.transaction([
    { sql: 'DELETE FROM notification_push_receipts WHERE user_id = ? AND notification_id = ?', args: [userId, id] },
    { sql: 'DELETE FROM notification_outbox WHERE user_id = ? AND notification_id = ?', args: [userId, id] },
    { sql: 'DELETE FROM notifications WHERE user_id = ? AND id = ?', args: [userId, id] },
  ]);
}

async function clearAll(userId) {
  await db.transaction([
    { sql: 'DELETE FROM notification_push_receipts WHERE user_id = ?', args: [userId] },
    { sql: 'DELETE FROM notification_outbox WHERE user_id = ?', args: [userId] },
    { sql: 'DELETE FROM notifications WHERE user_id = ?', args: [userId] },
  ]);
}

module.exports = {
  addNotification,
  consumeWatchlistAlert,
  getNotifications,
  getNotificationDetail,
  getUnreadCount,
  markAllRead,
  removeNotification,
  clearAll,
};
