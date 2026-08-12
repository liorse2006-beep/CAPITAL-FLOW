// Shared in-flight MA scans (server/routes/maScanner.js's inFlightScans) —
// mirrors test/scanConcurrency.test.js's coverage of the same pattern for
// Capital Flow's joinSharedScan. Before this, N users hitting "Run MA Scan"
// with identical params within the same few seconds each independently
// walked the whole ~500-symbol universe.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');

before(async () => {
  await db.ready;
});

const { issueToken } = require('../server/services/auth');
const maScannerService = require('../server/services/maScanner');
const maScannerRouter = require('../server/routes/maScanner');

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
  app.use('/api', maScannerRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

const ROW = { symbol: 'AAPL', name: 'Apple Inc.', price: 190, maValue: 188, maDistance: 1.06, direction: 'above', daysSinceCross: 2 };

// server/routes/maScanner.js's resultCache/inFlightScans/scanProgress are
// module-level singletons — they persist for the lifetime of this process,
// across every test in this file (and every other file that happens to run
// in the same process). Each test below uses a param combination no other
// test in this file reuses, so a result cached by an earlier test can never
// silently short-circuit a later one before it even reaches scanMA.

test('two users running MA Scan with identical params concurrently share ONE underlying scan and both get 200', async (t) => {
  const gate = deferred();
  const mocked = t.mock.method(maScannerService, 'scanMA', async () => {
    await gate.promise;
    return { results: [ROW], processed: 500, qualified: 500 };
  });

  const alice = await makeEliteUser('ma-conc-alice@test.local');
  const bob = await makeEliteUser('ma-conc-bob@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  const url = `http://localhost:${port}/api/scan-ma?ma=20&distance=2&interval=1d&market=all`;

  try {
    const aReq = fetch(url, { headers: { Authorization: 'Bearer ' + alice.token } });
    // Give Alice's request a beat to register the in-flight scan before Bob joins it.
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

test('a different param combination does NOT join an unrelated in-flight scan', async (t) => {
  const gate = deferred();
  const calls = [];
  const mocked = t.mock.method(maScannerService, 'scanMA', async (tickers, opts) => {
    calls.push(opts.ma);
    await gate.promise;
    return { results: [ROW], processed: 500, qualified: 500 };
  });

  const alice = await makeEliteUser('ma-conc-diff-a@test.local');
  const bob = await makeEliteUser('ma-conc-diff-b@test.local');
  const server = await startTestApp();
  const port = server.address().port;

  try {
    const aReq = fetch(`http://localhost:${port}/api/scan-ma?ma=9&distance=1&interval=1d&market=all`, {
      headers: { Authorization: 'Bearer ' + alice.token },
    });
    await new Promise((r) => setTimeout(r, 100));
    // Bob asks for SMA150, not SMA9 — a genuinely different scan.
    const bReq = fetch(`http://localhost:${port}/api/scan-ma?ma=150&distance=1&interval=1d&market=all`, {
      headers: { Authorization: 'Bearer ' + bob.token },
    });
    await new Promise((r) => setTimeout(r, 100));
    gate.resolve();

    const [aRes, bRes] = await Promise.all([aReq, bReq]);
    assert.strictEqual(aRes.status, 200);
    assert.strictEqual(bRes.status, 200);
    assert.strictEqual(mocked.mock.callCount(), 2, 'different params must run their own scans, not share');
    assert.deepStrictEqual(calls.sort((a, b) => a - b), [9, 150]);
  } finally {
    server.close();
  }
});

test('the same user double-scanning still gets a 409 on the second request', async (t) => {
  const gate = deferred();
  t.mock.method(maScannerService, 'scanMA', async () => {
    await gate.promise;
    return { results: [], processed: 500, qualified: 500 };
  });

  const user = await makeEliteUser('ma-conc-double@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  const url = `http://localhost:${port}/api/scan-ma?ma=50&distance=2&interval=1wk&market=all`;

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

test('a joining subscriber sees live shared progress via its own /ma-progress poll', async (t) => {
  const gate = deferred();
  let sendProgress;
  t.mock.method(maScannerService, 'scanMA', async (tickers, opts) => {
    sendProgress = opts.onProgress;
    await gate.promise;
    return { results: [ROW], processed: 500, qualified: 500 };
  });

  const alice = await makeEliteUser('ma-conc-prog-a@test.local');
  const bob = await makeEliteUser('ma-conc-prog-b@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  const url = `http://localhost:${port}/api/scan-ma?ma=20&distance=1&interval=1wk&market=all`;

  try {
    const aReq = fetch(url, { headers: { Authorization: 'Bearer ' + alice.token } });
    await new Promise((r) => setTimeout(r, 100));
    const bReq = fetch(url, { headers: { Authorization: 'Bearer ' + bob.token } });
    await new Promise((r) => setTimeout(r, 100));

    sendProgress({ processed: 250, total: 500, found: 3, phase: 2 });

    const bProg = await (
      await fetch(`http://localhost:${port}/api/ma-progress`, { headers: { Authorization: 'Bearer ' + bob.token } })
    ).json();
    assert.strictEqual(bProg.running, true);
    assert.strictEqual(bProg.processed, 250, "bob (who only joined, didn't start it) must still see live progress");

    gate.resolve();
    await Promise.all([aReq, bReq]);
  } finally {
    server.close();
  }
});
