const webpush = require('web-push');
const db = require('../db');
const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = require('../config');
const { reportError } = require('../utils/reportError');

// A malformed VAPID key (wrong length/encoding) must never take the whole
// server down at boot — push notifications are one optional feature, not
// a reason for the entire app to fail to start. Fall back to "not
// configured" and log loudly instead of throwing.
let configured = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
if (configured) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } catch (err) {
    configured = false;
    reportError(err, '[webPush] Invalid VAPID keys — push notifications disabled');
  }
}

async function saveSubscription(userId, sub) {
  await db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
}

async function removeSubscription(endpoint, userId) {
  if (userId != null) {
    await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, userId);
  } else {
    // Internal cleanup path (dead subscription pruning) — no user context to scope to.
    await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }
}

/**
 * Sends one push payload to every device the user has subscribed on, in
 * parallel. Prunes dead subscriptions automatically. Returns a delivery
 * summary so callers (admin test-push, diagnostics) can PROVE the push was
 * accepted by the push service — a 201 means it will reach the device even
 * with the app closed. `configured:false` means VAPID isn't set up.
 *
 * @returns {{ configured: boolean, devices: number, delivered: number,
 *             removed: number, results: Array<{statusCode?: number, error?: string}> }}
 */
async function sendPushToUser(userId, payload) {
  if (!configured) return { configured: false, devices: 0, delivered: 0, removed: 0, results: [] };
  const rows = await db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
  const body = JSON.stringify(payload);

  const results = await Promise.all(
    rows.map(async (row) => {
      const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        // web-push has no default timeout — a push service that hangs would
        // otherwise stall this Promise.all indefinitely.
        const res = await webpush.sendNotification(sub, body, { timeout: 15000 });
        return { statusCode: res && res.statusCode };
      } catch (err) {
        // 404/410 mean the browser dropped this subscription — prune it so we
        // never keep trying a dead endpoint (this is how uninstalls / cleared
        // site data self-heal without any manual cleanup).
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          await removeSubscription(row.endpoint);
          return { statusCode: err.statusCode, error: 'expired-removed' };
        }
        return { statusCode: err && err.statusCode, error: (err && err.message) || 'send-failed' };
      }
    })
  );

  const delivered = results.filter((r) => r.statusCode && r.statusCode >= 200 && r.statusCode < 300).length;
  const removed = results.filter((r) => r.error === 'expired-removed').length;
  return { configured: true, devices: rows.length, delivered, removed, results };
}

module.exports = { configured, saveSubscription, removeSubscription, sendPushToUser };
