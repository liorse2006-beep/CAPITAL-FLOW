const crypto = require('node:crypto');
const db = require('../db');
const { hasDeferredAccess } = require('./deferredAccess');
const { reportError } = require('../utils/reportError');
const bus = require('./clusterBus');
const { backgroundInterval, runBackgroundTask } = require('./backgroundRuntime');
const MAX_ATTEMPTS = 3;
const LEASE_SECONDS = 120;
let dirty = true;
let nextDue = 0;
let timer;
let running = false;
bus.subscribe('notification-outbox', () => {
  dirty = true;
});

async function enqueueNotification(tx, notificationId, userId, payload) {
  const stable = { ...payload, tag: 'capital-flow-notification-' + notificationId };
  await tx
    .prepare(
      `INSERT INTO notification_outbox (notification_id, user_id, payload_json, created_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(notification_id) DO NOTHING`
    )
    .run(notificationId, userId, JSON.stringify(stable), Math.floor(Date.now() / 1000));
  if (typeof tx.afterCommit !== 'function') throw new Error('Outbox requires a commit-aware transaction');
  tx.afterCommit(() => {
    dirty = true;
    bus.publish('notification-outbox', {});
  });
}

async function dispatchNotification(notificationId) {
  const token = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const row = await db.transaction(async (tx) => {
    const claim = await tx
      .prepare(
        `UPDATE notification_outbox SET claim_token = ?, lease_until = ?, attempts = attempts + 1
      WHERE notification_id = ? AND finished_at IS NULL AND attempts < ? AND next_attempt_at <= ? AND lease_until <= ?`
      )
      .run(token, now + LEASE_SECONDS, notificationId, MAX_ATTEMPTS, now, now);
    if (Number(claim.changes ?? claim.rowsAffected) !== 1) return null;
    const entry = await tx
      .prepare('SELECT * FROM notification_outbox WHERE notification_id = ? AND claim_token = ?')
      .get(notificationId, token);
    const exists = await tx
      .prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?')
      .get(notificationId, entry.user_id);
    if (!exists || now - entry.created_at > 86400 || !(await hasDeferredAccess(entry.user_id, tx))) {
      await tx
        .prepare(
          "UPDATE notification_outbox SET finished_at = ?, outcome = 'expired-or-revoked', lease_until = 0 WHERE notification_id = ? AND claim_token = ?"
        )
        .run(now, notificationId, token);
      return null;
    }
    return entry;
  });
  if (!row) return null;
  let summary;
  try {
    summary = await require('./webPush').sendPushToUser(row.user_id, JSON.parse(row.payload_json), {
      notificationId: row.notification_id,
    });
  } catch (error) {
    reportError(error, '[notification outbox delivery]');
  }
  const outcome = !summary
    ? 'failed'
    : !summary.configured
      ? 'unconfigured'
      : summary.devices === 0
        ? summary.acceptedPreviously
          ? 'accepted'
          : 'no-devices'
        : summary.delivered === summary.devices && !summary.overflow
          ? 'accepted'
          : 'failed';
  // A provider acknowledgement is not proof the person saw the message.
  // Persisted device acknowledgements are not resent. A crash between remote
  // acceptance and receipt storage remains ambiguous; a stable tag reduces
  // reannouncement but cannot promise exactly-once delivery across services.
  const terminal = outcome !== 'failed' || row.attempts >= MAX_ATTEMPTS;
  await db
    .prepare(
      `UPDATE notification_outbox SET finished_at = ?, outcome = ?, lease_until = 0, next_attempt_at = ?
    WHERE notification_id = ? AND claim_token = ? AND finished_at IS NULL`
    )
    .run(
      terminal ? Math.floor(Date.now() / 1000) : null,
      outcome,
      now + (row.attempts === 1 ? 30 : 120),
      notificationId,
      token
    );
  if (outcome === 'failed' && terminal)
    reportError(
      new Error('Push attempts exhausted; the in-app notification remains available'),
      '[notification outbox]'
    );
  dirty = true;
  return summary;
}

async function runNotificationOutboxCycle() {
  if (running) return;
  if (!dirty && Date.now() < nextDue) return;
  running = true;
  dirty = false;
  try {
    const now = Math.floor(Date.now() / 1000);
    // A process may disappear on its final attempt. Close that expired lease
    // explicitly rather than leave a permanently pending, unclaimable row.
    await db
      .prepare(
        "UPDATE notification_outbox SET finished_at = ?, outcome = 'attempts-exhausted' WHERE finished_at IS NULL AND attempts >= ? AND lease_until <= ?"
      )
      .run(now, MAX_ATTEMPTS, now);
    const pending = await db
      .prepare(
        `SELECT notification_id FROM notification_outbox
      WHERE finished_at IS NULL AND attempts < ? AND next_attempt_at <= ? AND lease_until <= ? ORDER BY created_at LIMIT 40`
      )
      .all(MAX_ATTEMPTS, now, now);
    for (let index = 0; index < pending.length; index += 8) {
      await Promise.all(pending.slice(index, index + 8).map((entry) => dispatchNotification(entry.notification_id)));
    }
    const future = await db
      .prepare(
        'SELECT MIN(CASE WHEN lease_until > next_attempt_at THEN lease_until ELSE next_attempt_at END) AS due FROM notification_outbox WHERE finished_at IS NULL'
      )
      .get();
    nextDue = future?.due == null ? Infinity : Number(future.due) * 1000;
    await db
      .prepare('DELETE FROM notification_outbox WHERE finished_at IS NOT NULL AND created_at < ?')
      .run(now - 7 * 86400);
  } catch (error) {
    nextDue = Date.now() + 30000;
    reportError(error, '[notification outbox recovery]');
  } finally {
    running = false;
  }
}

function startNotificationOutbox() {
  if (timer) return;
  timer = backgroundInterval(() => {
    return runNotificationOutboxCycle().catch((error) => reportError(error, '[notification outbox timer]'));
  }, 10000);
  timer.unref();
  runBackgroundTask(runNotificationOutboxCycle).catch((error) => reportError(error, '[notification outbox startup]'));
}

module.exports = { enqueueNotification, dispatchNotification, runNotificationOutboxCycle, startNotificationOutbox };
