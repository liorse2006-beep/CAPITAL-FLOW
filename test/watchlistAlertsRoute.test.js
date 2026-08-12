// HTTP-level tests for POST /api/watchlist-alerts/:symbol — specifically the
// price-alert branch's server-side re-verification of the reference price.
// Regression for trusting a client-supplied referencePrice unconditionally:
// the route now re-fetches a live quote and uses THAT to decide starting_side,
// falling back to the client value only if the live fetch itself fails.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');

before(async () => {
  await db.ready;
});
const { issueToken } = require('../server/services/auth');
const { getWatchlistAlerts } = require('../server/services/watchlistAlerts');
const quoteCache = require('../server/services/quoteCache');
const watchlistAlertsRouter = require('../server/routes/watchlistAlerts');

async function makeEliteUser(email) {
  const result = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
    .run(email);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', watchlistAlertsRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('price alert uses the live-fetched quote for starting_side, ignoring a wrong client referencePrice', async (t) => {
  // Client claims the price is $10 (which would compute startingSide='below'
  // for a $50 target) but the live quote says $100 (well above the $50
  // target) — the stored starting_side must reflect the live price, proving
  // the client value alone can never control this security-relevant field.
  t.mock.method(quoteCache, 'getQuotes', async (symbols) => {
    const m = new Map();
    m.set(symbols[0], { symbol: symbols[0], regularMarketPrice: 100 });
    return m;
  });

  const user = await makeEliteUser('alert-live-quote@test.local');
  const token = (await issueToken(user)).accessToken;
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/watchlist-alerts/AAPL`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ type: 'price', targetPrice: 50, referencePrice: 10 }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(
      body.startingSide,
      'above',
      'must be computed from the live quote (100 > 50), not the client value (10 < 50)'
    );

    const alerts = await getWatchlistAlerts(user.id);
    assert.strictEqual(alerts.AAPL.startingSide, 'above');
  } finally {
    server.close();
  }
});

test('price alert falls back to the client referencePrice when the live quote fetch fails', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () => {
    throw new Error('Yahoo is down');
  });

  const user = await makeEliteUser('alert-quote-fallback@test.local');
  const token = (await issueToken(user)).accessToken;
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/watchlist-alerts/TSLA`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ type: 'price', targetPrice: 50, referencePrice: 10 }),
    });
    assert.strictEqual(res.status, 200, 'a live-fetch failure must not block setting the alert');
    const body = await res.json();
    assert.strictEqual(
      body.startingSide,
      'below',
      'must fall back to the client value (10 < 50) when live data is unavailable'
    );
  } finally {
    server.close();
  }
});

test('price alert falls back when the live quote has no usable price for the symbol', async (t) => {
  t.mock.method(quoteCache, 'getQuotes', async () => new Map()); // symbol not found

  const user = await makeEliteUser('alert-quote-missing@test.local');
  const token = (await issueToken(user)).accessToken;
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/watchlist-alerts/OBSCURE`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ type: 'price', targetPrice: 50, referencePrice: 60 }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(
      body.startingSide,
      'above',
      'falls back to the client value (60 > 50) when the symbol has no live quote'
    );
  } finally {
    server.close();
  }
});
