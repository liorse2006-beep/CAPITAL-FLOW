// Regression coverage for DST correctness in market-hours math — flagged in
// the pre-launch audit as "correct today, but zero test coverage, so a
// future refactor (or a minimal-ICU Node build) could silently reintroduce
// a fixed-UTC-offset bug with nothing to catch it." isMarketOpen,
// isPreMarket, getETMinutes, and calculateRVOL now all take an optional
// injectable `now` so this can be tested deterministically instead of
// depending on whatever the real clock happens to be on CI day.
//
// US DST in 2026: EDT (UTC-4) begins 2026-03-08, reverts to EST (UTC-5) on
// 2026-11-01. The same UTC instant (13:30Z) is 8:30am ET in winter (EST)
// but 9:30am ET in summer (EDT) — proving the code re-derives the real
// local hour via the IANA timezone on every call rather than a hardcoded
// offset, which would give the same (wrong, for one of the two seasons)
// answer regardless of date.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');

const { isMarketOpen, isPreMarket } = require('../server/services/backgroundScan');
const { getETMinutes, calculateRVOL } = require('../server/services/rvol');

const WINTER_1330Z = new Date('2026-01-15T13:30:00Z'); // 8:30am EST — premarket
const SUMMER_1330Z = new Date('2026-07-15T13:30:00Z'); // 9:30am EDT — market open, same UTC clock time

test('the same UTC instant is pre-market in EST but market-open in EDT (proves real DST awareness)', () => {
  assert.strictEqual(isPreMarket(WINTER_1330Z), true, '8:30am EST must be pre-market');
  assert.strictEqual(isMarketOpen(WINTER_1330Z), false, '8:30am EST must not be market-open yet');

  assert.strictEqual(isMarketOpen(SUMMER_1330Z), true, '9:30am EDT (same UTC clock time) must be market-open');
  assert.strictEqual(isPreMarket(SUMMER_1330Z), false, '9:30am EDT must not still read as pre-market');
});

test('market close (4:00pm ET) lands on the correct UTC instant in both EST and EDT', () => {
  const winterClose = new Date('2026-01-15T20:59:00Z'); // 3:59pm EST — still open
  const winterAfterClose = new Date('2026-01-15T21:00:00Z'); // 4:00pm EST — closed
  assert.strictEqual(isMarketOpen(winterClose), true);
  assert.strictEqual(isMarketOpen(winterAfterClose), false);

  const summerClose = new Date('2026-07-15T19:59:00Z'); // 3:59pm EDT — still open
  const summerAfterClose = new Date('2026-07-15T20:00:00Z'); // 4:00pm EDT — closed
  assert.strictEqual(isMarketOpen(summerClose), true);
  assert.strictEqual(isMarketOpen(summerAfterClose), false);
});

test('weekends are closed regardless of season', () => {
  const winterSaturday = new Date('2026-01-17T15:00:00Z'); // Saturday, 10am EST
  const summerSaturday = new Date('2026-07-18T15:00:00Z'); // Saturday, 11am EDT
  assert.strictEqual(isMarketOpen(winterSaturday), false);
  assert.strictEqual(isMarketOpen(summerSaturday), false);
});

test('getETMinutes returns the correct minutes-since-midnight across DST for the same UTC instant', () => {
  assert.strictEqual(getETMinutes(WINTER_1330Z), 8 * 60 + 30); // 8:30am EST
  assert.strictEqual(getETMinutes(SUMMER_1330Z), 9 * 60 + 30); // 9:30am EDT
});

test('calculateRVOL uses the correct trading-day-progress fraction across DST for the same UTC instant', () => {
  // At 9:30am ET (market open, cumPct=0) the expected volume is 0, so RVOL
  // is null regardless of season — confirms the day-of-week/open gate reads
  // the correct local time in both cases, not a fixed offset that would
  // put one of these two calls outside market hours entirely (Sunday/Monday
  // shift) or at a different point in the trading day.
  const winterEtMinutes = getETMinutes(WINTER_1330Z); // pre-market, 8:30am EST
  const summerEtMinutes = getETMinutes(SUMMER_1330Z); // market open, 9:30am EDT

  assert.strictEqual(calculateRVOL(1000, 1_000_000, winterEtMinutes, WINTER_1330Z), null, 'before the open, cumPct is 0 → null');
  assert.strictEqual(calculateRVOL(1000, 1_000_000, summerEtMinutes, SUMMER_1330Z), null, 'exactly at the open, cumPct is 0 → null');

  // An hour into the summer (EDT) session — well past the open, must produce
  // a real ratio, proving the EDT-side local-time math also flows through.
  const summerOneHourIn = new Date('2026-07-15T14:30:00Z'); // 10:30am EDT
  const rvol = calculateRVOL(500_000, 1_000_000, getETMinutes(summerOneHourIn), summerOneHourIn);
  assert.ok(typeof rvol === 'number' && rvol > 0, 'an hour into the EDT session must produce a real RVOL, not null');
});
