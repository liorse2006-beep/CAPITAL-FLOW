const router = require('express').Router();
const { requirePremium } = require('../middleware/authMiddleware');
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
// data" was already advertised there before this existed).
router.get('/fundamentals', requirePremium, async (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase().trim();
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' });

  const cached = resultCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({ result: cached.result, scanTime: cached.scanTime, fromCache: true });
  }

  try {
    const { results } = await scanFundamentals([symbol]);
    if (!results.length) {
      return res.status(404).json({ error: 'No data found for ' + symbol + ' (delisted, too small, or an unknown ticker)' });
    }

    const scanTime = new Date().toISOString();
    resultCache.set(symbol, { result: results[0], scanTime, expiresAt: Date.now() + CACHE_TTL_MS });

    res.json({ result: results[0], scanTime });
  } catch (err) {
    reportError(err, '[fundamentals-lookup]');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
