// Per-user scan state + shared in-flight scans (server/routes/scan.js).
// The old design had ONE global scanState: a second user's scan got a 409,
// and /progress + /last-results showed whoever scanned last, to everyone.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');

before(async () => {
  await db.ready;
});

const { issueToken } = require('../server/services/auth');
const scanner = require('../server/services/scanner');
const scanRouter = require('../server/routes/scan');
const { backgroundCache } = require('../server/services/backgroundScan');

async function makeEliteUser(email) {
  const result = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
    .run(email);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  return { id: user.id, token: (await issueToken(user)).accessToken };
}

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', scanRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

const ROW = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  price: 190,
  change: 1.2,
  volume: 90e6,
  avgVolume: 30e6,
  volumeRatio: 3,
  rvol: null,
  marketCap: 3e12,
  sector: 'Technology',
  sparkline: [],
};

test('two different users scanning concurrently share ONE underlying scan and both get 200', async (t) => {
  backgroundCache.results = null;
  backgroundCache.scanTime = null;

  const gate = deferred();
  const mocked = t.mock.method(scanner, 'scanTickers', async () => {
    await gate.promise;
    return { results: [ROW], errors: [], processed: 500 };
  });

  const alice = await makeEliteUser('conc-alice@test.local');
  const bob = await makeEliteUser('conc-bob@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  const url = `http://localhost:${port}/api/scan?minVolumeRatio=1.5&minMarketCap=1000000000`;

  try {
    const aReq = fetch(url, { headers: { Authorization: 'Bearer ' + alice.token } });
    // Give Alice's request a beat to register the in-flight scan
    await new Promise((r) => setTimeout(r, 100));
    const bReq = fetch(url, { headers: { Authorization: 'Bearer ' + bob.token } });
    await new Promise((r) => setTimeout(r, 100));
    gate.resolve();

    const [aRes, bRes] = await Promise.all([aReq, bReq]);
    assert.strictEqual(aRes.status, 200, 'first user must get results');
    assert.strictEqual(bRes.status, 200, 'second user must NOT be blocked with a 409');
    const aData = await aRes.json();
    const bData = await bRes.json();
    assert.strictEqual(aData.results[0].symbol, 'AAPL');
    assert.strictEqual(bData.results[0].symbol, 'AAPL');
    assert.strictEqual(mocked.mock.callCount(), 1, 'the two concurrent requests must share one scan');
  } finally {
    server.close();
  }
});

test('the same user double-scanning still gets a 409 on the second request', async (t) => {
  backgroundCache.results = null;
  backgroundCache.scanTime = null;

  const gate = deferred();
  t.mock.method(scanner, 'scanTickers', async () => {
    await gate.promise;
    return { results: [], errors: [], processed: 500 };
  });

  const user = await makeEliteUser('conc-double@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  const url = `http://localhost:${port}/api/scan`;

  try {
    const first = fetch(url, { headers: { Authorization: 'Bearer ' + user.token } });
    await new Promise((r) => setTimeout(r, 100));
    const second = await fetch(url, { headers: { Authorization: 'Bearer ' + user.token } });
    assert.strictEqual(second.status, 409);
    gate.resolve();
    assert.strictEqual((await first).status, 200);
  } finally {
    server.close();
  }
});

test('each subscriber gets its own filtered view of the shared scan', async (t) => {
  backgroundCache.results = null;
  backgroundCache.scanTime = null;

  const cheap = { ...ROW, symbol: 'CHEAP', price: 4, marketCap: 600_000_000 };
  const gate = deferred();
  const mocked = t.mock.method(scanner, 'scanTickers', async () => {
    await gate.promise;
    return { results: [ROW, cheap], errors: [], processed: 500 };
  });

  const alice = await makeEliteUser('conc-filter-a@test.local');
  const bob = await makeEliteUser('conc-filter-b@test.local');
  const server = await startTestApp();
  const port = server.address().port;

  try {
    // Alice: everything above the floor. Bob: min price $10 — CHEAP excluded.
    const aReq = fetch(
      `http://localhost:${port}/api/scan?minVolumeRatio=1.5&minMarketCap=500000000`,
      { headers: { Authorization: 'Bearer ' + alice.token } }
    );
    await new Promise((r) => setTimeout(r, 100));
    const bReq = fetch(
      `http://localhost:${port}/api/scan?minVolumeRatio=1.5&minMarketCap=500000000&minPrice=10`,
      { headers: { Authorization: 'Bearer ' + bob.token } }
    );
    await new Promise((r) => setTimeout(r, 100));
    gate.resolve();

    const aData = await (await aReq).json();
    const bData = await (await bReq).json();
    assert.deepStrictEqual(aData.results.map((r) => r.symbol).sort(), ['AAPL', 'CHEAP']);
    assert.deepStrictEqual(bData.results.map((r) => r.symbol), ['AAPL'], "bob's minPrice filter must apply to his view only");
    assert.strictEqual(mocked.mock.callCount(), 1);
  } finally {
    server.close();
  }
});

test('/progress and /last-results are per-user — no bleed between accounts', async (t) => {
  backgroundCache.results = null;
  backgroundCache.scanTime = null;

  t.mock.method(scanner, 'scanTickers', async () => ({ results: [ROW], errors: [], processed: 500 }));

  const alice = await makeEliteUser('conc-iso-a@test.local');
  const bob = await makeEliteUser('conc-iso-b@test.local');
  const server = await startTestApp();
  const port = server.address().port;

  try {
    const scanRes = await fetch(`http://localhost:${port}/api/scan`, {
      headers: { Authorization: 'Bearer ' + alice.token },
    });
    assert.strictEqual(scanRes.status, 200);

    const aLast = await (
      await fetch(`http://localhost:${port}/api/last-results`, { headers: { Authorization: 'Bearer ' + alice.token } })
    ).json();
    assert.strictEqual(aLast.results.length, 1, 'alice sees her own scan');

    const bLast = await (
      await fetch(`http://localhost:${port}/api/last-results`, { headers: { Authorization: 'Bearer ' + bob.token } })
    ).json();
    assert.strictEqual(bLast.results, null, "bob must NOT see alice's results");

    const bProg = await (
      await fetch(`http://localhost:${port}/api/progress`, { headers: { Authorization: 'Bearer ' + bob.token } })
    ).json();
    assert.strictEqual(bProg.running, false);
    assert.deepStrictEqual(bProg.liveResults, []);
  } finally {
    server.close();
  }
});

test('a cache-served scan does not spend the premium 5/day quota', async (t) => {
  t.mock.method(scanner, 'scanTickers', async () => {
    throw new Error('cache hit must never reach the scanner');
  });

  // Fresh cache from "just now" so the fast path is taken even off-hours.
  backgroundCache.results = [ROW];
  backgroundCache.scanTime = new Date().toISOString();

  const result = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'premium', 1)")
    .run('conc-quota@test.local');
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = (await issueToken(user)).accessToken;

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/api/scan?minVolumeRatio=1.5&minMarketCap=500000000`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.fromCache, true);
    assert.strictEqual(data.premium.used, 0, 'cache hits must be free');

    const after = await db.prepare('SELECT premium_scan_count FROM users WHERE id = ?').get(user.id);
    assert.strictEqual(after.premium_scan_count || 0, 0);
  } finally {
    server.close();
    backgroundCache.results = null;
    backgroundCache.scanTime = null;
  }
});

test('a below-floor filter request runs its own private scan with the user filters', async (t) => {
  backgroundCache.results = null;
  backgroundCache.scanTime = null;

  const captured = [];
  t.mock.method(scanner, 'scanTickers', async (tickers, opts) => {
    captured.push(opts);
    return { results: [], errors: [], processed: 500 };
  });

  const user = await makeEliteUser('conc-floor@test.local');
  const server = await startTestApp();
  const port = server.address().port;

  try {
    const res = await fetch(`http://localhost:${port}/api/scan?minVolumeRatio=1.1`, {
      headers: { Authorization: 'Bearer ' + user.token },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(captured.length, 1);
    assert.strictEqual(captured[0].minVolumeRatio, 1.1, 'private scan must honor the below-floor ratio');
  } finally {
    server.close();
  }
});
