const router = require('express').Router();
const { requirePremiumOrTrial } = require('../middleware/authMiddleware');
const { scanLimiter } = require('../middleware/rateLimiters');
const { scanFundamentals } = require('../services/fundamentalsScanner');
const { reportError } = require('../utils/reportError');

const SYMBOL_RE = /^[A-Z0-9.-]{1,10}$/;

// Short-lived per-symbol cache — a customer re-checking the same ticker a
// few minutes later (or two customers looking up the same hot name) costs
// nothing extra. Fundamentals don't move intraday, so this can be generous.
const resultCache = new Map(); // symbol → { result, scanTime, expiresAt }
const CACHE_TTL_MS = 10 * 60 * 1000;

// Fundamentals is a single-ticker lookup, by the customer's own choice —
// not a universe scan. "on the whole market" was the first version of this
// feature; it got replaced with this because the customer wants to pull up
// one company they're already looking at, not browse a table of hundreds.
// Premium/Elite feature (see tierFeatures.js — "Float & short interest
// data" was already advertised there before this existed) — also opened up,
// unlimited, to free accounts during their 7-day trial (requirePremiumOrTrial).
router.get('/fundamentals', requirePremiumOrTrial, scanLimiter, async (req, res) => {
  const symbol = String(req.query.symbol || '')
    .toUpperCase()
    .trim();
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' });

  const cached = resultCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({
      result: cached.result,
      scanTime: cached.scanTime,
      dataStatus: cached.dataStatus,
      quoteDataStatus: cached.quoteDataStatus,
      staleCount: cached.staleCount,
      dataAsOf: cached.dataAsOf,
      fromCache: true,
    });
  }

  try {
    const { results, dataStatus, quoteDataStatus, staleCount, dataAsOf } = await scanFundamentals([symbol]);
    if (!results.length) {
      if (quoteDataStatus === 'unavailable') {
        return res.status(503).json({
          error: 'Market data is temporarily unavailable. Please try again in a few minutes.',
          dataStatus: 'unavailable',
          quoteDataStatus,
          dataAsOf,
        });
      }
      return res
        .status(404)
        .json({ error: 'No data found for ' + symbol + ' (delisted, too small, or an unknown ticker)' });
    }

    const scanTime = new Date().toISOString();
    resultCache.set(symbol, {
      result: results[0],
      scanTime,
      dataStatus,
      quoteDataStatus,
      staleCount,
      dataAsOf,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    res.json({ result: results[0], scanTime, dataStatus, quoteDataStatus, staleCount, dataAsOf });
  } catch (err) {
    reportError(err, '[fundamentals-lookup]');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
