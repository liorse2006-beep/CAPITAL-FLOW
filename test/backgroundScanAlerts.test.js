// Regression test for a critical silent bug found in the pre-launch audit:
// backgroundScan.js's checkWatchlistAlerts() called the async
// getAllAlertsGrouped() without awaiting it, so `byUser` was a Promise and
// Object.entries(byUser) always produced []. Every watchlist volume-spike
// alert silently never fired in production, with no error anywhere (the
// surrounding try/catch had nothing to catch). This test proves a real
// alert set by a user actually results in a push notification when a scan
// result crosses that user's threshold.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');

before(async () => { await db.ready; });

const { setAlert, getWatchlistAlerts } = require('../server/services/watchlistAlerts');
const webPush = require('../server/services/webPush');
const { checkWatchlistAlerts } = require('../server/services/backgroundScan');

async function makeUser(email) {
  const result = await db.prepare('INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, \'elite\', 1)').run(email);
  return result.lastInsertRowid;
}

test('checkWatchlistAlerts fires a push when a real threshold is crossed', async () => {
  const userId = await makeUser('bg-alert-fire@test.local');
  await setAlert(userId, 'AAPL', { type: 'volume', minRatio: 2.0 });

  const pushCalls = [];
  const originalSend = webPush.sendPushToUser;
  webPush.sendPushToUser = (uid, payload) => {
    pushCalls.push({ uid, payload });
  };

  try {
    await checkWatchlistAlerts([
      { symbol: 'AAPL', name: 'Apple', volumeRatio: 3.5, change: 1.2, price: 150 },
    ]);
    assert.strictEqual(pushCalls.length, 1, 'expected one push notification to fire for the crossed threshold');
    assert.strictEqual(pushCalls[0].uid, userId);
    assert.strictEqual(pushCalls[0].payload.symbol, 'AAPL');
  } finally {
    webPush.sendPushToUser = originalSend;
  }
});

test('checkWatchlistAlerts is one-shot: firing cancels the threshold so it never re-fires', async () => {
  const userId = await makeUser('bg-alert-oneshot@test.local');
  await setAlert(userId, 'TSLA', { type: 'volume', minRatio: 2.0 });

  const pushCalls = [];
  const originalSend = webPush.sendPushToUser;
  webPush.sendPushToUser = (uid, payload) => {
    pushCalls.push({ uid, payload });
  };

  try {
    const spikedResult = [{ symbol: 'TSLA', name: 'Tesla', volumeRatio: 4.0, change: 2.5, price: 250 }];

    await checkWatchlistAlerts(spikedResult);
    assert.strictEqual(pushCalls.length, 1, 'first crossing should fire');

    const remaining = await getWatchlistAlerts(userId);
    assert.strictEqual(remaining.TSLA, undefined, 'the threshold must be cancelled once it fires');

    // A later cycle where the ratio is still elevated (the real-world case
    // that used to spam a push every cycle) must not fire again.
    await checkWatchlistAlerts(spikedResult);
    assert.strictEqual(pushCalls.length, 1, 'a second cycle with the ratio still elevated must not re-fire');
  } finally {
    webPush.sendPushToUser = originalSend;
  }
});

test('checkWatchlistAlerts does not fire when the ratio is below threshold', async () => {
  const userId = await makeUser('bg-alert-nofire@test.local');
  await setAlert(userId, 'MSFT', { type: 'volume', minRatio: 5.0 });

  const pushCalls = [];
  const originalSend = webPush.sendPushToUser;
  webPush.sendPushToUser = (uid, payload) => {
    pushCalls.push({ uid, payload });
  };

  try {
    await checkWatchlistAlerts([
      { symbol: 'MSFT', name: 'Microsoft', volumeRatio: 1.2, change: 0.3, price: 300 },
    ]);
    assert.strictEqual(pushCalls.length, 0, 'a ratio below threshold must not fire an alert');
  } finally {
    webPush.sendPushToUser = originalSend;
  }
});

test('checkWatchlistAlerts fires a price alert once the price crosses to the other side of the target', async () => {
  const userId = await makeUser('bg-alert-price-fire@test.local');
  // Set while the price is below the target — starting_side is recorded as
  // 'below', so the checker should stay quiet until price actually crosses
  // to 'above', not just because it's already past the target at set-time.
  await setAlert(userId, 'GME', { type: 'price', targetPrice: 30, startingSide: 'below' });

  const pushCalls = [];
  const originalSend = webPush.sendPushToUser;
  webPush.sendPushToUser = (uid, payload) => {
    pushCalls.push({ uid, payload });
  };

  try {
    await checkWatchlistAlerts([{ symbol: 'GME', name: 'GameStop', volumeRatio: 1.0, change: 0.5, price: 28 }]);
    assert.strictEqual(pushCalls.length, 0, 'still below the target — must not fire yet');

    await checkWatchlistAlerts([{ symbol: 'GME', name: 'GameStop', volumeRatio: 1.0, change: 8.0, price: 31.5 }]);
    assert.strictEqual(pushCalls.length, 1, 'crossed above the target — must fire exactly once');
    assert.strictEqual(pushCalls[0].payload.symbol, 'GME');

    const remaining = await getWatchlistAlerts(userId);
    assert.strictEqual(remaining.GME, undefined, 'the price alert must be cancelled once it fires');
  } finally {
    webPush.sendPushToUser = originalSend;
  }
});
