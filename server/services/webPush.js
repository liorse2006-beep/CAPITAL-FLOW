const webpush = require('web-push');
const db = require('../db');
const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = require('../config');

const configured = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
if (configured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

function saveSubscription(userId, sub) {
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
  `).run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
}

function removeSubscription(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

/** Sends one push payload to every device the user has subscribed on. Prunes dead subscriptions automatically. */
async function sendPushToUser(userId, payload) {
  if (!configured) return;
  const rows = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
  const body = JSON.stringify(payload);

  await Promise.all(rows.map(async (row) => {
    const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
    try {
      await webpush.sendNotification(sub, body);
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        removeSubscription(row.endpoint);
      }
    }
  }));
}

module.exports = { configured, saveSubscription, removeSubscription, sendPushToUser };
