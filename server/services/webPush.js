const webpush = require('web-push');
const db = require('../db');
const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = require('../config');

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
    console.error('[webPush] Invalid VAPID keys — push notifications disabled:', err.message);
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

/** Sends one push payload to every device the user has subscribed on. Prunes dead subscriptions automatically. */
async function sendPushToUser(userId, payload) {
  if (!configured) return;
  const rows = await db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
  const body = JSON.stringify(payload);

  await Promise.all(
    rows.map(async (row) => {
      const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        await webpush.sendNotification(sub, body);
      } catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          await removeSubscription(row.endpoint);
        }
      }
    })
  );
}

module.exports = { configured, saveSubscription, removeSubscription, sendPushToUser };
