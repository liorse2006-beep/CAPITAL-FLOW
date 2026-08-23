const webpush = require('web-push');
const net = require('net');
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

function isPrivateIp(hostname) {
  const value = String(hostname || '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  const version = net.isIP(value);
  if (version === 4) {
    const octets = value.split('.').map(Number);
    return (
      octets[0] === 0 ||
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
      (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19)) ||
      octets[0] >= 224
    );
  }
  if (version === 6) {
    return (
      value === '::' ||
      value === '::1' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      value.startsWith('fe8') ||
      value.startsWith('fe9') ||
      value.startsWith('fea') ||
      value.startsWith('feb')
    );
  }
  return false;
}

function isValidPushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || !host) return false;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isPrivateIp(host))
      return false;
    return true;
  } catch (_) {
    return false;
  }
}

function isValidSubscription(sub) {
  return !!(
    sub &&
    isValidPushEndpoint(sub.endpoint) &&
    sub.keys &&
    typeof sub.keys.p256dh === 'string' &&
    sub.keys.p256dh.length > 0 &&
    sub.keys.p256dh.length <= 256 &&
    typeof sub.keys.auth === 'string' &&
    sub.keys.auth.length > 0 &&
    sub.keys.auth.length <= 256
  );
}

async function saveSubscription(userId, sub) {
  if (!isValidSubscription(sub)) throw new Error('Invalid push subscription');
  await db
    .prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
    )
    .run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
}

async function removeSubscription(endpoint, userId) {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) return;
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
  const validRows = rows.filter((row) =>
    isValidSubscription({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } })
  );
  const invalidRows = rows.filter(
    (row) => !isValidSubscription({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } })
  );
  await Promise.all(invalidRows.map((row) => removeSubscription(row.endpoint)));
  const body = JSON.stringify(payload);

  const results = await Promise.all(
    validRows.map(async (row) => {
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
  return { configured: true, devices: validRows.length, delivered, removed: removed + invalidRows.length, results };
}

module.exports = {
  configured,
  saveSubscription,
  removeSubscription,
  sendPushToUser,
  isValidPushEndpoint,
  isValidSubscription,
};
