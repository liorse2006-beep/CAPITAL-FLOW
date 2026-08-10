const router = require('express').Router();
const { requirePremium } = require('../middleware/authMiddleware');
const { scanFundamentals } = require('../services/fundamentalsScanner');
const { SP500, NASDAQ100, ALL_TICKERS, SECTOR_TICKERS } = require('../../tickers');
const { reportError } = require('../utils/reportError');

// Per-user scan progress (in-memory, cleared when scan finishes) — same
// pattern as maScanner's own progress map.
const scanProgress = new Map(); // userId → { processed, total, found, running }

// Short-lived result cache, keyed by the exact universe requested. Fundamentals
// don't move intraday, so a slightly longer TTL than the MA scanner's is fine.
const resultCache = new Map(); // cacheKey → { results, scanTime, expiresAt }
const CACHE_TTL_MS = 10 * 60 * 1000;

function cacheKeyFor(market, sectors) {
  return [market, sectors.slice().sort().join('+')].join('|');
}

// Fundamentals is a Premium/Elite feature (see tierFeatures.js — "Float &
// short interest data" was already advertised there before this existed),
// not part of the free-tier scan-quota system: no free trial runs here, and
// running it doesn't spend any of Premium's daily scan pool either.
router.get('/scan-fundamentals', requirePremium, async (req, res) => {
  const market = req.query.market || 'all';
  const sectors = req.query.sectors ? req.query.sectors.split(',').filter(Boolean) : [];

  const cacheKey = cacheKeyFor(market, sectors);
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({ results: cached.results, scanTime: cached.scanTime, fromCache: true });
  }

  let tickersToScan = ALL_TICKERS;
  if (market === 'nasdaq100') {
    tickersToScan = NASDAQ100;
  } else if (market === 'sp500') {
    tickersToScan = SP500;
  } else if (market === 'sectors' && sectors.length > 0) {
    const seen = new Set();
    sectors.forEach((s) => {
      (SECTOR_TICKERS[s] || []).forEach((t) => seen.add(t));
    });
    tickersToScan = seen.size > 0 ? [...seen] : ALL_TICKERS;
  }

  const userId = req.user.id;
  if (scanProgress.get(userId)?.running) {
    return res.status(409).json({ error: 'Scan already in progress' });
  }

  scanProgress.set(userId, { processed: 0, total: tickersToScan.length, found: 0, running: true });

  try {
    const { results } = await scanFundamentals(tickersToScan, {
      onProgress: (p) => scanProgress.set(userId, { ...p, running: true }),
    });

    scanProgress.delete(userId);

    const scanTime = new Date().toISOString();
    resultCache.set(cacheKey, { results, scanTime, expiresAt: Date.now() + CACHE_TTL_MS });

    res.json({ results, scanTime });
  } catch (err) {
    scanProgress.delete(userId);
    reportError(err, '[fundamentals-scanner]');
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/fundamentals-progress', requirePremium, (req, res) => {
  const p = scanProgress.get(req.user.id);
  res.json(p || { running: false });
});

module.exports = router;
