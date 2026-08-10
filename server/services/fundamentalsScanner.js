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
// Two failure modes get told apart on purpose, never collapsed into one
// "—": a field the data source genuinely doesn't report (a pre-revenue
// company with no P/E) stays a permanent "—", while a source that just
// failed to answer right now (network hiccup, rate limit) is flagged as
// unverified so the UI can say "try again in a few minutes" instead of
// silently showing an incomplete result as if it were the whole truth.
//
// Accessed via the module object (quoteCache.getQuotes(...), finnhub.fetchFinnhubMetric(...))
// rather than destructured — a destructured const captures the function
// reference at require-time, which test mocks (t.mock.method(mod, 'fn', ...))
// can never reach since they replace the property on the module object itself.
const yahooFinance = require('./yahoo');
const quoteCache = require('./quoteCache');
const finnhub = require('./finnhub');

// Finnhub's 24h-cached metric=all payload carries P/E, debt/equity, and 5yr
// revenue growth (see finnhub.js's fetchFinnhubMetric) — no separate Yahoo
// call for those. Float, short interest, and next earnings date all live in
// one combined Yahoo quoteSummary call instead (defaultKeyStatistics +
// calendarEvents) — one request instead of two, same 24h cache.
const METRIC_TTL_MS = 24 * 60 * 60 * 1000;
const metricCache = new Map(); // symbol → { data, fetchedAt }
const keyStatsCache = new Map(); // symbol → { data, fetchedAt }

function slowGet(cache, symbol) {
  const e = cache.get(symbol);
  return e && Date.now() - e.fetchedAt < METRIC_TTL_MS ? e.data : null;
}
function slowSet(cache, symbol, data) {
  cache.set(symbol, { data, fetchedAt: Date.now() });
}

// Returns null only when Yahoo genuinely has no such data for this symbol
// (a real, successful response with empty fields) — throws are left to the
// caller, which is what distinguishes "not reported" from "couldn't check".
async function fetchKeyStatsAndEarnings(symbol) {
  var summary = await yahooFinance.quoteSummary(symbol, { modules: ['defaultKeyStatistics', 'calendarEvents'] });
  var stats = summary.defaultKeyStatistics || {};
  var dates = summary.calendarEvents && summary.calendarEvents.earnings && summary.calendarEvents.earnings.earningsDate;
  return {
    floatShares: stats.floatShares || 0,
    shortPercent: stats.shortPercentOfFloat != null ? stats.shortPercentOfFloat : 0,
    nextEarningsDate: dates && dates.length ? new Date(dates[0]).toISOString().slice(0, 10) : null,
  };
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
      var metricFailed = false;
      var keyStatsFailed = false;

      var cachedMetric = slowGet(metricCache, c.symbol);
      var metricPromise =
        cachedMetric !== null
          ? Promise.resolve(cachedMetric)
          : finnhub.fetchFinnhubMetric(c.symbol).catch(function () {
              metricFailed = true;
              return null;
            });

      var cachedKeyStats = slowGet(keyStatsCache, c.symbol);
      var keyStatsPromise =
        cachedKeyStats !== null
          ? Promise.resolve(cachedKeyStats)
          : fetchKeyStatsAndEarnings(c.symbol).catch(function () {
              keyStatsFailed = true;
              return null;
            });

      var resolved = await Promise.all([metricPromise, keyStatsPromise]);
      var metric = resolved[0];
      var keyStats = resolved[1];
      if (metric && cachedMetric === null) slowSet(metricCache, c.symbol, metric);
      if (keyStats && cachedKeyStats === null) slowSet(keyStatsCache, c.symbol, keyStats);

      results.push({
        symbol: c.symbol,
        name: c.quote.shortName || c.quote.longName || c.symbol,
        price: c.quote.regularMarketPrice || 0,
        change: c.quote.regularMarketChangePercent || 0,
        marketCap: c.quote.marketCap || 0,
        // 0/null means the source reported no value for this company —
        // rendered as "—", never a fabricated number. `Unverified` (below)
        // is a separate, distinct case: the source failed to answer at all.
        floatShares: (keyStats && keyStats.floatShares) || 0,
        shortPercent: (keyStats && keyStats.shortPercent) || 0,
        nextEarningsDate: (keyStats && keyStats.nextEarningsDate) || null,
        peRatio: (metric && metric.peRatio) || 0,
        debtToEquity: (metric && metric.debtToEquity) || 0,
        revenueGrowth5Y: metric && metric.revenueGrowth5Y != null ? metric.revenueGrowth5Y : null,
        // Which groups genuinely failed to load (network/API error) rather
        // than just having nothing to report — the UI shows these as "not
        // verified — try again in a few minutes", not as "—".
        unverified: {
          peRatio: metricFailed,
          debtToEquity: metricFailed,
          revenueGrowth5Y: metricFailed,
          floatShares: keyStatsFailed,
          shortPercent: keyStatsFailed,
          nextEarningsDate: keyStatsFailed,
        },
      });
    })
  );

  return { results: results, errors: errors };
}

module.exports = { scanFundamentals };
