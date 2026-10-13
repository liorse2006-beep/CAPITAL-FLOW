'use strict';

const { sessionDateForTimestamp, isTradingDateKey, previousTradingDateKey } = require('./marketCalendar');
const MAX_METADATA_SYMBOLS = 25;
const MAX_CACHE_ENTRIES = 1000;
const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;

function sameSymbol(first, second) {
  return (
    typeof first === 'string' &&
    typeof second === 'string' &&
    first.toUpperCase().replace(/-/g, '.') === second.toUpperCase().replace(/-/g, '.')
  );
}

function positive(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)))
    return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function tenSessionAverage(body, symbol, quoteDate) {
  if (!Array.isArray(body) || body.length > 64 || !isTradingDateKey(quoteDate)) return null;
  const volumes = new Map();
  const seen = new Set();
  for (const bar of body) {
    if (
      !sameSymbol(bar?.symbol, symbol) ||
      typeof bar?.date !== 'string' ||
      !isTradingDateKey(bar.date) ||
      bar.date > quoteDate ||
      seen.has(bar.date)
    )
      return null;
    seen.add(bar.date);
    if (bar.date === quoteDate) continue;
    const volume = positive(bar.volume);
    if (volume === null) return null;
    volumes.set(bar.date, volume);
  }
  let date = quoteDate;
  let total = 0;
  for (let index = 0; index < 10; index++) {
    date = previousTradingDateKey(date);
    const volume = volumes.get(date);
    if (!volume) return null;
    total += volume;
  }
  const average = total / 10;
  return Number.isFinite(average) && average > 0 ? average : null;
}

function createScanMetadataLoader(requestJson) {
  const cache = new Map();
  const pending = new Map();
  async function load(key, operation) {
    const entry = cache.get(key);
    if (entry && Date.now() < entry.expiresAt) return entry.value;
    if (pending.has(key)) return pending.get(key);
    const request = Promise.resolve()
      .then(operation)
      .catch(() => null)
      .then((value) => {
        if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
        cache.set(key, { value, expiresAt: Date.now() + (value === null ? FAILURE_TTL_MS : SUCCESS_TTL_MS) });
        return value;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  async function enrichQuote(quote) {
    let currency = quote.currency;
    if (currency == null) {
      currency = await load(`currency:${quote.symbol}`, async () => {
        const body = await requestJson(`/profile?symbol=${encodeURIComponent(quote.symbol)}`);
        if (!Array.isArray(body) || body.length !== 1 || !sameSymbol(body[0]?.symbol, quote.symbol)) return null;
        const value = body[0]?.currency;
        return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
      });
    }
    // An unknown or conflicting denomination must still fall through to a
    // complementary provider. Never assume USD from a ticker or exchange.
    if (currency !== 'USD') return quote;
    let average = quote.averageDailyVolume10Day;
    if (!(average > 0)) {
      const quoteDate = sessionDateForTimestamp(quote.regularMarketTime * 1000);
      if (!isTradingDateKey(quoteDate)) return { ...quote, currency };
      average = await load(`volume:${quote.symbol}:${quoteDate}`, async () => {
        const from = new Date(`${quoteDate}T00:00:00Z`);
        from.setUTCDate(from.getUTCDate() - 45);
        const body = await requestJson(
          `/historical-price-eod/full?symbol=${encodeURIComponent(quote.symbol)}&from=${from.toISOString().slice(0, 10)}&to=${quoteDate}`
        );
        return tenSessionAverage(body, quote.symbol, quoteDate);
      });
    }
    return { ...quote, currency, averageDailyVolume10Day: average };
  }

  return {
    async enrich(rows) {
      const output = rows.slice();
      let cursor = 0;
      async function run() {
        while (cursor < Math.min(rows.length, MAX_METADATA_SYMBOLS)) {
          const index = cursor++;
          output[index] = await enrichQuote(rows[index]);
        }
      }
      await Promise.all([run(), run()]);
      return output;
    },
    clear() {
      cache.clear();
      pending.clear();
    },
  };
}

module.exports = { createScanMetadataLoader, tenSessionAverage };
