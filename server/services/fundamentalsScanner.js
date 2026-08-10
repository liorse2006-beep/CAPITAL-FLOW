// Fundamentals lookup — swing-trading-relevant company data (Float, Short
// Interest, P/E, Debt/Equity, 5-year revenue growth, next earnings date) for
// a ticker the customer picked themselves. Deliberately NOT the same
// six-metric deep-value screen a long-term investor would want: no PEG, no
// institutional ownership, no multi-year balance-sheet detail — just the
// handful of numbers that matter for a position measured in days-to-weeks,
// not years. And deliberately no market-cap floor here either — if the
// customer typed in a specific ticker, that's their call, not this
// service's to second-guess.
//
// Accessed via the module object (quoteCache.getQuotes(...), finnhub.fetchFinnhubMetric(...))
// rather than destructured — a destructured const captures the function
// reference at require-time, which test mocks (t.mock.method(mod, 'fn', ...))
// can never reach since they replace the property on the module object itself.
const yahooFinance = require('./yahoo');
const quoteCache = require('./quoteCache');
const finnhub = require('./finnhub');

// Finnhub's 24h-cached metric=all payload already carries most fields this
// lookup needs (see finnhub.js's fetchFinnhubMetric) — no separate Yahoo call
// for those, no extra API budget spent beyond what the app already pays.
// Next earnings date is the one field Finnhub's metric endpoint doesn't
// carry, so it gets its own small 24h cache (earnings dates don't change
// intraday) via Yahoo's quoteSummary calendarEvents module.
const METRIC_TTL_MS = 24 * 60 * 60 * 1000;
const metricCache = new Map(); // symbol → { data, fetchedAt }
const earningsCache = new Map(); // symbol → { data, fetchedAt }

function slowGet(cache, symbol) {
  const e = cache.get(symbol);
  return e && Date.now() - e.fetchedAt < METRIC_TTL_MS ? e.data : null;
}
function slowSet(cache, symbol, data) {
  cache.set(symbol, { data, fetchedAt: Date.now() });
}

async function fetchNextEarningsDate(symbol) {
  try {
    var summary = await yahooFinance.quoteSummary(symbol, { modules: ['calendarEvents'] });
    var dates = summary.calendarEvents && summary.calendarEvents.earnings && summary.calendarEvents.earnings.earningsDate;
    if (!dates || !dates.length) return null;
    return new Date(dates[0]).toISOString().slice(0, 10);
  } catch (e) {
    return null;
  }
}

// tickers is normally a single-element array (one lookup per customer
// request) but stays array-in/array-out for testability and in case a
// future caller ever needs to batch a few at once.
async function scanFundamentals(tickers) {
  var results = [];
  var errors = [];

  var quotesMap = await quoteCache.getQuotes(tickers);

  var candidates = [];
  tickers.forEach(function (symbol) {
    var quote = quotesMap.get(symbol);
    if (!quote || !quote.regularMarketPrice) {
      errors.push(symbol);
      return;
    }
    candidates.push({ symbol: symbol, quote: quote });
  });

  await Promise.all(
    candidates.map(async function (c) {
      try {
        var cachedMetric = slowGet(metricCache, c.symbol);
        var cachedEarnings = slowGet(earningsCache, c.symbol);
        var resolved = await Promise.all([
          cachedMetric !== null ? Promise.resolve(cachedMetric) : finnhub.fetchFinnhubMetric(c.symbol),
          cachedEarnings !== null ? Promise.resolve(cachedEarnings) : fetchNextEarningsDate(c.symbol),
        ]);
        var metric = resolved[0];
        var nextEarningsDate = resolved[1];
        if (metric && cachedMetric === null) slowSet(metricCache, c.symbol, metric);
        if (cachedEarnings === null) slowSet(earningsCache, c.symbol, nextEarningsDate);

        results.push({
          symbol: c.symbol,
          name: c.quote.shortName || c.quote.longName || c.symbol,
          price: c.quote.regularMarketPrice || 0,
          change: c.quote.regularMarketChangePercent || 0,
          marketCap: c.quote.marketCap || 0,
          // 0/null means the data source didn't report a value for this
          // company — rendered as "—" in the UI, never a fabricated number.
          floatShares: c.quote.floatShares || 0,
          shortPercent: c.quote.shortPercentOfFloat || 0,
          peRatio: (metric && metric.peRatio) || 0,
          debtToEquity: (metric && metric.debtToEquity) || 0,
          revenueGrowth5Y: metric && metric.revenueGrowth5Y != null ? metric.revenueGrowth5Y : null,
          nextEarningsDate: nextEarningsDate || null,
        });
      } catch (e) {
        errors.push(c.symbol);
      }
    })
  );

  return { results: results, errors: errors };
}

module.exports = { scanFundamentals };
