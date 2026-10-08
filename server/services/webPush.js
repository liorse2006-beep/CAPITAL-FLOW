const webpush = require('web-push');
const net = require('net');
const dns = require('node:dns').promises;
const https = require('node:https');
const crypto = require('node:crypto');
const pushTransport = require('./pushTransport');
const { withUserWrite } = require('./userWrite');
const { createBoundedQueue } = require('./boundedQueue');
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

const MAX_PUSH_DEVICES = 10;
const runPush = createBoundedQueue({ concurrency: 8, maxWaiting: 500, waitTimeoutMs: 30000 });
const runDns = createBoundedQueue({ concurrency: 8, maxWaiting: 64, waitTimeoutMs: 5000 });
const reserved = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])
  reserved.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
])
  reserved.addSubnet(address, prefix, 'ipv6');
const globalV6 = new net.BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

function isPrivateIp(hostname) {
  const value = String(hostname || '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  const version = net.isIP(value);
  if (version === 4) return reserved.check(value, 'ipv4');
  if (version === 6) return !globalV6.check(value, 'ipv6') || reserved.check(value, 'ipv6');
  return false;
}

function isValidPushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    const host = url.hostname
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '')
      .toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !host ||
      (url.port && url.port !== '443') ||
      url.hash
    )
      return false;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isPrivateIp(host))
      return false;
    return true;
  } catch (_) {
    return false;
  }
}

function isValidSubscription(sub) {
  const shape = !!(
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
  if (!shape || !/^[A-Za-z0-9_-]+={0,2}$/.test(sub.keys.p256dh) || !/^[A-Za-z0-9_-]+={0,2}$/.test(sub.keys.auth))
    return false;
  const publicKey = Buffer.from(sub.keys.p256dh, 'base64url');
  if (publicKey.length !== 65 || publicKey[0] !== 4 || Buffer.from(sub.keys.auth, 'base64url').length !== 16)
    return false;
  try {
    crypto.ECDH.convertKey(publicKey, 'prime256v1');
    return true;
  } catch {
    return false;
  }
}

async function saveSubscription(userId, sub) {
  if (!isValidSubscription(sub)) throw new Error('Invalid push subscription');
  const endpoint = new URL(sub.endpoint).href;
  await withUserWrite(userId, async (tx) => {
    const existing = await tx
      .prepare('SELECT user_id, p256dh, auth FROM push_subscriptions WHERE endpoint = ?')
      .get(endpoint);
    if (
      existing &&
      Number(existing.user_id) !== Number(userId) &&
      (existing.p256dh !== sub.keys.p256dh || existing.auth !== sub.keys.auth)
    ) {
      throw new Error('Notification device ownership could not be verified');
    }
    const count = await tx.prepare('SELECT COUNT(*) AS total FROM push_subscriptions WHERE user_id = ?').get(userId);
    if (Number(existing?.user_id) !== Number(userId) && Number(count.total) >= MAX_PUSH_DEVICES) {
      const error = new Error('Maximum notification devices reached');
      error.code = 'PUSH_SUBSCRIPTION_LIMIT';
      throw error;
    }
    const saved = await tx
      .prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = excluded.created_at
     WHERE push_subscriptions.user_id = excluded.user_id
        OR (push_subscriptions.p256dh = excluded.p256dh AND push_subscriptions.auth = excluded.auth)`
      )
      .run(userId, endpoint, sub.keys.p256dh, sub.keys.auth);
    // Another account may register the same endpoint after our read on
    // PostgreSQL. Ownership must also be enforced at the atomic write boundary.
    if (Number(saved?.changes ?? saved?.rowsAffected) !== 1) {
      throw new Error('Notification device ownership could not be verified');
    }
  });
}

async function pinnedPushAgent(endpoint) {
  if (!isValidPushEndpoint(endpoint)) throw new Error('Invalid push destination');
  const url = new URL(endpoint);
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  let timer;
  let addresses;
  try {
    addresses = net.isIP(host)
      ? [{ address: host, family: net.isIP(host) }]
      : await Promise.race([
          runDns(() => dns.lookup(host, { all: true, verbatim: true })),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Push DNS lookup timed out')), 5000);
            timer.unref();
          }),
        ]);
  } finally {
    clearTimeout(timer);
  }
  if (
    !Array.isArray(addresses) ||
    !addresses.length ||
    addresses.some((entry) => !net.isIP(entry.address) || isPrivateIp(entry.address))
  )
    throw new Error('Push destination is not public');
  const agent = new https.Agent({
    keepAlive: false,
    lookup: (requestedHost, options, callback) => {
      if (requestedHost.replace(/\.$/, '') !== host) return callback(new Error('Push hostname mismatch'));
      const matches = addresses.filter((entry) => !options.family || entry.family === options.family);
      if (!matches.length) return callback(new Error('Push address family unavailable'));
      if (options.all) return callback(null, matches);
      callback(null, matches[0].address, matches[0].family);
    },
  });
  if (!net.isIP(host)) url.hostname = host;
  return { agent, endpoint: url.href };
}

async function removeSubscription(endpoint, userId) {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) return;
  let canonical;
  try {
    canonical = new URL(endpoint).href;
  } catch {
    return;
  }
  if (userId != null) {
    await db
      .prepare('DELETE FROM push_subscriptions WHERE (endpoint = ? OR endpoint = ?) AND user_id = ?')
      .run(canonical, endpoint, userId);
  } else {
    // Internal cleanup path (dead subscription pruning) — no user context to scope to.
    await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? OR endpoint = ?').run(canonical, endpoint);
  }
}

/**
 * Sends one push payload to every device the user has subscribed on, in
 * parallel. Prunes dead subscriptions automatically. Returns a delivery
 * summary so callers (admin test-push, diagnostics) can PROVE the push was
 * accepted by the push service, not proof it reached or was seen on a device.
 * `configured:false` means VAPID isn't set up.
 *
 * @returns {{ configured: boolean, devices: number, delivered: number,
 *             removed: number, results: Array<{statusCode?: number, error?: string}> }}
 */
async function sendPushToUser(userId, payload, { notificationId } = {}) {
  if (!configured) return { configured: false, devices: 0, delivered: 0, removed: 0, results: [] };
  const rows = await db
    .prepare(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?'
    )
    .all(userId, MAX_PUSH_DEVICES * 4 + 1);
  const overflow = rows.length > MAX_PUSH_DEVICES;
  const validRows = rows.filter((row) =>
    isValidSubscription({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } })
  );
  const invalidRows = rows.filter(
    (row) => !isValidSubscription({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } })
  );
  await Promise.all(invalidRows.map((row) => removeSubscription(row.endpoint, userId)));
  const body = JSON.stringify(payload);
  const receipts =
    notificationId == null
      ? []
      : await db
          .prepare('SELECT endpoint FROM notification_push_receipts WHERE notification_id = ? AND user_id = ?')
          .all(notificationId, userId);
  const acknowledged = new Set(receipts.map((row) => row.endpoint));
  const selected = validRows.slice(0, MAX_PUSH_DEVICES).filter((row) => !acknowledged.has(row.endpoint));

  const results = await Promise.all(
    selected.map((row) =>
      runPush(async () => {
        const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
        let agent;
        try {
          // web-push has no default timeout — a push service that hangs would
          // otherwise stall this Promise.all indefinitely.
          const pinned = await pinnedPushAgent(sub.endpoint);
          agent = pinned.agent;
          sub.endpoint = pinned.endpoint;
          // Queuing and DNS can outlive an account/subscription change. Check
          // the current owner and deferred entitlement immediately before send.
          const current = await db
            .prepare('SELECT user_id, p256dh, auth FROM push_subscriptions WHERE endpoint = ?')
            .get(row.endpoint);
          if (
            !current ||
            Number(current.user_id) !== Number(userId) ||
            current.p256dh !== row.p256dh ||
            current.auth !== row.auth ||
            (notificationId != null && !(await require('./deferredAccess').hasDeferredAccess(userId)))
          )
            return { error: 'access-or-device-changed' };
          const res = await pushTransport.sendNotification(sub, body, { agent });
          if (notificationId != null && res?.statusCode >= 200 && res.statusCode < 300) {
            await db
              .prepare(
                'INSERT INTO notification_push_receipts (notification_id, user_id, endpoint, accepted_at) VALUES (?, ?, ?, ?) ON CONFLICT(notification_id, endpoint) DO NOTHING'
              )
              .run(notificationId, userId, row.endpoint, Math.floor(Date.now() / 1000));
          }
          return { statusCode: res && res.statusCode };
        } catch (err) {
          // 404/410 mean the browser dropped this subscription — prune it so we
          // never keep trying a dead endpoint (this is how uninstalls / cleared
          // site data self-heal without any manual cleanup).
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            await removeSubscription(row.endpoint, userId);
            return { statusCode: err.statusCode, error: 'expired-removed' };
          }
          reportError(err, '[webPush] delivery failed');
          return { statusCode: err && err.statusCode, error: 'send-failed' };
        } finally {
          agent?.destroy();
        }
      }).catch(() => ({ error: 'queue-at-capacity' }))
    )
  );

  const delivered = results.filter((r) => r.statusCode && r.statusCode >= 200 && r.statusCode < 300).length;
  const removed = results.filter((r) => r.error === 'expired-removed').length;
  return {
    configured: true,
    devices: selected.length,
    delivered,
    acceptedPreviously: receipts.length,
    removed: removed + invalidRows.length,
    overflow,
    results,
  };
}

function isPushConfigured() {
  return configured;
}

module.exports = {
  configured,
  isPushConfigured,
  saveSubscription,
  removeSubscription,
  sendPushToUser,
  isValidPushEndpoint,
  isValidSubscription,
  MAX_PUSH_DEVICES,
};
