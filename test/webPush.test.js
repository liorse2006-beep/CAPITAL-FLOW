// Regression tests for Web Push delivery: subscriptions must be scoped to
// the owning user, and a subscription that the browser has revoked (push
// service replies 404/410) must be pruned automatically so we stop wasting
// calls on it and it doesn't accumulate forever.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');

const webpushLib = require('web-push');

// web-push validates VAPID key format at setVapidDetails() time, so fake
// strings would throw at module load — generate a real key pair for tests.
const vapidKeys = webpushLib.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey;
process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;
process.env.VAPID_SUBJECT = 'mailto:test@test.local';

delete require.cache[require.resolve('../server/config')];
delete require.cache[require.resolve('../server/services/webPush')];

const db = require('../server/db');
const webPush = require('../server/services/webPush');

before(async () => {
  await db.ready;
});

async function makeUser(email) {
  const result = await db.prepare('INSERT INTO users (email, is_verified, is_premium) VALUES (?, 1, 1)').run(email);
  return result.lastInsertRowid;
}

test('saveSubscription upserts by endpoint, keeping only the latest keys', async () => {
  const u = await makeUser('push-a@test.local');
  await webPush.saveSubscription(u, { endpoint: 'https://push.example/1', keys: { p256dh: 'p1', auth: 'a1' } });
  await webPush.saveSubscription(u, { endpoint: 'https://push.example/1', keys: { p256dh: 'p2', auth: 'a2' } });

  const row = await db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get('https://push.example/1');
  assert.strictEqual(row.p256dh, 'p2');
  assert.strictEqual(row.user_id, u);
});

test('push subscriptions reject non-HTTPS and private endpoints before any outbound send', () => {
  assert.strictEqual(webPush.isValidPushEndpoint('http://push.example/1'), false);
  assert.strictEqual(webPush.isValidPushEndpoint('https://127.0.0.1/1'), false);
  assert.strictEqual(webPush.isValidPushEndpoint('https://[::1]/1'), false);
  assert.strictEqual(webPush.isValidPushEndpoint('https://push.example/1'), true);
  assert.strictEqual(
    webPush.isValidSubscription({ endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } }),
    true
  );
});

test('sendPushToUser calls sendNotification once per subscription owned by that user', async () => {
  const u = await makeUser('push-b@test.local');
  await webPush.saveSubscription(u, { endpoint: 'https://push.example/2', keys: { p256dh: 'p', auth: 'a' } });

  const calls = [];
  const original = webpushLib.sendNotification;
  webpushLib.sendNotification = async (sub, body) => {
    calls.push({ sub, body });
  };
  try {
    await webPush.sendPushToUser(u, { title: 'hi' });
  } finally {
    webpushLib.sendNotification = original;
  }

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].sub.endpoint, 'https://push.example/2');
});

test('sendPushToUser returns a delivery summary proving the push service accepted it (201)', async () => {
  const u = await makeUser('push-summary@test.local');
  await webPush.saveSubscription(u, { endpoint: 'https://push.example/sum', keys: { p256dh: 'p', auth: 'a' } });

  const original = webpushLib.sendNotification;
  webpushLib.sendNotification = async () => ({ statusCode: 201 });
  let summary;
  try {
    summary = await webPush.sendPushToUser(u, { title: 'hi' });
  } finally {
    webpushLib.sendNotification = original;
  }

  assert.strictEqual(summary.configured, true);
  assert.strictEqual(summary.devices, 1);
  assert.strictEqual(summary.delivered, 1, 'a 2xx from the push service counts as delivered');
  assert.strictEqual(summary.removed, 0);
});

test('sendPushToUser prunes a subscription that the push service reports as gone (410)', async () => {
  const u = await makeUser('push-c@test.local');
  await webPush.saveSubscription(u, { endpoint: 'https://push.example/3', keys: { p256dh: 'p', auth: 'a' } });

  const original = webpushLib.sendNotification;
  webpushLib.sendNotification = async () => {
    const err = new Error('gone');
    err.statusCode = 410;
    throw err;
  };
  try {
    await webPush.sendPushToUser(u, { title: 'hi' });
  } finally {
    webpushLib.sendNotification = original;
  }

  const row = await db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get('https://push.example/3');
  assert.strictEqual(row, undefined, 'an expired subscription must be removed, not retried forever');
});

test("sendPushToUser never touches another user's subscriptions", async () => {
  const alice = await makeUser('push-alice@test.local');
  const bob = await makeUser('push-bob@test.local');
  await webPush.saveSubscription(bob, { endpoint: 'https://push.example/bob', keys: { p256dh: 'p', auth: 'a' } });

  const calls = [];
  const original = webpushLib.sendNotification;
  webpushLib.sendNotification = async (sub) => {
    calls.push(sub);
  };
  try {
    await webPush.sendPushToUser(alice, { title: 'hi' });
  } finally {
    webpushLib.sendNotification = original;
  }

  assert.strictEqual(calls.length, 0, "alice has no subscriptions — bob's must not be sent to");
});

test('sendPushToUser reaches every device the user is subscribed on — phone AND laptop, same account', async () => {
  // There's no way to know which device the customer is actually looking at
  // right now, so a single account's subscriptions (one per browser/device,
  // keyed by their own unique endpoint — see the saveSubscription test
  // above) must ALL get the same push in parallel, not just the most recent.
  const u = await makeUser('push-multidevice@test.local');
  await webPush.saveSubscription(u, { endpoint: 'https://push.example/phone', keys: { p256dh: 'p1', auth: 'a1' } });
  await webPush.saveSubscription(u, { endpoint: 'https://push.example/laptop', keys: { p256dh: 'p2', auth: 'a2' } });

  const calls = [];
  const original = webpushLib.sendNotification;
  webpushLib.sendNotification = async (sub) => {
    calls.push(sub.endpoint);
    return { statusCode: 201 };
  };
  let summary;
  try {
    summary = await webPush.sendPushToUser(u, { title: 'hi' });
  } finally {
    webpushLib.sendNotification = original;
  }

  assert.strictEqual(summary.devices, 2);
  assert.strictEqual(summary.delivered, 2);
  assert.deepStrictEqual(calls.sort(), ['https://push.example/laptop', 'https://push.example/phone']);
});
