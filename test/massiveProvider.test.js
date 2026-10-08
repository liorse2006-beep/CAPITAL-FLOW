require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMassiveMetrics, REQUIRED_VOLUME_BARS } = require('../server/services/massive');

test('Massive metrics require complete reference data and a ten-session volume window', () => {
  const bars = Array.from({ length: REQUIRED_VOLUME_BARS }, (_, index) => ({
    c: 100 + index,
    v: 1_000_000 + index * 1000,
    t: Date.parse(`2026-08-${String(20 + index).padStart(2, '0')}T00:00:00.000Z`),
  }));
  const metrics = normalizeMassiveMetrics(
    { results: { ticker: 'AAPL', market_cap: 5_000_000_000, last_updated_utc: '2026-09-09T00:00:00.000Z' } },
    { ticker: 'AAPL', status: 'DELAYED', results: bars }
  );

  assert.equal(metrics.marketCap, 5_000_000_000);
  assert.equal(metrics.avgVol10d, 1_004_500);
  assert.equal(metrics.latestClose, 109);
  assert.equal(metrics.delayed, true);
  assert.match(metrics.dataAsOf, /^2026-08-29T00:00:00\.000Z$/);
  assert.equal(normalizeMassiveMetrics({ results: { market_cap: 5 } }, { results: bars.slice(0, 9) }), null);
});

function fixture() {
  const reference = {
    status: 'OK',
    results: {
      ticker: 'AAPL',
      currency_name: 'usd',
      market_cap: 5_000_000_000,
      last_updated_utc: '2026-09-09T00:00:00.000Z',
    },
  };
  const aggregates = {
    ticker: 'AAPL',
    status: 'DELAYED',
    results: Array.from({ length: REQUIRED_VOLUME_BARS }, (_, i) => ({
      c: 100 + i,
      v: 1_000_000,
      t: Date.parse(`2026-08-${String(20 + i).padStart(2, '0')}T14:00:00.000Z`),
    })),
  };
  return { reference, aggregates };
}

test('Massive rejects coercible non-numeric prices, volumes, market caps and timestamps', () => {
  for (const invalid of [true, false, [], [1], {}, '', ' ', '0x10', 'Infinity', '1%']) {
    for (const field of ['c', 'v', 't', 'market_cap']) {
      const { reference, aggregates } = fixture();
      if (field === 'market_cap') reference.results.market_cap = invalid;
      else aggregates.results[0][field] = invalid;
      assert.equal(
        normalizeMassiveMetrics(reference, aggregates, 'AAPL'),
        null,
        `${field} must reject ${JSON.stringify(invalid)}`
      );
    }
  }
});

test('Massive rejects duplicate daily windows even when timestamps differ', () => {
  const { reference, aggregates } = fixture();
  aggregates.results[9] = { ...aggregates.results[0], t: aggregates.results[0].t + 1000 };
  assert.equal(normalizeMassiveMetrics(reference, aggregates, 'AAPL'), null);
});

test('Massive rejects wrong or missing ticker identity and explicit foreign currency', () => {
  for (const field of ['reference', 'aggregates']) {
    for (const wrong of ['MSFT', undefined, true]) {
      const { reference, aggregates } = fixture();
      if (field === 'reference') reference.results.ticker = wrong;
      else aggregates.ticker = wrong;
      assert.equal(normalizeMassiveMetrics(reference, aggregates, 'AAPL'), null);
    }
  }
  const { reference, aggregates } = fixture();
  reference.results.currency_name = 'eur';
  assert.equal(normalizeMassiveMetrics(reference, aggregates, 'AAPL'), null);
  reference.results.currency_name = true;
  assert.equal(normalizeMassiveMetrics(reference, aggregates, 'AAPL'), null);
});

test('Massive rejects future observations and quote-shaped error responses', () => {
  for (const kind of ['bar', 'reference', 'aggregateError', 'referenceError']) {
    const { reference, aggregates } = fixture();
    if (kind === 'bar') aggregates.results[0].t = Date.now() + 120_000;
    if (kind === 'reference') reference.results.last_updated_utc = new Date(Date.now() + 120_000).toISOString();
    if (kind === 'aggregateError') aggregates.status = 'ERROR';
    if (kind === 'referenceError') reference.status = 'ERROR';
    assert.equal(normalizeMassiveMetrics(reference, aggregates, 'AAPL'), null);
  }
});

test('Massive accepts numeric strings without turning daily data into a live quote', () => {
  const { reference, aggregates } = fixture();
  reference.results.market_cap = '5000000000';
  aggregates.results.forEach((bar) => {
    bar.c = String(bar.c);
    bar.v = String(bar.v);
    bar.t = String(bar.t);
  });
  const result = normalizeMassiveMetrics(reference, aggregates, ' aapl ');
  assert.equal(result.avgVol10d, 1_000_000);
  assert.equal(result.delayed, true);
  assert.equal(result.price, undefined);
  assert.equal(result.volume, undefined);
});
