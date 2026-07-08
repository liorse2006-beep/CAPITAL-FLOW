// Regression test for the cross-account leak fixed on this branch:
// watchlist alert thresholds used to live in one shared JSON file with no
// user_id, so every signed-in user saw and could overwrite everyone else's
// alerts. They must now be fully isolated per user_id in SQLite.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');
const {
  getWatchlistAlerts, setAlert, removeAlert, clearAlerts, getAllAlertsGrouped,
} = require('../server/services/watchlistAlerts');

function makeUser(email) {
  return db.prepare('INSERT INTO users (email, is_verified, is_premium) VALUES (?, 1, 1)').run(email).lastInsertRowid;
}

test('alerts set by one user are invisible to another', () => {
  const alice = makeUser('alice@test.local');
  const bob   = makeUser('bob@test.local');

  setAlert(alice, 'AAPL', 2.5);

  assert.deepStrictEqual(getWatchlistAlerts(alice), { AAPL: 2.5 });
  assert.deepStrictEqual(getWatchlistAlerts(bob), {}, "bob must not see alice's alert");
});

test('updating an alert overwrites only that user + symbol', () => {
  const carl = makeUser('carl@test.local');
  setAlert(carl, 'TSLA', 3);
  setAlert(carl, 'TSLA', 5); // update
  assert.deepStrictEqual(getWatchlistAlerts(carl), { TSLA: 5 });
});

test('removeAlert only removes the specified user + symbol', () => {
  const dana = makeUser('dana@test.local');
  const erin = makeUser('erin@test.local');
  setAlert(dana, 'NVDA', 2);
  setAlert(erin, 'NVDA', 2);

  removeAlert(dana, 'NVDA');

  assert.deepStrictEqual(getWatchlistAlerts(dana), {});
  assert.deepStrictEqual(getWatchlistAlerts(erin), { NVDA: 2 }, "erin's alert must survive dana's removal");
});

test('clearAlerts only clears the specified user', () => {
  const frank = makeUser('frank@test.local');
  const gina  = makeUser('gina@test.local');
  setAlert(frank, 'MSFT', 2);
  setAlert(gina, 'MSFT', 2);

  clearAlerts(frank);

  assert.deepStrictEqual(getWatchlistAlerts(frank), {});
  assert.deepStrictEqual(getWatchlistAlerts(gina), { MSFT: 2 });
});

test('getAllAlertsGrouped groups every alert under its owning user id', () => {
  const hank = makeUser('hank@test.local');
  const ivy  = makeUser('ivy@test.local');
  setAlert(hank, 'AMD', 1.5);
  setAlert(ivy, 'AMD', 4);

  const grouped = getAllAlertsGrouped();
  assert.strictEqual(grouped[hank].AMD, 1.5);
  assert.strictEqual(grouped[ivy].AMD, 4);
});
