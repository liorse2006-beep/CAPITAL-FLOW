const router = require('express').Router();
const crypto = require('crypto');
const { requireAuth, requireScanQuota } = require('../middleware/authMiddleware');
const { refundScan, quotaFor } = require('../services/scanQuota');
// Accessed via the module object (maScannerService.scanMA(...)) rather than
// destructured — a destructured const captures the function reference at
// require-time, which test mocks (t.mock.method(mod, 'fn', ...)) can never
// reach since they replace the property on the module object itself. Same
// reasoning as services/fundamentalsScanner.js's own top-of-file comment.
const maScannerService = require('../services/maScanner');
const { SP500, NASDAQ100, ALL_TICKERS, SECTOR_TICKERS } = require('../../tickers');
const { reportError } = require('../utils/reportError');

// Per-user scan progress. A completed entry is intentionally retained as a
// small status record so an async client can distinguish "not started" from
// "finished" without receiving the whole result set on every progress poll.
const scanProgress = new Map(); // userId → { processed, total, found, phase, running }
const lastResultsByUser = new Map(); // userId → { scanId, payload, expiresAt }
const LAST_RESULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESULT_USERS = 500;

// Short-lived result cache, keyed by the exact param combination. An MA scan
// walks the whole ticker universe (up to ~500 symbols) — without this, two
// users (or one user re-clicking) hitting the same params seconds apart pay
// that full cost twice. TTL is short since MA relationships shift slowly
// intraday, so freshness isn't meaningfully sacrificed.
const resultCache = new Map(); // cacheKey → { results, scanTime, expiresAt }
const CACHE_TTL_MS = 5 * 60 * 1000;

// The cache above only helps once a scan has already finished — it does
// nothing for N users hitting "Run MA Scan" with the same (very often the
// pre-selected default) params within the same few seconds, before any of
// them has completed and populated it. Without this, each of those N
// requests independently walks the whole ~500-symbol universe: N times the
// Yahoo chart-fetch load for work that produces byte-for-byte the same
// result. Mirrors routes/scan.js's joinSharedScan for Capital Flow — a
// request joins whichever scan for its exact param combination is already
// in flight instead of starting a duplicate one.
const inFlightScans = new Map(); // cacheKey → { promise, subscribers: Set<userId> }

function rememberLastResult(userId, payload) {
  lastResultsByUser.set(userId, { scanId: payload.scanId, payload, expiresAt: Date.now() + LAST_RESULT_TTL_MS });
  if (lastResultsByUser.size <= MAX_RESULT_USERS) return;
  const now = Date.now();
  for (const [id, entry] of lastResultsByUser) {
    if (entry.expiresAt <= now) lastResultsByUser.delete(id);
  }
  for (const id of lastResultsByUser.keys()) {
    if (lastResultsByUser.size <= MAX_RESULT_USERS) break;
    lastResultsByUser.delete(id);
  }
}

function readLastResult(userId) {
  const entry = lastResultsByUser.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    lastResultsByUser.delete(userId);
    return null;
  }
  return entry;
}

function cacheKeyFor(ma, distance, interval, direction, market, sectors) {
  return [ma, distance, interval, direction, market, sectors.slice().sort().join('+')].join('|');
}

// ── Start a MA scan ────────────────────────────────────────────────────────
router.get('/scan-ma', requireScanQuota('maScanner'), async (req, res) => {
  const MA_VALID = [9, 20, 50, 150];
  const DIST_VALID = [1, 2];

  const ma = req.query.ma == null || req.query.ma === '' ? 20 : Number(req.query.ma);
  const distance = req.query.distance == null || req.query.distance === '' ? 2 : Number(req.query.distance);
  const interval = req.query.interval == null || req.query.interval === '' ? '1d' : req.query.interval;
  const direction = req.query.direction == null || req.query.direction === '' ? 'all' : req.query.direction;
  const market = req.query.market == null || req.query.market === '' ? 'all' : req.query.market;
  const sectors =
    req.query.sectors == null
      ? []
      : typeof req.query.sectors === 'string'
        ? [
            ...new Set(
              req.query.sectors
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean)
            ),
          ]
        : null;

  if (
    !MA_VALID.includes(ma) ||
    !DIST_VALID.includes(distance) ||
    !['1d', '1wk'].includes(interval) ||
    !['all', 'above', 'below'].includes(direction) ||
    !['all', 'nasdaq100', 'sp500', 'sectors'].includes(market) ||
    !Array.isArray(sectors) ||
    sectors.length > 20 ||
    sectors.some((sector) => !Object.prototype.hasOwnProperty.call(SECTOR_TICKERS, sector)) ||
    (market === 'sectors' && sectors.length === 0)
  ) {
    // Validation happens after requireScanQuota reserves a Premium slot. No
    // market request is made for invalid filters, so do not charge the user.
    await refundScan(req.user, req.scanReservation);
    return res.status(400).json({ error: 'Invalid moving-average scan filters' });
  }

  const cacheKey = cacheKeyFor(ma, distance, interval, direction, market, sectors);
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    // Cache hit — free, same policy as the main scanner. requireScanQuota
    // already reserved a slot before we knew this would be a cache hit —
    // refund it.
    await refundScan(req.user, req.scanReservation);
    return res.json({
      results: cached.results,
      scanTime: cached.scanTime,
      params: { ma, distance, interval, direction, market, sectors },
      dataStatus: cached.dataStatus,
      dataAsOf: cached.dataAsOf,
      errors: cached.errors,
      checkedSymbols: cached.checkedSymbols,
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
    sectors.forEach((s) => {
      (SECTOR_TICKERS[s] || []).forEach((t) => {
        if (!seen.has(t)) {
          seen.add(t);
        }
      });
    });
    tickersToScan = seen.size > 0 ? [...seen] : ALL_TICKERS;
  }

  const userId = req.user.id;

  // Prevent duplicate concurrent scans for same user
  if (scanProgress.get(userId)?.running) {
    await refundScan(req.user, req.scanReservation); // no scan actually happened for this request
    return res.status(409).json({ error: 'Scan already in progress' });
  }

  const scanId = crypto.randomUUID();
  scanProgress.set(userId, { processed: 0, total: tickersToScan.length, found: 0, phase: 1, running: true, scanId });
  lastResultsByUser.delete(userId);

  const runScan = async () => {
    try {
      // Join whichever scan for this exact cacheKey is already running instead
      // of starting a duplicate one — see inFlightScans' own comment above.
      let entry = inFlightScans.get(cacheKey);
      if (!entry) {
        entry = { subscribers: new Set() };
        entry.promise = maScannerService
          .scanMA(tickersToScan, {
            ma,
            distance,
            interval,
            direction,
            // Broadcast progress to every subscriber's own progress slot, not
            // just the request that happened to start the scan — /ma-progress
            // is polled per-user, so a joining subscriber still sees live
            // progress instead of a frozen 0% until the shared scan finishes.
            onProgress: (p) => {
              entry.subscribers.forEach((uid) => {
                const current = scanProgress.get(uid);
                if (current) scanProgress.set(uid, { ...current, ...p, running: true, scanId: current.scanId });
              });
            },
          })
          .finally(() => inFlightScans.delete(cacheKey));
        inFlightScans.set(cacheKey, entry);
      }
      entry.subscribers.add(userId);

      const scan = await entry.promise;
      const results = scan.results || [];

      const scanTime = new Date().toISOString();
      const payload = {
        scanId,
        results,
        scanTime,
        dataStatus: scan.dataStatus || (scan.errors && scan.errors.length ? 'partial' : 'complete'),
        dataAsOf: scan.dataAsOf || scanTime,
        errors: scan.errors || [],
        checkedSymbols: scan.checkedSymbols || [],
      };
      resultCache.set(cacheKey, { ...payload, expiresAt: Date.now() + CACHE_TTL_MS });
      rememberLastResult(userId, payload);
      scanProgress.set(userId, { running: false, scanId, error: null });

      return payload;
    } catch (err) {
      scanProgress.set(userId, {
        running: false,
        scanId,
        error: {
          code: 'SCAN_FAILED',
          message: 'Scan failed. Market data is temporarily unavailable. Please try again in a few minutes.',
        },
      });
      lastResultsByUser.delete(userId);
      try {
        await refundScan(req.user, req.scanReservation);
      } catch (refundError) {
        reportError(refundError, '[ma-scanner] quota refund');
      }
      reportError(err, '[ma-scanner]');
      throw err;
    }
  };

  if (req.query.async === '1') {
    void runScan().catch(() => {});
    return res.status(202).json({
      queued: true,
      scanId,
      params: { ma, distance, interval, direction, market, sectors },
      progress: scanProgress.get(userId),
    });
  }

  try {
    return res.json({ ...(await runScan()), ...quotaFor(req.user) });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── Progress polling (requires auth, not limited to scan count) ────────────
router.get('/ma-progress', requireAuth, (req, res) => {
  const p = scanProgress.get(req.user.id);
  res.json(p || { running: false });
});

router.get('/ma-last-results', requireAuth, (req, res) => {
  const requestedScanId = typeof req.query.scanId === 'string' ? req.query.scanId : null;
  const entry = readLastResult(req.user.id);
  if (!entry || (requestedScanId && entry.scanId !== requestedScanId)) {
    return res.status(409).json({ error: 'Scan result is not ready', scanId: entry?.scanId || null });
  }
  return res.json({ ...entry.payload, ...quotaFor(req.user) });
});

module.exports = router;
