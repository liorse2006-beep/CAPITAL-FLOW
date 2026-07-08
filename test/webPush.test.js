// Regression tests for Web Push delivery: subscriptions must be scoped to
// the owning user, and a subscription that the browser has revoked (push
// service replies 404/410) must be pruned automatically so we stop wasting
// calls on it and it doesn't accumulate forever.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');

const webpushLib = require('web-push');

// web-push validates VAPID key format at setVapidDetails() time, so fake
// strings would throw at module load — generate a real key pair for tests.
const vapidKeys = webpushLib.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY  = vapidKeys.publicKey;
process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;
process.env.VAPID_SUBJECT     = 'mailto:test@test.local';

delete require.cache[require.resolve('../server/config')];
delete require.cache[require.resolve('../server/services/webPush')];

const db = require('../server/db');
const webPush = require('../server/services/webPush');

function makeUser(email) {
  return db.prepare('INSERT INTO users (email, is_verified, is_premium) VALUES (?, 1, 1)').run(email).lastInsertRowid;
}

test('saveSubscription upserts by endpoint, keeping only the latest keys', () => {
  const u = makeUser('push-a@test.local');
  webPush.saveSubscription(u, { endpoint: 'https://push.example/1', keys: { p256dh: 'p1', auth: 'a1' } });
  webPush.saveSubscription(u, { endpoint: 'https://push.example/1', keys: { p256dh: 'p2', auth: 'a2' } });

  const row = db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get('https://push.example/1');
  assert.strictEqual(row.p256dh, 'p2');
  assert.strictEqual(row.user_id, u);
});

test('sendPushToUser calls sendNotification once per subscription owned by that user', async () => {
  const u = makeUser('push-b@test.local');
  webPush.saveSubscription(u, { endpoint: 'https://push.example/2', keys: { p256dh: 'p', auth: 'a' } });

  const calls = [];
  const original = webpushLib.sendNotification;
  webpushLib.sendNotification = async (sub, body) => { calls.push({ sub, body }); };
  try {
    await webPush.sendPushToUser(u, { title: 'hi' });
  } finally {
    webpushLib.sendNotification = original;
  }

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].sub.endpoint, 'https://push.example/2');
});

test('sendPushToUser prunes a subscription that the push service reports as gone (410)', async () => {
  const u = makeUser('push-c@test.local');
  webPush.saveSubscription(u, { endpoint: 'https://push.example/3', keys: { p256dh: 'p', auth: 'a' } });

  const original = webpushLib.sendNotification;
  webpushLib.sendNotification = async () => { const err = new Error('gone'); err.statusCode = 410; throw err; };
  try {
    await webPush.sendPushToUser(u, { title: 'hi' });
  } finally {
    webpushLib.sendNotification = original;
  }

  const row = db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get('https://push.example/3');
  assert.strictEqual(row, undefined, 'an expired subscription must be removed, not retried forever');
});

test('sendPushToUser never touches another user\'s subscriptions', async () => {
  const alice = makeUser('push-alice@test.local');
  const bob   = makeUser('push-bob@test.local');
  webPush.saveSubscription(bob, { endpoint: 'https://push.example/bob', keys: { p256dh: 'p', auth: 'a' } });

  const calls = [];
  const original = webpushLib.sendNotification;
  webpushLib.sendNotification = async (sub) => { calls.push(sub); };
  try {
    await webPush.sendPushToUser(alice, { title: 'hi' });
  } finally {
    webpushLib.sendNotification = original;
  }

  assert.strictEqual(calls.length, 0, "alice has no subscriptions — bob's must not be sent to");
});
