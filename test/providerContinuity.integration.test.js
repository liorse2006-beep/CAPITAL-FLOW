require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const db = require('../server/db');
const yahoo = require('../server/services/yahoo');
const fmp = require('../server/services/fmp');
const scanner = require('../server/services/scanner');
const notifications = require('../server/services/notifications');
const { marketSignalNotificationFor } = require('../server/services/marketSignalNotification');

test('three actual local scan/persistence cycles preserve outage, partial and recovered status', async (t) => {
  await db.ready;
  const user = await db
    .prepare("INSERT INTO users (email, is_verified, tier) VALUES (?, 1, 'elite')")
    .run('continuity@test.local');
  const userId = user.lastInsertRowid;
  let state = 'unavailable';
  let providerCalls = 0;
  t.mock.method(global, 'fetch', async () => {
    throw new Error('External network prohibited in continuity test');
  });
  t.mock.method(fmp, 'isConfigured', () => false);
  t.mock.method(yahoo, 'quoteSummary', async () => null);
  t.mock.method(yahoo, 'quote', async (symbols) => {
    providerCalls++;
    if (state === 'unavailable') throw new Error('Synthetic provider outage');
    return symbols
      .filter((symbol) => state !== 'partial' || symbol === 'FIXA')
      .map((symbol) => ({
        symbol,
        regularMarketPrice: 100,
        regularMarketVolume: 4000,
        averageDailyVolume10Day: 1000,
        regularMarketTime: Math.floor(Date.now() / 1000),
        currency: 'USD',
      }));
  });
  const report = [];
  for (const expected of ['unavailable', 'partial', 'complete']) {
    state = expected;
    const started = performance.now();
    const result = await scanner.quickScan(['FIXA', 'FIXB', ' fixa '], { withMetadata: true });
    const elapsed = performance.now() - started;
    assert.equal(result.dataStatus, expected);
    assert.equal(result.results.length, expected === 'unavailable' ? 0 : expected === 'partial' ? 1 : 2);
    assert.equal(new Set(result.results.map((row) => row.symbol)).size, result.results.length);
    assert.ok(
      result.results.every((row) => row.quoteDataStatus === 'complete' && Number.isFinite(Date.parse(row.quoteAsOf)))
    );
    assert.equal(result.dataAsOf === null, expected === 'unavailable');
    const copy = marketSignalNotificationFor(result.results);
    const notificationId = await notifications.addNotification(userId, {
      ...copy,
      scanType: 'capitalFlow',
      results: result.results,
      dataStatus: result.dataStatus,
      dataAsOf: result.dataAsOf,
    });
    const saved = await notifications.getNotificationDetail(userId, notificationId);
    assert.equal(saved.dataStatus, expected);
    assert.equal((saved.results || []).length, result.results.length);
    assert.equal(
      saved.body,
      result.results.length
        ? 'New market signal detected. Open Capital Flow to view it.'
        : "We couldn't verify a market signal this time."
    );
    assert.equal(await notifications.getNotificationDetail(userId + 100000, notificationId), undefined);
    report.push({
      cycle: report.length + 1,
      requested: 2,
      verified: result.results.length,
      coverage: result.results.length / 2,
      timestamp: result.dataAsOf,
      results: result.results.length,
      providerStatus: expected,
      elapsedMs: Number(elapsed.toFixed(3)),
      notificationId,
      verdict: 'PASS',
    });
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').get(userId)).n, 3);
  t.diagnostic(
    JSON.stringify({
      mode: 'isolated synthetic provider fault injection; not production recovery time',
      providerCalls,
      cycles: report,
    })
  );
});

test('a malformed optional number is never fabricated and duplicate input yields one result', async (t) => {
  t.mock.method(yahoo, 'quote', async () => [
    {
      symbol: 'STRICT',
      regularMarketPrice: 100,
      regularMarketVolume: 1000,
      averageDailyVolume10Day: false,
      regularMarketChangePercent: false,
      regularMarketTime: Math.floor(Date.now() / 1000),
    },
  ]);
  t.mock.method(fmp, 'isConfigured', () => false);
  const result = await scanner.quickScan(['STRICT', ' strict ', 'STRICT'], { withMetadata: true });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].change, null);
  assert.equal(result.results[0].avgVolume, null);
  assert.equal(result.results[0].volumeRatio, null);
});
