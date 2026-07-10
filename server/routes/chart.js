const router = require('express').Router();
const { requirePremium } = require('../middleware/authMiddleware');
const yahooFinance = require('../services/yahoo');
const { finnhubFetch } = require('../services/finnhub');

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

router.get('/chart/:symbol', requirePremium, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const period = PERIODS[req.query.period] ? req.query.period : '1M';
  const { interval, lookbackMs } = PERIODS[period];

  try {
    const chart = await yahooFinance.chart(symbol, {
      period1: new Date(Date.now() - lookbackMs),
      interval,
    });

    const raw = chart?.quotes ?? [];
    const quotes = raw
      .filter((q) => q?.close && q?.volume)
      .map((q) => ({
        date: q.date instanceof Date ? q.date.toISOString() : String(q.date),
        open: +(q.open || q.close).toFixed(4),
        high: +(q.high || q.close).toFixed(4),
        low: +(q.low || q.close).toFixed(4),
        close: +q.close.toFixed(4),
        volume: q.volume,
      }));

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
      if (fData?.c > 0 && !fData.error) {
        currentPrice = { price: fData.c, change: fData.dp, high: fData.h, low: fData.l, prevClose: fData.pc };
      }
    } catch (_) {}

    if (!currentPrice) {
      try {
        const q = await yahooFinance.quote(symbol);
        if (q?.regularMarketPrice) {
          currentPrice = {
            price: q.regularMarketPrice,
            change: q.regularMarketChangePercent || 0,
            high: q.regularMarketDayHigh || 0,
            low: q.regularMarketDayLow || 0,
            prevClose: q.regularMarketPreviousClose || 0,
          };
        }
      } catch (_) {}
    }

    res.json({ quotes, ma20, ma50, currentPrice, period, interval });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
