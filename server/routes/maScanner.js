const router = require('express').Router();
const { requireAuth, requireScanQuota } = require('../middleware/authMiddleware');
const { spendScan, quotaFor } = require('../services/scanQuota');
const { scanMA } = require('../services/maScanner');
const { SP500, NASDAQ100, ALL_TICKERS, SECTOR_TICKERS } = require('../../tickers');

// Per-user scan progress (in-memory, cleared when scan finishes)
const scanProgress = new Map(); // userId → { processed, total, found, phase, running }

// Short-lived result cache, keyed by the exact param combination. An MA scan
// walks the whole ticker universe (up to ~500 symbols) — without this, two
// users (or one user re-clicking) hitting the same params seconds apart pay
// that full cost twice. TTL is short since MA relationships shift slowly
// intraday, so freshness isn't meaningfully sacrificed.
const resultCache = new Map(); // cacheKey → { results, scanTime, expiresAt }
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKeyFor(ma, distance, interval, market, sectors) {
  return [ma, distance, interval, market, sectors.slice().sort().join('+')].join('|');
}

// ── Start a MA scan ────────────────────────────────────────────────────────
router.get('/scan-ma', requireScanQuota('maScanner'), async (req, res) => {
  const MA_VALID  = [9, 20, 50, 150];
  const DIST_VALID = [1, 2];

  const ma       = MA_VALID.includes(Number(req.query.ma)) ? Number(req.query.ma) : 20;
  const distance = DIST_VALID.includes(Number(req.query.distance)) ? Number(req.query.distance) : 2;
  const interval = req.query.interval === '1wk' ? '1wk' : '1d';
  const market   = req.query.market || 'all';
  const sectors  = req.query.sectors ? req.query.sectors.split(',').filter(Boolean) : [];

  const cacheKey = cacheKeyFor(ma, distance, interval, market, sectors);
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    spendScan(req.user, 'maScanner');
    return res.json({
      results: cached.results,
      scanTime: cached.scanTime,
      params: { ma, distance, interval },
      fromCache: true,
      ...quotaFor(req.user),
    });
  }

  // Resolve ticker list based on selected market
  let tickersToScan = ALL_TICKERS;
  if (market === 'nasdaq100') {
    tickersToScan = NASDAQ100;
  } else if (market === 'sp500') {
    tickersToScan = SP500;
  } else if (market === 'sectors' && sectors.length > 0) {
    const seen = new Set();
    sectors.forEach(s => {
      (SECTOR_TICKERS[s] || []).forEach(t => { if (!seen.has(t)) { seen.add(t); } });
    });
    tickersToScan = seen.size > 0 ? [...seen] : ALL_TICKERS;
  }

  const userId = req.user.id;

  // Prevent duplicate concurrent scans for same user
  if (scanProgress.get(userId)?.running) {
    return res.status(409).json({ error: 'Scan already in progress' });
  }

  scanProgress.set(userId, { processed: 0, total: tickersToScan.length, found: 0, phase: 1, running: true });

  try {
    const { results } = await scanMA(tickersToScan, {
      ma, distance, interval,
      onProgress: (p) => scanProgress.set(userId, { ...p, running: true }),
    });

    spendScan(req.user, 'maScanner');

    scanProgress.delete(userId);

    const scanTime = new Date().toISOString();
    resultCache.set(cacheKey, { results, scanTime, expiresAt: Date.now() + CACHE_TTL_MS });

    res.json({
      results,
      scanTime,
      params:   { ma, distance, interval },
      ...quotaFor(req.user),
    });
  } catch (err) {
    scanProgress.delete(userId);
    res.status(500).json({ error: err.message });
  }
});

// ── Progress polling (requires auth, not limited to scan count) ────────────
router.get('/ma-progress', requireAuth, (req, res) => {
  const p = scanProgress.get(req.user.id);
  res.json(p || { running: false });
});

module.exports = router;
