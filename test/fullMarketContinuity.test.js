require('./helpers/testEnv');
const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const db = require('../server/db');
const { retainFullMarketMatches, displayFullMarketScan } = require('../server/services/fullMarketContinuity');
const { backgroundCache, recordFullMarketScan, runBackgroundScan } = require('../server/services/backgroundScan');
const { issueToken } = require('../server/services/auth');
const scanner = require('../server/services/scanner');
const fmp = require('../server/services/fmp');
const scanRouter = require('../server/routes/scan');
const stream = require('../server/routes/stream');

before(async () => db.ready);

const first = Date.parse('2026-11-03T18:18:00Z');
const second = Date.parse('2026-11-03T18:41:00Z');
const observation = (symbol, quoteAsOf = '2026-11-03T18:12:33Z') => ({
  symbol,
  quoteAsOf,
  quoteDataStatus: 'complete',
  quoteProvider: 'internal',
  price: 175,
  volume: 35_500_000,
  avgVolume: 21_800_000,
  volumeRatio: 1.63,
  marketCap: 419_900_000_000,
});

test('partial scans recover checked matches from durable history, but not confirmed misses', async () => {
  const before = { results: [observation('PLTR'), observation('SHOP'), observation('SYY')], dataStatus: 'partial' };
  await retainFullMarketMatches(before, [], first - 60_000, first);

  // No in-memory rows from the first process are needed on the next run.
  const current = {
    results: [observation('CVS', '2026-11-03T18:40:14Z')],
    dataStatus: 'partial',
    checkedSymbols: ['CVS', 'SHOP', 'SYY'],
    staleSymbols: ['SYY'],
  };
  const { retained } = await retainFullMarketMatches(current, [], second - 60_000, second);
  const display = displayFullMarketScan(current, retained, second);
  assert.deepEqual(
    display.results.map((row) => row.symbol),
    ['CVS', 'PLTR', 'SYY']
  );
  assert.equal(display.dataStatus, 'partial');
  assert.equal(display.results[0].previousMatch, undefined);
  assert.equal(display.results[1].previousMatch, true);
  assert.equal(display.results[1].quoteDataStatus, 'stale');
  assert.equal(display.results[1].quoteAsOf, before.results[0].quoteAsOf);
  assert.equal(display.results[1].volume, before.results[0].volume);
  assert.ok(display.results.every((row) => !('quoteProvider' in row)));
  assert.equal(current.results.length, 1, 'do not modify the raw rows used for notifications');

  // A late scan must not overwrite the previous decision about SHOP.
  await retainFullMarketMatches(before, [], first, first);
  const outage = { results: [], dataStatus: 'unavailable', checkedSymbols: [] };
  const following = await retainFullMarketMatches(outage, [], second, second + 60_000);
  assert.deepEqual(
    following.retained.map((row) => row.symbol),
    ['CVS', 'PLTR', 'SYY']
  );
  assert.equal(displayFullMarketScan(outage, following.retained, second + 60_000).dataStatus, 'partial');

  // An actual complete no-match result invalidates history for the symbol.
  const recovered = { results: [], dataStatus: 'complete', checkedSymbols: ['CVS', 'PLTR', 'SYY'] };
  const verified = await retainFullMarketMatches(recovered, [], second + 2 * 60_000, second + 2 * 60_000);
  assert.deepEqual(verified.observed, []);
  assert.deepEqual(verified.retained, []);
});

test('display expires old, off-session, wrong-day or undated retained matches without rewriting timestamps', () => {
  const scan = { results: [], dataStatus: 'unavailable' };
  assert.deepEqual(
    displayFullMarketScan(
      scan,
      [
        observation('PLTR', '2026-11-02T20:55:00Z'),
        observation('SHOP', '2026-11-03T17:40:59Z'),
        observation('SYY', '2026-11-03T18:50:00Z'),
        observation('CVS', 'not a timestamp'),
      ],
      second
    ),
    { results: [], dataStatus: 'unavailable' }
  );

  const justBeforeOpen = Date.parse('2026-11-03T14:35:00Z');
  assert.deepEqual(displayFullMarketScan(scan, [observation('PLTR', '2026-11-03T14:10:00Z')], justBeforeOpen), {
    results: [],
    dataStatus: 'unavailable',
  });
});

test('manual All Markets scans and subsequent cache hits use marked continuity, while the raw cache does not', async (t) => {
  const start = Date.parse('2026-11-03T19:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: start });
  t.mock.method(fmp, 'isConfigured', () => true);
  await recordFullMarketScan(
    {
      results: [observation('PLTR', '2026-11-03T18:56:00Z')],
      errors: [],
      dataStatus: 'complete',
      checkedSymbols: ['PLTR'],
      quoteProvider: 'FMP',
    },
    start
  );
  t.mock.timers.setTime(start + 16 * 60_000);
  const current = observation('CVS', '2026-11-03T19:15:00Z');
  const dataAsOf = current.quoteAsOf;
  const scans = t.mock.method(scanner, 'scanTickers', async () => ({
    results: [current],
    errors: ['PLTR'],
    processed: 2,
    dataStatus: 'partial',
    checkedSymbols: ['CVS'],
    dataAsOf,
    quoteProvider: 'FMP',
  }));
  const { lastInsertRowid } = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
    .run('market-continuity@test.local');
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
  const token = (await issueToken(user)).accessToken;
  const app = express().use('/api', scanRouter);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const get = async (path) => {
    const response = await fetch(base + path, { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const result = await get('/scan');
    assert.deepEqual(
      result.results.map((row) => row.symbol),
      ['CVS', 'PLTR']
    );
    assert.equal(result.results[1].previousMatch, true);
    assert.equal(result.dataAsOf, dataAsOf);
    assert.equal(result.dataStatus, 'partial');
    assert.deepEqual(
      backgroundCache.results.map((row) => row.symbol),
      ['CVS']
    );
    const cached = await get('/scan');
    assert.equal(cached.fromCache, true);
    assert.deepEqual(cached.results, result.results);
    assert.deepEqual((await get('/last-results?scanId=' + cached.scanId)).results, cached.results);
    assert.equal(scans.mock.callCount(), 1);

    const privateRun = await get('/scan?minVolumeRatio=1');
    assert.equal(privateRun.fromCache, undefined);
    assert.deepEqual(privateRun.results, result.results);
    assert.deepEqual(
      backgroundCache.results.map((row) => row.symbol),
      ['CVS']
    );
    assert.equal(scans.mock.callCount(), 2);
  } finally {
    server.close();
  }
});

test('background display uses the manual defaults and retains matches without changing the raw snapshot', async (t) => {
  const firstRun = Date.parse('2026-11-03T19:40:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: firstRun });
  await recordFullMarketScan(
    {
      results: [observation('SHOP', '2026-11-03T19:39:00Z')],
      dataStatus: 'complete',
      checkedSymbols: ['SHOP'],
      quoteProvider: 'FMP',
    },
    firstRun
  );
  t.mock.timers.setTime(firstRun + 16 * 60_000);
  const observationTime = '2026-11-03T19:55:00Z';
  t.mock.method(scanner, 'scanTickers', async () => ({
    results: [observation('CVS', observationTime), { ...observation('SYY', observationTime), marketCap: 750_000_000 }],
    dataStatus: 'partial',
    checkedSymbols: ['CVS', 'SYY'],
    processed: 3,
    errors: ['SHOP'],
    dataAsOf: observationTime,
  }));
  const events = [];
  t.mock.method(stream, 'broadcast', (name, data) => events.push({ name, data }));
  await runBackgroundScan();
  const update = events.find((event) => event.name === 'scan-update').data;
  assert.deepEqual(
    update.results.map((row) => row.symbol),
    ['CVS', 'SHOP']
  );
  assert.equal(update.results[1].previousMatch, true);
  assert.equal(update.dataAsOf, observationTime);
  assert.deepEqual(
    backgroundCache.results.map((row) => row.symbol),
    ['CVS', 'SYY']
  );
  assert.deepEqual(backgroundCache.coverage, {
    requestedSymbols: 3,
    verifiedSymbols: 2,
    missingSymbols: 1,
    coveragePercent: 66.67,
  });
});
