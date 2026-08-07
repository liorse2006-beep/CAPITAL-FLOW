// server/services/maScanner.js's daysSinceCross — must come only from the
// symbol's actual historical closes (never guessed), and must be null,
// not 0 or any other number, whenever the data doesn't show a real cross.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');
const yahoo = require('../server/services/yahoo');
const quoteCache = require('../server/services/quoteCache');
const { scanMA } = require('../server/services/maScanner');

const { before } = require('node:test');
before(async () => {
  await db.ready;
});

function quotesMapFor(symbol, price) {
  const map = new Map();
  map.set(symbol, {
    symbol,
    shortName: symbol + ' Inc.',
    regularMarketPrice: price,
    regularMarketChangePercent: 1,
    regularMarketVolume: 5e6,
    averageDailyVolume10Day: 4e6,
    marketCap: 5e9,
  });
  return map;
}

function closesToQuotes(closes) {
  return closes.map((close, i) => ({ close, date: new Date(Date.now() - (closes.length - i) * 864e5) }));
}

test('daysSinceCross finds a real crossing from a genuine V-shaped price history', async (t) => {
  // A clean, unambiguous regime change: 30 bars of a steady decline (price
  // strictly below its own trailing average throughout), then 10 bars of a
  // steady rise (price strictly above it) — a real crossover near the
  // boundary, not a tie and not a fabricated number.
  const down = Array.from({ length: 30 }, (_, i) => 200 - 2 * i); // 200 → 142
  const up = Array.from({ length: 10 }, (_, i) => 144 + 2 * i); // 144 → 162
  const closes = [...down, ...up];

  t.mock.method(quoteCache, 'getQuotes', async () => quotesMapFor('VSHAPE', closes[closes.length - 1]));
  t.mock.method(yahoo, 'chart', async () => ({ quotes: closesToQuotes(closes) }));

  const { results } = await scanMA(['VSHAPE'], { ma: 20, distance: 100, interval: '1d' });
  assert.strictEqual(results.length, 1);
  const { daysSinceCross } = results[0];
  assert.notStrictEqual(daysSinceCross, null, 'a real crossover exists in this data and must be found');
  assert.ok(
    Number.isInteger(daysSinceCross) && daysSinceCross >= 0 && daysSinceCross <= 10,
    `expected a bars-ago count within the lookback window, got ${daysSinceCross}`
  );
});

test('daysSinceCross is null (never a fabricated number) when the price never crosses the MA', async (t) => {
  // Strictly increasing for the whole window — price is always above its
  // own trailing average, so there is genuinely no crossover to report.
  const closes = Array.from({ length: 40 }, (_, i) => 50 + i);

  t.mock.method(quoteCache, 'getQuotes', async () => quotesMapFor('NOCROSS', closes[closes.length - 1]));
  t.mock.method(yahoo, 'chart', async () => ({ quotes: closesToQuotes(closes) }));

  const { results } = await scanMA(['NOCROSS'], { ma: 20, distance: 100, interval: '1d' });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].daysSinceCross, null);
});

test('daysSinceCross is null when there is not enough history to check the full lookback window', async (t) => {
  // Exactly enough bars for the MA itself, but none of the extra
  // CROSS_LOOKBACK_BARS history behind it — must not guess.
  const closes = Array.from({ length: 20 }, () => 100);

  t.mock.method(quoteCache, 'getQuotes', async () => quotesMapFor('THIN', 100));
  t.mock.method(yahoo, 'chart', async () => ({ quotes: closesToQuotes(closes) }));

  const { results } = await scanMA(['THIN'], { ma: 20, distance: 100, interval: '1d' });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].daysSinceCross, null);
});
