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
    { results: { market_cap: 5_000_000_000, last_updated_utc: '2026-09-09T00:00:00.000Z' } },
    { status: 'DELAYED', results: bars }
  );

  assert.equal(metrics.marketCap, 5_000_000_000);
  assert.equal(metrics.avgVol10d, 1_004_500);
  assert.equal(metrics.latestClose, 109);
  assert.equal(metrics.delayed, true);
  assert.match(metrics.dataAsOf, /^2026-08-29T00:00:00\.000Z$/);
  assert.equal(normalizeMassiveMetrics({ results: { market_cap: 5 } }, { results: bars.slice(0, 9) }), null);
});
