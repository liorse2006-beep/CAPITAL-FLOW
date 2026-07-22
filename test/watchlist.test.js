// Starred-ticker watchlist (server/services/watchlist.js + server/routes/watchlist.js).
// Cross-device sync depends on this being fully isolated per user_id, just
// like watchlist_alerts (see watchlistAlerts.isolation.test.js).
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');

before(async () => { await db.ready; });
const { issueToken } = require('../server/services/auth');
const { getWatchlist, addToWatchlist, removeFromWatchlist } = require('../server/services/watchlist');
const watchlistRouter = require('../server/routes/watchlist');

async function makeUser(email) {
  const result = await db.prepare('INSERT INTO users (email, is_verified, is_premium) VALUES (?, 1, 1)').run(email);
  return result.lastInsertRowid;
}

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', watchlistRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('tickers starred by one user are invisible to another', async () => {
  const alice = await makeUser('wl-alice@test.local');
  const bob = await makeUser('wl-bob@test.local');

  await addToWatchlist(alice, 'AAPL');

  assert.deepStrictEqual(await getWatchlist(alice), ['AAPL']);
  assert.deepStrictEqual(await getWatchlist(bob), [], "bob must not see alice's watchlist");
});

test('adding the same symbol twice does not duplicate it', async () => {
  const carl = await makeUser('wl-carl@test.local');
  await addToWatchlist(carl, 'TSLA');
  await addToWatchlist(carl, 'TSLA');
  assert.deepStrictEqual(await getWatchlist(carl), ['TSLA']);
});

test('removeFromWatchlist only removes the specified user + symbol', async () => {
  const dana = await makeUser('wl-dana@test.local');
  const erin = await makeUser('wl-erin@test.local');
  await addToWatchlist(dana, 'NVDA');
  await addToWatchlist(erin, 'NVDA');

  await removeFromWatchlist(dana, 'NVDA');

  assert.deepStrictEqual(await getWatchlist(dana), []);
  assert.deepStrictEqual(await getWatchlist(erin), ['NVDA'], "erin's ticker must survive dana's removal");
});

test('GET /api/watchlist requires auth', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/watchlist`);
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
  }
});

test('POST then GET /api/watchlist round-trips a starred ticker for the authenticated user', async () => {
  const user = await makeUser('wl-route@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  const headers = { Authorization: 'Bearer ' + (await issueToken(await db.prepare('SELECT * FROM users WHERE id = ?').get(user))) };
  try {
    const postRes = await fetch(`http://127.0.0.1:${port}/api/watchlist/msft`, { method: 'POST', headers });
    assert.strictEqual(postRes.status, 200);
    const postBody = await postRes.json();
    assert.strictEqual(postBody.symbol, 'MSFT', 'symbol is normalized to uppercase');

    const getRes = await fetch(`http://127.0.0.1:${port}/api/watchlist`, { headers });
    assert.deepStrictEqual(await getRes.json(), ['MSFT']);

    const delRes = await fetch(`http://127.0.0.1:${port}/api/watchlist/MSFT`, { method: 'DELETE', headers });
    assert.strictEqual(delRes.status, 200);

    const getRes2 = await fetch(`http://127.0.0.1:${port}/api/watchlist`, { headers });
    assert.deepStrictEqual(await getRes2.json(), []);
  } finally {
    server.close();
  }
});

test('POST /api/watchlist/:symbol rejects an invalid symbol', async () => {
  const user = await makeUser('wl-invalid@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  const headers = { Authorization: 'Bearer ' + (await issueToken(await db.prepare('SELECT * FROM users WHERE id = ?').get(user))) };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/watchlist/${encodeURIComponent('not a symbol!')}`, {
      method: 'POST',
      headers,
    });
    assert.strictEqual(res.status, 400);
  } finally {
    server.close();
  }
});

test('the watchlist is capped at 50 tickers', async () => {
  const user = await makeUser('wl-cap@test.local');
  for (let i = 0; i < 50; i++) {
    await addToWatchlist(user, 'SYM' + i);
  }
  const server = await startTestApp();
  const port = server.address().port;
  const headers = { Authorization: 'Bearer ' + (await issueToken(await db.prepare('SELECT * FROM users WHERE id = ?').get(user))) };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/watchlist/OVERFLOW`, { method: 'POST', headers });
    assert.strictEqual(res.status, 400);
    const list = await getWatchlist(user);
    assert.strictEqual(list.length, 50);
    assert.ok(!list.includes('OVERFLOW'), 'the 51st symbol must not have been added');
  } finally {
    server.close();
  }
});
