const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REARM_AFTER_MISSED_SCANS,
  resultMatchesRadar,
  evaluateRadarTransitions,
} = require('../server/services/radarLogic');

const universe = {
  sp500: new Set(['AAPL', 'MSFT']),
  nasdaq100: new Set(['AAPL', 'NVDA']),
};

const radar = {
  mode: 'all',
  selectedSectors: [],
  minVolumeRatio: 1.5,
  minMarketCap: 500_000_000,
  minVolume: 0,
  minPrice: 0,
  maxPrice: 0,
  maPeriod: 20,
  maDistance: 2,
  maInterval: '1d',
  maDirection: 'all',
};

function row(overrides = {}) {
  return {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    price: 190,
    change: 1.2,
    volume: 4_000_000,
    avgVolume: 2_000_000,
    volumeRatio: 2,
    marketCap: 2_000_000_000_000,
    sector: 'Technology',
    maValue: 185,
    maDistance: 2,
    maPeriod: 20,
    maInterval: '1d',
    maDirection: 'above',
    ...overrides,
  };
}

test('Radar matches only a complete row that satisfies every saved threshold', () => {
  assert.equal(resultMatchesRadar(row(), radar, universe), true);
  assert.equal(resultMatchesRadar(row({ volumeRatio: 1.49 }), radar, universe), false);
  assert.equal(resultMatchesRadar(row({ price: null }), radar, universe), false);
  assert.equal(resultMatchesRadar(row({ marketCap: 0 }), radar, universe), false);
  assert.equal(resultMatchesRadar(row({ symbol: 'NVDA' }), { ...radar, mode: 'sp500' }, universe), false);
  assert.equal(
    resultMatchesRadar(
      row({ sector: 'Energy' }),
      { ...radar, mode: 'sectors', selectedSectors: ['Technology'] },
      universe
    ),
    false
  );
});

test('Radar Either mode accepts one complete signal layer but never accepts an incomplete row', () => {
  const either = { ...radar, conditionMode: 'either' };
  assert.equal(
    resultMatchesRadar(row({ maValue: null, maDistance: null, maPeriod: null, maInterval: null }), either, universe),
    true
  );
  assert.equal(resultMatchesRadar(row({ volumeRatio: null }), either, universe), true);
  assert.equal(
    resultMatchesRadar(
      row({ volumeRatio: null, maValue: null, maDistance: null, maPeriod: null, maInterval: null }),
      either,
      universe
    ),
    false
  );
  assert.equal(
    resultMatchesRadar(
      row({ volumeRatio: 1.4, maValue: null, maDistance: null, maPeriod: null, maInterval: null }),
      either,
      universe
    ),
    false
  );
});

test('Radar Either mode records which layer triggered the entry', () => {
  const either = { ...radar, conditionMode: 'either' };
  const result = evaluateRadarTransitions(
    either,
    [row({ maValue: null, maDistance: null, maPeriod: null, maInterval: null })],
    new Map(),
    { scanTime: '2026-08-25T12:00:00.000Z', universe }
  );
  assert.deepEqual(result.events[0].matchedConditions, ['Capital Flow']);
});

test('Radar emits once on a new entry and does not repeat while the row remains matched', () => {
  const first = evaluateRadarTransitions(radar, [row()], new Map(), {
    scanTime: '2026-08-25T12:00:00.000Z',
    universe,
  });
  assert.equal(first.available, true);
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].reentry, false);

  const second = evaluateRadarTransitions(radar, [row()], first.nextStates, {
    scanTime: '2026-08-25T12:15:00.000Z',
    universe,
  });
  assert.equal(second.events.length, 0);
  assert.equal(second.nextStates.get('AAPL').matches, true);
});

test('Radar rearms only after two completed misses, then emits on a real re-entry', () => {
  const first = evaluateRadarTransitions(radar, [row()], new Map(), {
    scanTime: '2026-08-25T12:00:00.000Z',
    universe,
  });
  const missOne = evaluateRadarTransitions(radar, [], first.nextStates, {
    scanTime: '2026-08-25T12:15:00.000Z',
    universe,
  });
  assert.equal(missOne.nextStates.get('AAPL').matches, true);
  const missTwo = evaluateRadarTransitions(radar, [], missOne.nextStates, {
    scanTime: '2026-08-25T12:30:00.000Z',
    universe,
  });
  assert.equal(missTwo.nextStates.get('AAPL').matches, false);
  assert.equal(missTwo.nextStates.get('AAPL').missedChecks, REARM_AFTER_MISSED_SCANS);

  const reentry = evaluateRadarTransitions(radar, [row()], missTwo.nextStates, {
    scanTime: '2026-08-25T12:45:00.000Z',
    universe,
  });
  assert.equal(reentry.events.length, 1);
  assert.equal(reentry.events[0].reentry, true);
});

test('Unavailable data never changes state and never creates a signal', () => {
  const state = new Map([['AAPL', { matches: true, enteredAt: '2026-08-25T12:00:00.000Z', missedChecks: 0 }]]);
  const result = evaluateRadarTransitions(radar, null, state, {
    scanTime: null,
    unavailableSymbols: ['AAPL'],
    universe,
  });
  assert.equal(result.available, false);
  assert.equal(result.events.length, 0);
  assert.deepEqual(result.nextStates.get('AAPL'), state.get('AAPL'));

  const partial = evaluateRadarTransitions(radar, [], state, {
    scanTime: '2026-08-25T12:15:00.000Z',
    unavailableSymbols: ['AAPL'],
    universe,
  });
  assert.equal(partial.available, true);
  assert.equal(partial.partial, true);
  assert.equal(partial.nextStates.get('AAPL').matches, true);
  assert.equal(partial.events.length, 0);
});
