// Regression test for the cross-account leak fixed on this branch:
// watchlist alert thresholds used to live in one shared JSON file with no
// user_id, so every signed-in user saw and could overwrite everyone else's
// alerts. They must now be fully isolated per user_id in SQLite.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');

before(async () => { await db.ready; });
const {
  getWatchlistAlerts,
  setAlert,
  removeAlert,
  clearAlerts,
  getAllAlertsGrouped,
} = require('../server/services/watchlistAlerts');

async function makeUser(email) {
  const result = await db.prepare('INSERT INTO users (email, is_verified, is_premium) VALUES (?, 1, 1)').run(email);
  return result.lastInsertRowid;
}

test('alerts set by one user are invisible to another', async () => {
  const alice = await makeUser('alice@test.local');
  const bob = await makeUser('bob@test.local');

  await setAlert(alice, 'AAPL', 2.5);

  assert.deepStrictEqual(await getWatchlistAlerts(alice), { AAPL: 2.5 });
  assert.deepStrictEqual(await getWatchlistAlerts(bob), {}, "bob must not see alice's alert");
});

test('updating an alert overwrites only that user + symbol', async () => {
  const carl = await makeUser('carl@test.local');
  await setAlert(carl, 'TSLA', 3);
  await setAlert(carl, 'TSLA', 5); // update
  assert.deepStrictEqual(await getWatchlistAlerts(carl), { TSLA: 5 });
});

test('removeAlert only removes the specified user + symbol', async () => {
  const dana = await makeUser('dana@test.local');
  const erin = await makeUser('erin@test.local');
  await setAlert(dana, 'NVDA', 2);
  await setAlert(erin, 'NVDA', 2);

  await removeAlert(dana, 'NVDA');

  assert.deepStrictEqual(await getWatchlistAlerts(dana), {});
  assert.deepStrictEqual(await getWatchlistAlerts(erin), { NVDA: 2 }, "erin's alert must survive dana's removal");
});

test('clearAlerts only clears the specified user', async () => {
  const frank = await makeUser('frank@test.local');
  const gina = await makeUser('gina@test.local');
  await setAlert(frank, 'MSFT', 2);
  await setAlert(gina, 'MSFT', 2);

  await clearAlerts(frank);

  assert.deepStrictEqual(await getWatchlistAlerts(frank), {});
  assert.deepStrictEqual(await getWatchlistAlerts(gina), { MSFT: 2 });
});

test('getAllAlertsGrouped groups every alert under its owning user id', async () => {
  const hank = await makeUser('hank@test.local');
  const ivy = await makeUser('ivy@test.local');
  await setAlert(hank, 'AMD', 1.5);
  await setAlert(ivy, 'AMD', 4);

  const grouped = await getAllAlertsGrouped();
  assert.strictEqual(grouped[hank].AMD, 1.5);
  assert.strictEqual(grouped[ivy].AMD, 4);
});
