// HTTP-level chart safety tests. A chart must never turn an empty or malformed
// provider response into a successful-looking blank/current quote payload.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const db = require('../server/db');
const yahoo = require('../server/services/yahoo');
const { issueToken } = require('../server/services/auth');
const chartRouter = require('../server/routes/chart');

before(async () => {
  await db.ready;
});

async function makeUser(email) {
  const result = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'premium', 1)")
    .run(email);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  return (await issueToken(user)).accessToken;
}

function startTestApp() {
  const app = express();
  app.use('/api', chartRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function validCandle() {
  return {
    date: new Date('2026-08-31T15:00:00.000Z'),
    open: 99,
    high: 102,
    low: 98,
    close: 101,
    volume: 1000000,
  };
}

test('GET /api/chart returns unavailable when no complete historical candle exists', async (t) => {
  t.mock.method(yahoo, 'chart', async () => ({ quotes: [{ date: new Date(), close: 100 }] }));
  const token = await makeUser('chart-empty@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/chart/CHARTEMPTY`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(body.error, /not available right now/i);
  } finally {
    server.close();
  }
});

test('GET /api/chart does not expose a malformed Yahoo current price', async (t) => {
  t.mock.method(yahoo, 'chart', async () => ({ quotes: [validCandle()] }));
  t.mock.method(yahoo, 'quote', async () => ({ symbol: 'BADPRICE', regularMarketPrice: 'not-a-number' }));
  const token = await makeUser('chart-bad-price@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/chart/BADPRICE`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.quotes.length, 1);
    assert.equal(body.currentPrice, null);
  } finally {
    server.close();
  }
});
