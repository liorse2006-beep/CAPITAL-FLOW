const assert = require('node:assert/strict');
const { test } = require('node:test');
const { NASDAQ100, ALL_TICKERS } = require('../tickers');

test('NASDAQ-100 universe has unique symbols and current rebalance additions', () => {
  assert.equal(new Set(NASDAQ100).size, NASDAQ100.length);
  assert.ok(
    ['ALAB', 'CRWV', 'NBIS', 'RKLB', 'TER', 'PLTR', 'APP', 'AXON', 'SNDK', 'STX', 'SHOP', 'MSTR'].every((symbol) =>
      NASDAQ100.includes(symbol)
    )
  );
});

test('NASDAQ-100 universe does not contain removed symbols', () => {
  assert.ok(
    ['ANSS', 'CHTR', 'CTSH', 'INSM', 'SPLK', 'VRSK', 'WBA', 'ZS'].every((symbol) => !NASDAQ100.includes(symbol))
  );
});

test('live scan universe excludes known 2026 delistings and uses current ticker names', () => {
  assert.ok(
    ['BK', 'CMA', 'CTRA', 'DAY', 'EA', 'HOLX', 'MMC', 'SATS', 'SEE'].every((symbol) => !ALL_TICKERS.includes(symbol))
  );
  assert.ok(['BNY', 'ECHO', 'MRSH'].every((symbol) => ALL_TICKERS.includes(symbol)));
});
