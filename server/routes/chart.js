const router = require('express').Router();
const { requirePremiumOrTrial } = require('../middleware/authMiddleware');
const yahooFinance = require('../services/yahoo');
const { fetchFinnhubQuote } = require('../services/finnhub');
const { reportError } = require('../utils/reportError');
const { createTTLCache } = require('../utils/ttlCache');
const { buildFinancialProvenance } = require('../services/financialProvenance');
const { isProviderTimestampStale, providerTimestampMs } = require('../services/quoteCache');

// Every premium or in-trial free user opening the same popular ticker's chart within the
// same window previously re-fetched from Yahoo + Finnhub independently —
// this route had zero caching. 45s is short enough that the live price
// stays reasonably current, but long enough to absorb the common case of
// several users (or one user re-opening a chart) hitting the same
// symbol+period back to back.
const chartCache = createTTLCache(45 * 1000);

var SYMBOL_RE = /^[A-Z0-9.-]{1,10}$/;

function finiteOrNull(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoDateOrNull(value) {
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return null;
  if (value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function providerTimeOrNull(value) {
  const timestamp = providerTimestampMs({ regularMarketTime: value });
  return timestamp === null ? null : isoDateOrNull(new Date(timestamp));
}

// Only these known US class-share aliases are interchangeable. A generic
// dot-to-hyphen conversion could silently select a different instrument.
const YAHOO_ALIASES = { 'BRK.B': 'BRK-B', 'BF.B': 'BF-B' };
function yahooSymbol(symbol) {
  return YAHOO_ALIASES[symbol] || symbol;
}
function matchesSymbol(actual, requested) {
  return typeof actual === 'string' && actual.trim().toUpperCase() === yahooSymbol(requested);
}
function positiveOrNull(value) {
  const number = finiteOrNull(value);
  return number !== null && number > 0 ? number : null;
}
function validatedCurrentPrice(input) {
  const price = positiveOrNull(input?.price);
  const dataAsOf = providerTimeOrNull(input?.dataAsOf);
  if (price === null || !dataAsOf || isProviderTimestampStale({ regularMarketTime: dataAsOf })) return null;
  const result = {
    price,
    change: finiteOrNull(input.change),
    high: positiveOrNull(input.high),
    low: positiveOrNull(input.low),
    prevClose: positiveOrNull(input.prevClose),
    dataAsOf,
  };
  if (result.high !== null && result.low !== null && result.high < result.low) {
    result.high = null;
    result.low = null;
  }
  result.missingFields = ['change', 'high', 'low', 'prevClose'].filter((field) => result[field] === null);
  result.dataStatus = input.dataStatus === 'partial' || result.missingFields.length ? 'partial' : 'complete';
  return result;
}
function unavailableChart(res) {
  return res.status(503).json({
    error: 'Chart data is not available right now. Try again in a few minutes.',
    dataStatus: 'unavailable',
    quoteDataStatus: 'unavailable',
    dataProvenance: buildFinancialProvenance({
      status: 'unavailable',
      quoteStatus: 'unavailable',
      capturedAt: new Date().toISOString(),
      sources: [{ provider: 'Yahoo Finance', role: 'historical bars', fields: ['OHLCV'], status: 'unavailable' }],
    }),
  });
}

function latestTimestamp(values) {
  return values.reduce((latest, value) => {
    const timestamp = isoDateOrNull(value);
    if (!timestamp) return latest;
    return !latest || timestamp > latest ? timestamp : latest;
  }, null);
}

// period → { interval, lookbackMs }
const PERIODS = {
  '1D': { interval: '5m', lookbackMs: 1 * 24 * 60 * 60 * 1000 },
  '1W': { interval: '1h', lookbackMs: 7 * 24 * 60 * 60 * 1000 },
  '1M': { interval: '1d', lookbackMs: 31 * 24 * 60 * 60 * 1000 },
  '3M': { interval: '1d', lookbackMs: 92 * 24 * 60 * 60 * 1000 },
  '1Y': { interval: '1wk', lookbackMs: 366 * 24 * 60 * 60 * 1000 },
};

function computeMA(closes, window) {
  return closes.map((_, i) => {
    if (i < window - 1) return null;
    const slice = closes.slice(i - window + 1, i + 1);
    return slice.reduce((s, v) => s + v, 0) / window;
  });
}

router.get('/chart/:symbol', requirePremiumOrTrial, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
  const period = PERIODS[req.query.period] ? req.query.period : '1M';
  const { interval, lookbackMs } = PERIODS[period];

  const cacheKey = symbol + ':' + period;
  const cached = chartCache.get(cacheKey);
  // Cache age never refreshes the provider observation. Revalidate when a
  // quote crosses a market-session/freshness boundary inside the cache TTL.
  if (cached && (!cached.currentPrice || validatedCurrentPrice(cached.currentPrice))) return res.json(cached);

  try {
    const now = Date.now();
    const period1 = now - lookbackMs;
    const chart = await yahooFinance.chart(yahooSymbol(symbol), {
      period1: new Date(period1),
      interval,
    });

    // The existing consumer formats all chart prices in USD. Refuse unknown
    // units or another instrument instead of relabelling them as dollars.
    if (!matchesSymbol(chart?.meta?.symbol, symbol) || chart?.meta?.currency !== 'USD') return unavailableChart(res);

    const raw = Array.isArray(chart?.quotes) ? chart.quotes : [];
    // Providers can return the interval containing the requested start, so
    // allow at most one bar of start-boundary slack, not arbitrary old data.
    const intervalMs = { '5m': 300000, '1h': 3600000, '1d': 86400000, '1wk': 7 * 86400000 }[interval];
    const quotes = raw
      // A candle is only rendered when every value needed to draw it was
      // actually returned by the provider. Falling back to the close for a
      // missing high/low/open invents a shape that never existed.
      .map((q) => {
        const date = isoDateOrNull(q?.date);
        const values = ['open', 'high', 'low', 'close', 'volume'].map((field) => finiteOrNull(q?.[field]));
        if (!date || values.some((value) => value === null || value <= 0)) return null;
        const [open, high, low, close, volume] = values;
        if (Date.parse(date) > now + 300000 || Date.parse(date) < period1 - intervalMs) return null;
        if (high < Math.max(open, low, close) || low > Math.min(open, high, close)) return null;
        return {
          date,
          open,
          high,
          low,
          close,
          volume,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (quotes.length === 0) {
      return unavailableChart(res);
    }
    // Duplicate timestamps cannot form a reliable candle sequence. Do not
    // choose an arbitrary one when the provider returns conflicting bars.
    if (quotes.some((quote, index) => index > 0 && quote.date === quotes[index - 1].date)) return unavailableChart(res);
    const historicalStatus = quotes.length === raw.length ? 'complete' : 'partial';
    const historicalAsOf = latestTimestamp(quotes.map((quote) => quote.date));

    // Moving averages (only meaningful for daily+ bars with enough data)
    let ma20 = [],
      ma50 = [];
    if (interval === '1d' || interval === '1wk') {
      const closes = quotes.map((q) => q.close);
      ma20 = computeMA(closes, 20);
      ma50 = computeMA(closes, 50);
    }

    // Real-time quote enrichment
    let currentPrice = null;
    let currentPriceSource = null;
    try {
      const fQuote = await fetchFinnhubQuote(symbol);
      if (fQuote) {
        currentPrice = validatedCurrentPrice({
          price: fQuote.price,
          change: fQuote.change,
          high: fQuote.dayHigh,
          low: fQuote.dayLow,
          prevClose: fQuote.prevClose,
          dataAsOf: fQuote.dataAsOf,
          dataStatus: fQuote.dataStatus,
        });
      }
      if (currentPrice) {
        currentPriceSource = 'Finnhub';
      }
    } catch (_) {}

    if (!currentPrice) {
      try {
        const q = await yahooFinance.quote(yahooSymbol(symbol));
        if (matchesSymbol(q?.symbol, symbol) && q?.currency === 'USD') {
          currentPrice = validatedCurrentPrice({
            price: q.regularMarketPrice,
            change: q.regularMarketChangePercent,
            high: q.regularMarketDayHigh,
            low: q.regularMarketDayLow,
            prevClose: q.regularMarketPreviousClose,
            dataAsOf: providerTimeOrNull(q.regularMarketTime),
          });
        }
        if (currentPrice) {
          currentPriceSource = 'Yahoo Finance';
        }
      } catch (_) {}
    }

    const capturedAt = new Date().toISOString();
    const payload = {
      quotes,
      ma20,
      ma50,
      currentPrice,
      symbol,
      currency: 'USD',
      period,
      interval,
      dataStatus: historicalStatus,
      quoteDataStatus: currentPrice?.dataStatus || 'unavailable',
      dataAsOf: currentPrice?.dataAsOf || historicalAsOf || null,
      dataProvenance: buildFinancialProvenance({
        dataAsOf: currentPrice?.dataAsOf || historicalAsOf || null,
        capturedAt,
        status: historicalStatus,
        quoteStatus: currentPrice?.dataStatus || 'unavailable',
        sources: [
          {
            provider: 'Yahoo Finance',
            role: 'historical bars',
            fields: ['OHLCV', 'moving averages'],
            asOf: historicalAsOf,
            status: historicalStatus,
          },
          {
            provider: currentPriceSource || 'Finnhub / Yahoo Finance',
            role: 'current quote enrichment',
            fields: ['price', 'change', 'day high', 'day low', 'previous close'],
            asOf: currentPrice?.dataAsOf || null,
            status: currentPrice?.dataStatus || 'unavailable',
          },
        ],
      }),
    };
    chartCache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    reportError(err, '[chart]');
    unavailableChart(res);
  }
});

module.exports = router;
