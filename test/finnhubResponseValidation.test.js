require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseFinnhubQuote, parseFinnhubMetric } = require('../server/services/finnhub');

const NOW = Date.parse('2026-09-15T16:00:00.000Z');
const COMPLETE_QUOTE = {
  c: 100,
  d: 1.5,
  dp: 1.53,
  h: 101,
  l: 98,
  o: 99,
  pc: 98.5,
  t: Math.floor((NOW - 60_000) / 1000),
};

test('Finnhub quote is complete only when required quote fields and a fresh provider timestamp exist', () => {
  const result = parseFinnhubQuote(COMPLETE_QUOTE, NOW);

  assert.equal(result.dataStatus, 'complete');
  assert.deepEqual(result.missingFields, []);
  assert.equal(result.price, 100);
  assert.equal(result.dataAsOf, '2026-09-15T15:59:00.000Z');
});

test('Finnhub quote with missing optional fields is usable but explicitly partial', () => {
  const result = parseFinnhubQuote({ ...COMPLETE_QUOTE, h: null, dp: null }, NOW);

  assert.equal(result.dataStatus, 'partial');
  assert.deepEqual(result.missingFields, ['dp', 'h']);
  assert.equal(result.price, 100);
});

test('Finnhub quote without a trustworthy timestamp is rejected instead of appearing live', () => {
  assert.equal(parseFinnhubQuote({ ...COMPLETE_QUOTE, t: null }, NOW), null);
  assert.equal(parseFinnhubQuote({ ...COMPLETE_QUOTE, t: Math.floor((NOW - 25 * 60 * 60 * 1000) / 1000) }, NOW), null);
});

test('Finnhub metric reports missing scanner fields as partial and never invents zeroes', () => {
  const result = parseFinnhubMetric({ metric: { marketCapitalization: 1234 } });

  assert.equal(result.dataStatus, 'partial');
  assert.deepEqual(result.missingFields, ['avgVol10d']);
  assert.equal(result.marketCap, 1_234_000_000);
  assert.equal(result.avgVol10d, null);
});

test('Finnhub metric is complete only when market cap and average volume are present', () => {
  const result = parseFinnhubMetric({
    metric: {
      marketCapitalization: 1234,
      '10DayAverageTradingVolume': 5678,
      peTTM: 22,
    },
  });

  assert.equal(result.dataStatus, 'complete');
  assert.deepEqual(result.missingFields, []);
  assert.equal(result.marketCap, 1_234_000_000);
  assert.equal(result.avgVol10d, 5_678_000_000);
});
