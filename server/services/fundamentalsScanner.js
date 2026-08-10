// Fundamentals scanner — swing-trading-relevant company data (Float, Short
// Interest, P/E, Debt/Equity, 5-year revenue growth, next earnings date)
// across a chosen ticker universe. Deliberately NOT the same six-metric
// deep-value screen a long-term investor would want: no PEG, no institutional
// ownership, no multi-year balance-sheet detail — just the handful of numbers
// that matter for a position measured in days-to-weeks, not years.
// Accessed via the module object (quoteCache.getQuotes(...), finnhub.fetchFinnhubMetric(...))
// rather than destructured — a destructured const captures the function
// reference at require-time, which test mocks (t.mock.method(mod, 'fn', ...))
// can never reach since they replace the property on the module object itself.
const yahooFinance = require('./yahoo');
const quoteCache = require('./quoteCache');
const finnhub = require('./finnhub');

const MIN_MKT_CAP = 300_000_000; // matches maScanner's floor — same reasoning: sub-$300M names are too thin to swing-trade reliably

// Finnhub's 24h-cached metric=all payload already carries most fields this
// scan needs (see finnhub.js's fetchFinnhubMetric) — no separate Yahoo call
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

async function scanFundamentals(tickers, options) {
  options = options || {};
  var onProgress = options.onProgress;

  var results = [];
  var errors = [];

  var quotesMap = await quoteCache.getQuotes(tickers, function (fetched, total) {
    if (onProgress) onProgress({ processed: Math.round((fetched / total) * tickers.length * 0.4), total: tickers.length, found: 0 });
  });

  var candidates = [];
  tickers.forEach(function (symbol) {
    var quote = quotesMap.get(symbol);
    if (!quote) {
      errors.push(symbol);
      return;
    }
    if ((quote.marketCap || 0) < MIN_MKT_CAP) return;
    if (!quote.regularMarketPrice) return;
    candidates.push({ symbol: symbol, quote: quote });
  });

  if (onProgress) onProgress({ processed: Math.round(tickers.length * 0.4), total: tickers.length, found: 0 });

  var enrichedCount = 0;
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
      } finally {
        enrichedCount++;
        if (onProgress) {
          var approx = Math.round(tickers.length * 0.4) + Math.round((enrichedCount / (candidates.length || 1)) * tickers.length * 0.6);
          onProgress({ processed: approx, total: tickers.length, found: results.length });
        }
      }
    })
  );

  if (onProgress) onProgress({ processed: tickers.length, total: tickers.length, found: results.length });

  return { results: results, errors: errors, processed: tickers.length };
}

module.exports = { scanFundamentals };
