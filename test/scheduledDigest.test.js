// Regression tests for the personal scheduled-scan digest: each user picks
// an Israel-local time; at that minute the alert copy must reflect whether
// the shared scan returned any rows, never whether a personal threshold matched.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');

const webpushLib = require('web-push');
const vapidKeys = webpushLib.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey;
process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;
process.env.VAPID_SUBJECT = 'mailto:test@test.local';

delete require.cache[require.resolve('../server/config')];
delete require.cache[require.resolve('../server/services/webPush')];
delete require.cache[require.resolve('../server/services/scheduledDigest')];

const db = require('../server/db');

before(async () => {
  await db.ready;
});

const { israelNow, buildDigestPayload, runDigestTick } = require('../server/services/scheduledDigest');
const { backgroundCache } = require('../server/services/backgroundScan');
const { setAlert } = require('../server/services/watchlistAlerts');
const webPush = require('../server/services/webPush');

async function makeUser(email) {
  const result = await db.prepare('INSERT INTO users (email, is_verified, is_premium) VALUES (?, 1, 1)').run(email);
  return result.lastInsertRowid;
}

test('israelNow returns HH:MM and YYYY-MM-DD shaped strings', () => {
  const now = israelNow();
  assert.match(now.hm, /^\d{2}:\d{2}$/);
  assert.match(now.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('buildDigestPayload uses the signal copy whenever at least one result exists', () => {
  const results = [{ symbol: 'AAA', volumeRatio: 1, quoteDataStatus: 'stale' }];
  const payload = buildDigestPayload(results);
  assert.strictEqual(payload.title, 'Market Signal Detected');
  assert.strictEqual(payload.body, 'New market signal detected. Open Capital Flow to view it.');
});

test('buildDigestPayload uses the unverified copy only when the result list is empty', () => {
  const payload = buildDigestPayload([]);
  assert.strictEqual(payload.title, 'Capital Flow');
  assert.strictEqual(payload.body, "We couldn't verify a market signal this time.");
});

test('buildDigestPayload does not let partial status or unusable fields hide an existing row', () => {
  const payload = buildDigestPayload([{ symbol: 'AAA', volumeRatio: 'not-a-number', dataStatus: 'partial' }]);
  assert.strictEqual(payload.title, 'Market Signal Detected');
  assert.strictEqual(payload.body, 'New market signal detected. Open Capital Flow to view it.');
});

test('buildDigestPayload treats a missing result list as empty', () => {
  const payload = buildDigestPayload(null);
  assert.strictEqual(payload.title, 'Capital Flow');
  assert.strictEqual(payload.body, "We couldn't verify a market signal this time.");
});

test('runDigestTick persists the matching scan rows and deep-links the push to them', async (t) => {
  const u = await makeUser('digest-results@test.local');
  const now = israelNow();
  await db.prepare('UPDATE users SET notification_time = ? WHERE id = ?').run(now.hm, u);
  await setAlert(u, 'AAA', { type: 'volume', minRatio: 10 });
  await webPush.saveSubscription(u, {
    endpoint: 'https://push.example/digest-results',
    keys: { p256dh: 'p', auth: 'a' },
  });

  const results = [{ symbol: 'AAA', volumeRatio: 2, dataStatus: 'partial' }];
  backgroundCache.results = results;
  backgroundCache.scanTime = new Date().toISOString();
  backgroundCache.dataStatus = 'partial';

  const pushMock = t.mock.method(webpushLib, 'sendNotification', async () => ({ statusCode: 201 }));
  await runDigestTick();

  const notification = await db
    .prepare('SELECT id, title, body, scan_type, results_json FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .get(u);
  assert.ok(notification);
  assert.strictEqual(notification.title, 'Market Signal Detected');
  assert.strictEqual(notification.body, 'New market signal detected. Open Capital Flow to view it.');
  assert.strictEqual(notification.scan_type, 'capitalFlow');
  assert.deepStrictEqual(JSON.parse(notification.results_json), results);
  assert.strictEqual(pushMock.mock.callCount(), 1);
  const pushPayload = JSON.parse(pushMock.mock.calls[0].arguments[1]);
  assert.strictEqual(pushPayload.data.url, '/scanner?notif=' + notification.id);
});

test('runDigestTick sends exactly one push per user per day, even if the tick fires twice', async () => {
  const u = await makeUser('digest-a@test.local');
  const now = israelNow();
  await db.prepare('UPDATE users SET notification_time = ? WHERE id = ?').run(now.hm, u);
  await setAlert(u, 'AAA', { type: 'volume', minRatio: 2 });
  await webPush.saveSubscription(u, { endpoint: 'https://push.example/digest-a', keys: { p256dh: 'p', auth: 'a' } });

  backgroundCache.results = [{ symbol: 'AAA', volumeRatio: 3 }];
  backgroundCache.scanTime = new Date().toISOString();
  backgroundCache.dataStatus = 'complete';

  let calls = 0;
  const original = webpushLib.sendNotification;
  webpushLib.sendNotification = async () => {
    calls++;
  };
  try {
    await runDigestTick();
    await runDigestTick();
  } finally {
    webpushLib.sendNotification = original;
  }

  assert.strictEqual(calls, 1, 'the same user must not be pushed twice for the same day');
});

test('runDigestTick skips users with no watchlist thresholds set', async () => {
  const u = await makeUser('digest-b@test.local');
  const now = israelNow();
  await db.prepare('UPDATE users SET notification_time = ? WHERE id = ?').run(now.hm, u);
  await webPush.saveSubscription(u, { endpoint: 'https://push.example/digest-b', keys: { p256dh: 'p', auth: 'a' } });

  backgroundCache.results = [{ symbol: 'AAA', volumeRatio: 3 }];
  backgroundCache.scanTime = new Date().toISOString();
  backgroundCache.dataStatus = 'complete';

  let calls = 0;
  const original = webpushLib.sendNotification;
  webpushLib.sendNotification = async () => {
    calls++;
  };
  try {
    await runDigestTick();
  } finally {
    webpushLib.sendNotification = original;
  }

  assert.strictEqual(calls, 0, 'a user with no thresholds has nothing to check, so no push should be sent');
});
