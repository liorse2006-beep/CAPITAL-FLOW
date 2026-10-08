// Regression tests for Web Push delivery: subscriptions must be scoped to
// the owning user, and a subscription that the browser has revoked (push
// service replies 404/410) must be pruned automatically so we stop wasting
// calls on it and it doesn't accumulate forever.
require('./helpers/testEnv');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert');

const webpushLib = require('web-push');
const pushTransport = require('../server/services/pushTransport');
const keys1 = { p256dh: webpushLib.generateVAPIDKeys().publicKey, auth: Buffer.alloc(16, 1).toString('base64url') };
const keys2 = { p256dh: webpushLib.generateVAPIDKeys().publicKey, auth: Buffer.alloc(16, 2).toString('base64url') };

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
const dns = require('node:dns').promises;
beforeEach((t) => {
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
});

before(async () => {
  await db.ready;
});

async function makeUser(email) {
  const result = await db.prepare('INSERT INTO users (email, is_verified, is_premium) VALUES (?, 1, 1)').run(email);
  return result.lastInsertRowid;
}

test('saveSubscription upserts by endpoint, keeping only the latest keys', async () => {
  const u = await makeUser('push-a@test.local');
  await webPush.saveSubscription(u, { endpoint: 'https://push.example/1', keys: keys1 });
  await webPush.saveSubscription(u, { endpoint: 'https://push.example/1', keys: keys2 });

  const row = await db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get('https://push.example/1');
  assert.strictEqual(row.p256dh, keys2.p256dh);
  assert.strictEqual(row.user_id, u);
});

test('knowing another account endpoint without its keys cannot take its device', async () => {
  const alice = await makeUser('push-owner-a@test.local');
  const bob = await makeUser('push-owner-b@test.local');
  const endpoint = 'https://push.example/ownership';
  await webPush.saveSubscription(alice, { endpoint, keys: keys1 });
  await assert.rejects(webPush.saveSubscription(bob, { endpoint, keys: keys2 }), /ownership/);
  const row = await db.prepare('SELECT user_id, p256dh FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
  assert.equal(row.user_id, alice);
  assert.equal(row.p256dh, keys1.p256dh);
  // The same browser can explicitly switch accounts by proving possession
  // of its actual subscription keys; only the new account then receives push.
  await webPush.saveSubscription(bob, { endpoint, keys: keys1 });
  assert.equal(
    (await db.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint = ?').get(endpoint)).user_id,
    bob
  );
});

test('a device that changes accounts during DNS never receives the old account payload', async (t) => {
  const alice = await makeUser('push-race-a@test.local');
  const bob = await makeUser('push-race-b@test.local');
  const endpoint = 'https://push.example/inflight';
  await webPush.saveSubscription(alice, { endpoint, keys: keys1 });
  t.mock.method(dns, 'lookup', async () => {
    await webPush.saveSubscription(bob, { endpoint, keys: keys1 });
    return [{ address: '8.8.8.8', family: 4 }];
  });
  const sender = t.mock.method(pushTransport, 'sendNotification', async () => ({ statusCode: 201 }));
  const result = await webPush.sendPushToUser(alice, { title: 'Private synthetic alert' });
  assert.equal(sender.mock.callCount(), 0);
  assert.equal(result.delivered, 0);
  assert.equal(result.results[0].error, 'access-or-device-changed');
});

test('the write itself rejects a cross-account ownership race', async (t) => {
  const userId = await makeUser('push-atomic-owner@test.local');
  let insertSql;
  t.mock.method(db, 'transaction', async (callback) =>
    callback({
      prepare(sql) {
        return {
          get: async () =>
            sql.includes('COUNT(*)')
              ? { total: 0 }
              : sql.includes('FROM users')
                ? { id: userId, is_blocked: 0 }
                : undefined,
          run: async () => {
            insertSql = sql;
            return { changes: 0 };
          },
        };
      },
    })
  );
  // Existing endpoint is absent at the preliminary read but another account
  // wins the unique-key insertion before this conditional upsert executes.
  await assert.rejects(
    webPush.saveSubscription(userId, { endpoint: 'https://push.example/atomic', keys: keys1 }),
    /ownership/
  );
  assert.match(insertSql, /WHERE push_subscriptions.user_id = excluded.user_id/);
  assert.match(insertSql, /push_subscriptions.p256dh = excluded.p256dh AND push_subscriptions.auth = excluded.auth/);
});

test('push subscriptions reject non-HTTPS and private endpoints before any outbound send', () => {
  assert.strictEqual(webPush.isValidPushEndpoint('http://push.example/1'), false);
  assert.strictEqual(webPush.isValidPushEndpoint('https://127.0.0.1/1'), false);
  assert.strictEqual(webPush.isValidPushEndpoint('https://[::1]/1'), false);
  for (const endpoint of [
    'https://localhost./1',
    'https://[::ffff:7f00:1]/1',
    'https://[::ffff:a00:1]/1',
    'https://push.example:8443/1',
    'https://[2002:7f00:1::]/1',
  ])
    assert.equal(webPush.isValidPushEndpoint(endpoint), false);
  assert.strictEqual(webPush.isValidPushEndpoint('https://push.example/1'), true);
  assert.strictEqual(webPush.isValidSubscription({ endpoint: 'https://push.example/1', keys: keys1 }), true);
});

test('DNS resolution to private or mixed addresses never reaches the push sender', async (t) => {
  const userId = await makeUser('push-dns-denied@test.local');
  await webPush.saveSubscription(userId, { endpoint: 'https://push.example/dns', keys: keys1 });
  const sender = t.mock.method(pushTransport, 'sendNotification', async () => ({ statusCode: 201 }));
  for (const records of [
    [{ address: '127.0.0.1', family: 4 }],
    [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ],
    [{ address: '::ffff:7f00:1', family: 6 }],
  ]) {
    dns.lookup = async () => records;
    const result = await webPush.sendPushToUser(userId, { title: 'Synthetic test' });
    assert.equal(result.delivered, 0);
  }
  assert.equal(sender.mock.callCount(), 0);
});

test('public DNS addresses are pinned in the HTTPS agent without a second lookup', async (t) => {
  const userId = await makeUser('push-dns-pin@test.local');
  await webPush.saveSubscription(userId, { endpoint: 'https://push.example/pin', keys: keys1 });
  let queries = 0;
  dns.lookup = async () => {
    queries++;
    return [{ address: queries === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }];
  };
  t.mock.method(pushTransport, 'sendNotification', async (_subscription, _body, options) => {
    const address = await new Promise((resolve, reject) =>
      options.agent.options.lookup('push.example', { family: 4 }, (error, value) =>
        error ? reject(error) : resolve(value)
      )
    );
    assert.equal(address, '8.8.8.8');
    return { statusCode: 201 };
  });
  assert.equal((await webPush.sendPushToUser(userId, { title: 'Synthetic test' })).delivered, 1);
  assert.equal(queries, 1);
});

test('concurrent device registrations respect the capacity and allow updates at capacity', async () => {
  const userId = await makeUser('push-device-cap@test.local');
  const subscription = (index) => ({ endpoint: `https://push.example/cap-${index}`, keys: keys1 });
  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, (_, index) => webPush.saveSubscription(userId, subscription(index)))
  );
  assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, webPush.MAX_PUSH_DEVICES);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS total FROM push_subscriptions WHERE user_id = ?').get(userId)).total,
    webPush.MAX_PUSH_DEVICES
  );
  await webPush.saveSubscription(userId, { ...subscription(0), keys: keys2 });
});

test('overlapping push batches share a process-wide concurrency bound', async (t) => {
  const ids = await Promise.all(
    ['push-pool-a', 'push-pool-b', 'push-pool-c'].map((name) => makeUser(`${name}@test.local`))
  );
  for (const userId of ids)
    for (let index = 0; index < 10; index++)
      await webPush.saveSubscription(userId, { endpoint: `https://push.example/pool-${userId}-${index}`, keys: keys1 });
  let active = 0;
  let peak = 0;
  t.mock.method(pushTransport, 'sendNotification', async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return { statusCode: 201 };
  });
  const results = await Promise.all(ids.map((id) => webPush.sendPushToUser(id, { title: 'Synthetic test' })));
  assert.ok(peak <= 8);
  assert.equal(
    results.reduce((sum, result) => sum + result.delivered, 0),
    30
  );
});

test('sendPushToUser calls sendNotification once per subscription owned by that user', async () => {
  const u = await makeUser('push-b@test.local');
  await webPush.saveSubscription(u, { endpoint: 'https://push.example/2', keys: keys1 });

  const calls = [];
  const original = pushTransport.sendNotification;
  pushTransport.sendNotification = async (sub, body) => {
    calls.push({ sub, body });
  };
  try {
    await webPush.sendPushToUser(u, { title: 'hi' });
  } finally {
    pushTransport.sendNotification = original;
  }

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].sub.endpoint, 'https://push.example/2');
});

test('sendPushToUser returns a delivery summary proving the push service accepted it (201)', async () => {
  const u = await makeUser('push-summary@test.local');
  await webPush.saveSubscription(u, { endpoint: 'https://push.example/sum', keys: keys1 });

  const original = pushTransport.sendNotification;
  pushTransport.sendNotification = async () => ({ statusCode: 201 });
  let summary;
  try {
    summary = await webPush.sendPushToUser(u, { title: 'hi' });
  } finally {
    pushTransport.sendNotification = original;
  }

  assert.strictEqual(summary.configured, true);
  assert.strictEqual(summary.devices, 1);
  assert.strictEqual(summary.delivered, 1, 'a 2xx from the push service counts as delivered');
  assert.strictEqual(summary.removed, 0);
});

test('sendPushToUser prunes a subscription that the push service reports as gone (410)', async () => {
  const u = await makeUser('push-c@test.local');
  await webPush.saveSubscription(u, { endpoint: 'https://push.example/3', keys: keys1 });

  const original = pushTransport.sendNotification;
  pushTransport.sendNotification = async () => {
    const err = new Error('gone');
    err.statusCode = 410;
    throw err;
  };
  try {
    await webPush.sendPushToUser(u, { title: 'hi' });
  } finally {
    pushTransport.sendNotification = original;
  }

  const row = await db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get('https://push.example/3');
  assert.strictEqual(row, undefined, 'an expired subscription must be removed, not retried forever');
});

test("sendPushToUser never touches another user's subscriptions", async () => {
  const alice = await makeUser('push-alice@test.local');
  const bob = await makeUser('push-bob@test.local');
  await webPush.saveSubscription(bob, { endpoint: 'https://push.example/bob', keys: keys1 });

  const calls = [];
  const original = pushTransport.sendNotification;
  pushTransport.sendNotification = async (sub) => {
    calls.push(sub);
  };
  try {
    await webPush.sendPushToUser(alice, { title: 'hi' });
  } finally {
    pushTransport.sendNotification = original;
  }

  assert.strictEqual(calls.length, 0, "alice has no subscriptions — bob's must not be sent to");
});

test('sendPushToUser reaches every device the user is subscribed on — phone AND laptop, same account', async () => {
  // There's no way to know which device the customer is actually looking at
  // right now, so a single account's subscriptions (one per browser/device,
  // keyed by their own unique endpoint — see the saveSubscription test
  // above) must ALL get the same push in parallel, not just the most recent.
  const u = await makeUser('push-multidevice@test.local');
  await webPush.saveSubscription(u, { endpoint: 'https://push.example/phone', keys: keys1 });
  await webPush.saveSubscription(u, { endpoint: 'https://push.example/laptop', keys: keys2 });

  const calls = [];
  const original = pushTransport.sendNotification;
  pushTransport.sendNotification = async (sub) => {
    calls.push(sub.endpoint);
    return { statusCode: 201 };
  };
  let summary;
  try {
    summary = await webPush.sendPushToUser(u, { title: 'hi' });
  } finally {
    pushTransport.sendNotification = original;
  }

  assert.strictEqual(summary.devices, 2);
  assert.strictEqual(summary.delivered, 2);
  assert.deepStrictEqual(calls.sort(), ['https://push.example/laptop', 'https://push.example/phone']);
});
