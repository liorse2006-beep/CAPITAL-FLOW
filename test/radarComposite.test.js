const test = require('node:test');
const assert = require('node:assert/strict');
const { resultMatchesRadar, evaluateRadarTransitions } = require('../server/services/radarLogic');

const universe = {
  sp500: new Set(['AAPL']),
  nasdaq100: new Set(['AAPL']),
};

const radar = {
  mode: 'all',
  selectedSectors: [],
  minVolumeRatio: 1.5,
  minMarketCap: 500_000_000,
  minVolume: 0,
  minPrice: 0,
  maxPrice: 0,
  maPeriod: 150,
  maDistance: 1,
  maInterval: '1d',
  maDirection: 'above',
};

function row(overrides = {}) {
  return {
    symbol: 'AAPL',
    price: 190,
    volume: 4_000_000,
    avgVolume: 2_000_000,
    volumeRatio: 2,
    marketCap: 2_000_000_000_000,
    sector: 'Technology',
    maValue: 189,
    maDistance: 0.53,
    maPeriod: 150,
    maInterval: '1d',
    maDirection: 'above',
    ...overrides,
  };
}

test('Radar is an AND of Capital Flow and the selected moving-average condition', () => {
  assert.equal(resultMatchesRadar(row(), radar, universe), true);
  assert.equal(resultMatchesRadar(row({ maDistance: 1.01 }), radar, universe), false);
  assert.equal(resultMatchesRadar(row({ maDirection: 'below', maDistance: -0.4 }), radar, universe), false);
  assert.equal(resultMatchesRadar(row({ volumeRatio: 1.4 }), radar, universe), false);
  assert.equal(resultMatchesRadar(row({ maValue: null }), radar, universe), false);
});
test('Partial composite data does not create a false exit or re-entry', () => {
  const state = new Map([
    ['AAPL', { matches: true, enteredAt: '2026-08-25T12:00:00.000Z', lastSeenAt: '2026-08-25T12:00:00.000Z' }],
  ]);
  const result = evaluateRadarTransitions(radar, [], state, {
    scanTime: '2026-08-25T12:30:00.000Z',
    dataStatus: 'partial',
    unavailableSymbols: ['AAPL'],
    checkedSymbols: [],
    universe,
  });
  assert.equal(result.events.length, 0);
  assert.equal(result.nextStates.get('AAPL').matches, true);
  assert.equal(result.nextStates.get('AAPL').missedChecks, 0);
});
