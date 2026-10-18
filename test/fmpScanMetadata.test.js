require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createScanMetadataLoader, tenSessionAverage } = require('../server/services/fmpScanMetadata');
const { previousTradingDateKey } = require('../server/services/marketCalendar');

const date = '2026-10-13';
const quote = {
  symbol: 'AAPL',
  currency: null,
  averageDailyVolume10Day: null,
  regularMarketTime: Date.parse(`${date}T15:00:00Z`) / 1000,
};
function history() {
  const rows = [{ symbol: quote.symbol, date, volume: 0 }];
  let session = date;
  for (let index = 1; index <= 10; index++) {
    session = previousTradingDateKey(session);
    rows.push({ symbol: quote.symbol, date: session, volume: index * 10 });
  }
  return rows;
}

test('volume baseline excludes the current incomplete session and requires ten contiguous trading sessions', () => {
  assert.equal(tenSessionAverage(history(), quote.symbol, date), 55);
  for (const rows of [
    history().slice(0, 10),
    [...history(), history()[1]],
    history().map((row, index) => (index === 1 ? { ...row, symbol: 'META' } : row)),
    history().map((row, index) => (index === 1 ? { ...row, volume: true } : row)),
    [...history(), { symbol: 'AAPL', date: '2026-10-14', volume: 100 }],
  ]) {
    assert.equal(tenSessionAverage(rows, quote.symbol, date), null);
  }
});

test('metadata refuses a weekend quote without inventing a trading-session baseline', async () => {
  assert.equal(tenSessionAverage(history(), quote.symbol, '2026-10-18'), null);
  let requests = 0;
  const loader = createScanMetadataLoader(async () => {
    requests++;
    return history();
  });
  const [result] = await loader.enrich([
    { ...quote, currency: 'USD', regularMarketTime: Date.parse('2026-10-18T18:00:00Z') / 1000 },
  ]);
  assert.equal(result.averageDailyVolume10Day, null);
  assert.equal(requests, 0);
});

test('metadata never invents USD for a mismatched or unknown company profile', async () => {
  for (const profile of [
    { symbol: 'META', currency: 'USD' },
    { symbol: 'AAPL' },
    { symbol: 'AAPL', currency: 'EUR' },
  ]) {
    let requests = 0;
    const loader = createScanMetadataLoader(async () => {
      requests++;
      return [profile];
    });
    const [result] = await loader.enrich([quote]);
    assert.equal(result.currency, null);
    assert.equal(result.averageDailyVolume10Day, null);
    assert.equal(requests, 1);
  }
});

test('concurrent metadata work shares a bounded cached lookup without changing quote time', async () => {
  let requests = 0;
  const loader = createScanMetadataLoader(async (path) => {
    requests++;
    return path.startsWith('/profile?') ? [{ symbol: 'AAPL', currency: 'USD' }] : history();
  });
  const results = await Promise.all([loader.enrich([quote]), loader.enrich([quote]), loader.enrich([quote])]);
  assert.equal(requests, 2);
  for (const [result] of results) {
    assert.equal(result.currency, 'USD');
    assert.equal(result.averageDailyVolume10Day, 55);
    assert.equal(result.regularMarketTime, quote.regularMarketTime);
  }
  await loader.enrich([quote]);
  assert.equal(requests, 2);
});

test('failed metadata is cached briefly and remains missing, not zero or synthetic', async () => {
  let requests = 0;
  const loader = createScanMetadataLoader(async () => {
    requests++;
    throw new Error('provider unavailable');
  });
  const [result] = await loader.enrich([quote]);
  await loader.enrich([quote]);
  assert.equal(requests, 1);
  assert.equal(result.currency, null);
  assert.equal(result.averageDailyVolume10Day, null);
});

test('one metadata enrichment is limited to 25 symbols and two concurrent requests', async () => {
  let requests = 0;
  let active = 0;
  let maxActive = 0;
  const loader = createScanMetadataLoader(async () => {
    requests++;
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return null;
  });
  const rows = Array.from({ length: 100 }, (_, index) => ({ ...quote, symbol: `TEST${index}` }));
  const result = await loader.enrich(rows);
  assert.equal(requests, 25);
  assert.equal(maxActive, 2);
  assert.equal(result.length, 100);
});
