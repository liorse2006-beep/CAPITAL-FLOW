const test = require('node:test');
const assert = require('node:assert/strict');
const {
  holidayDates,
  isMarketOpen,
  isPreMarket,
  latestCompletedSessionDate,
} = require('../server/services/marketCalendar');

test('published early closes stop regular-session scans and complete the session at 13:00 New York time', () => {
  for (const [date, utcHour] of [
    ['2026-11-27', 18],
    ['2026-12-24', 18],
    ['2027-11-26', 18],
    ['2028-07-03', 17],
    ['2028-11-24', 18],
  ]) {
    const close = new Date(`${date}T${utcHour}:00:00.000Z`);
    assert.equal(isMarketOpen(new Date(close.getTime() - 60000)), true, date + ' before close');
    assert.equal(isMarketOpen(close), false, date + ' at close');
    assert.equal(latestCompletedSessionDate(close), date);
  }
});

test('Saturday New Year does not close the previous Friday', () => {
  assert.equal(holidayDates(2028).has('2027-12-31'), false);
  assert.equal(isMarketOpen(new Date('2027-12-31T18:30:00.000Z')), true);
  assert.equal(isMarketOpen(new Date('2028-01-03T15:00:00.000Z')), true);
});

test('market calendar includes recurring US equity closures', () => {
  const holidays = holidayDates(2026);
  assert.equal(holidays.has('2026-01-01'), true);
  assert.equal(holidays.has('2026-04-03'), true, 'Good Friday');
  assert.equal(holidays.has('2026-06-19'), true, 'Juneteenth');
  assert.equal(holidays.has('2026-11-26'), true, 'Thanksgiving');
  assert.equal(holidays.has('2026-12-25'), true);
});

test('market calendar handles daylight-saving offsets without moving the session', () => {
  assert.equal(isMarketOpen(new Date('2026-01-05T14:30:00.000Z')), true, '09:30 EST');
  assert.equal(isMarketOpen(new Date('2026-07-06T13:30:00.000Z')), true, '09:30 EDT');
  assert.equal(isPreMarket(new Date('2026-07-06T12:00:00.000Z')), true, '08:00 EDT');
  assert.equal(isMarketOpen(new Date('2026-07-04T14:00:00.000Z')), false, 'Saturday');
  assert.equal(isMarketOpen(new Date('2026-09-07T15:00:00.000Z')), false, 'Labor Day');
});

test('market calendar accepts operator-maintained exceptional closures', () => {
  const previousClosed = process.env.MARKET_CLOSED_DATES;
  const previousEarly = process.env.MARKET_EARLY_CLOSES;
  process.env.MARKET_CLOSED_DATES = '2026-08-10';
  process.env.MARKET_EARLY_CLOSES = '2026-08-11=13:00';
  try {
    assert.equal(isMarketOpen(new Date('2026-08-10T15:00:00.000Z')), false, 'configured full-day closure');
    assert.equal(isMarketOpen(new Date('2026-08-11T16:59:00.000Z')), true, 'before configured early close');
    assert.equal(isMarketOpen(new Date('2026-08-11T17:00:00.000Z')), false, 'at configured early close');
  } finally {
    if (previousClosed === undefined) delete process.env.MARKET_CLOSED_DATES;
    else process.env.MARKET_CLOSED_DATES = previousClosed;
    if (previousEarly === undefined) delete process.env.MARKET_EARLY_CLOSES;
    else process.env.MARKET_EARLY_CLOSES = previousEarly;
  }
});
