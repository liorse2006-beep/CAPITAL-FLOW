const router = require('express').Router();
const { requirePremiumOrTrial } = require('../middleware/authMiddleware');
const yahooFinance = require('../services/yahoo');
const { finnhubFetch } = require('../services/finnhub');
const { reportError } = require('../utils/reportError');
const { createTTLCache } = require('../utils/ttlCache');

// Every premium or in-trial free user opening the same popular ticker's chart within the
// same window previously re-fetched from Yahoo + Finnhub independently —
// this route had zero caching. 45s is short enough that the live price
// stays reasonably current, but long enough to absorb the common case of
// several users (or one user re-opening a chart) hitting the same
// symbol+period back to back.
const chartCache = createTTLCache(45 * 1000);

var SYMBOL_RE = /^[A-Z0-9.-]{1,10}$/;

function finiteOrNull(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoDateOrNull(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
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
  if (cached) return res.json(cached);

  try {
    const chart = await yahooFinance.chart(symbol, {
      period1: new Date(Date.now() - lookbackMs),
      interval,
    });

    const raw = chart?.quotes ?? [];
    const quotes = raw
      // A candle is only rendered when every value needed to draw it was
      // actually returned by the provider. Falling back to the close for a
      // missing high/low/open invents a shape that never existed.
      .map((q) => {
        const date = isoDateOrNull(q?.date);
        const values = ['open', 'high', 'low', 'close', 'volume'].map((field) => finiteOrNull(q?.[field]));
        if (!date || values.some((value) => value === null || value <= 0)) return null;
        const [open, high, low, close, volume] = values;
        return {
          date,
          open: +open.toFixed(4),
          high: +high.toFixed(4),
          low: +low.toFixed(4),
          close: +close.toFixed(4),
          volume,
        };
      })
      .filter(Boolean);

    if (quotes.length === 0) {
      return res.status(503).json({ error: 'Chart data is not available right now. Try again in a few minutes.' });
    }

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
    try {
      const fRes = await finnhubFetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`);
      const fData = fRes ? await fRes.json() : null;
      const price = finiteOrNull(fData?.c);
      if (price !== null && price > 0 && !fData.error) {
        currentPrice = {
          price,
          change: finiteOrNull(fData.dp),
          high: finiteOrNull(fData.h),
          low: finiteOrNull(fData.l),
          prevClose: finiteOrNull(fData.pc),
        };
      }
    } catch (_) {}

    if (!currentPrice) {
      try {
        const q = await yahooFinance.quote(symbol);
        const price = finiteOrNull(q?.regularMarketPrice);
        if (price !== null && price > 0) {
          currentPrice = {
            price,
            change: finiteOrNull(q.regularMarketChangePercent),
            high: finiteOrNull(q.regularMarketDayHigh),
            low: finiteOrNull(q.regularMarketDayLow),
            prevClose: finiteOrNull(q.regularMarketPreviousClose),
          };
        }
      } catch (_) {}
    }

    const payload = { quotes, ma20, ma50, currentPrice, period, interval };
    chartCache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    reportError(err, '[chart]');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
