// Regression tests for the personal scheduled-scan digest: each user picks
// a time (Israel local); at that minute they get exactly one push summarizing
// which of their watchlist thresholds were crossed — never zero, never twice.
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

test('buildDigestPayload uses the concise signal copy when a threshold is crossed', () => {
  const results = [
    { symbol: 'AAA', volumeRatio: 3 },
    { symbol: 'BBB', volumeRatio: 1 }, // below its threshold — must not appear
  ];
  const payload = buildDigestPayload({ AAA: 2, BBB: 2 }, results, 'now');
  assert.strictEqual(payload.title, 'Market Signal Detected');
  assert.strictEqual(payload.body, 'New market signal detected. Open Capital Flow to view it.');
  assert.strictEqual(payload.matched, true);
});

test('buildDigestPayload reports clearly when nothing crossed the threshold', () => {
  const payload = buildDigestPayload({ AAA: 5 }, [{ symbol: 'AAA', volumeRatio: 1 }], '10:00');
  assert.strictEqual(payload.title, 'Capital Flow');
  assert.strictEqual(payload.body, 'No market signals found in this scan. Open Capital Flow to review.');
});

test('buildDigestPayload never formats a malformed volume ratio as invented numeric data', () => {
  const payload = buildDigestPayload({ AAA: 1 }, [{ symbol: 'AAA', volumeRatio: 'not-a-number' }], '10:00');
  assert.strictEqual(payload.matched, false);
  assert.strictEqual(payload.body, 'No market signals found in this scan. Open Capital Flow to review.');
});

test('buildDigestPayload uses the concise signal copy for a verified match in a partial digest', () => {
  const payload = buildDigestPayload(
    { AAA: 2 },
    [{ symbol: 'AAA', volumeRatio: 3, quoteDataStatus: 'complete' }],
    '10:00',
    'partial'
  );
  assert.strictEqual(payload.matched, true);
  assert.strictEqual(payload.title, 'Market Signal Detected');
  assert.strictEqual(payload.body, 'New market signal detected. Open Capital Flow to view it.');
  assert.doesNotMatch(payload.title, /Partial data/i);
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
