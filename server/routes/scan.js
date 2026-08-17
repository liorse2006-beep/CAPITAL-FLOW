const router = require('express').Router();
const scanner = require('../services/scanner');
const { backgroundCache, filterCachedResults, isMarketOpen } = require('../services/backgroundScan');
const { getUserScanState } = require('../state');
const { SP500, NASDAQ100, ALL_TICKERS, SECTOR_TICKERS } = require('../../tickers');
const { requireAuth, requireScanQuota } = require('../middleware/authMiddleware');
const { refundScan, quotaFor } = require('../services/scanQuota');
const { reportError } = require('../utils/reportError');

// The broadest (most permissive) filter set a shared scan runs with. Any
// request at-or-above this floor can be served by one shared scan and
// filtered down per user; a below-floor request (custom API callers only —
// the UI never goes below these) runs privately with its own filters.
const FLOOR_RATIO = 1.5;
const FLOOR_CAP = 500_000_000;

// One in-flight scan per ticker universe, shared by every user who asks for
// that universe while it runs. Two users clicking "Run Scan" seconds apart
// used to mean either a blunt 409 for the second or double the upstream
// load — now the second request subscribes to the first's scan and both get
// their own filtered view of the same result set.
const inFlightScans = new Map(); // universeKey → { promise, subscribers: Set<{state, opts}> }

function parseVol(str) {
  if (str == null || str === '') return 0;
  const s = str.toString().toUpperCase().trim();
  const match = /^(\d+(?:\.\d+)?)([KMB])?$/.exec(s);
  if (!match) return null;
  const multiplier = match[2] === 'B' ? 1e9 : match[2] === 'M' ? 1e6 : match[2] === 'K' ? 1e3 : 1;
  const value = Number(match[1]) * multiplier;
  return Number.isFinite(value) && value <= 100_000_000_000_000 ? value : null;
}

function boundedNumber(value, fallback, min, max) {
  if (value == null || value === '') return fallback;
  if (Array.isArray(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

/** Does one already-enriched result row pass this user's own filters? */
function rowPasses(r, opts) {
  if (r.volumeRatio < opts.minVolumeRatio) return false;
  if (r.marketCap < opts.minMarketCap) return false;
  if (opts.minPrice > 0 && r.price < opts.minPrice) return false;
  if (opts.maxPrice > 0 && r.price > opts.maxPrice) return false;
  if (opts.minVolNum > 0 && r.volume < opts.minVolNum) return false;
  return true;
}

function universeKeyFor(list, sectors) {
  if (list === 'nasdaq100') return 'nasdaq100';
  if (list === 'sp500') return 'sp500';
  if (sectors.length > 0) return 'sectors:' + sectors.slice().sort().join('+');
  return 'all';
}

/**
 * Join (or start) the shared floor-filter scan for a universe. Every
 * subscriber's per-user state gets live progress and its own filtered live
 * match feed while the single underlying scan runs.
 */
function joinSharedScan(universeKey, tickers, state, opts) {
  let entry = inFlightScans.get(universeKey);
  if (!entry) {
    entry = { subscribers: new Set() };
    entry.promise = scanner
      .scanTickers(tickers, {
        minVolumeRatio: FLOOR_RATIO,
        minMarketCap: FLOOR_CAP,
        onProgress: (p) => {
          entry.subscribers.forEach((sub) => {
            sub.state.progress = p;
          });
        },
        onMatch: (m) => {
          entry.subscribers.forEach((sub) => {
            if (rowPasses(m, sub.opts)) sub.state.liveResults.push(m);
          });
        },
      })
      .finally(() => inFlightScans.delete(universeKey));
    inFlightScans.set(universeKey, entry);
  }
  const sub = { state, opts };
  entry.subscribers.add(sub);
  return entry.promise.finally(() => entry.subscribers.delete(sub));
}

router.get('/scan', requireScanQuota('capitalFlow'), async (req, res) => {
  const minVolumeRatio = boundedNumber(req.query.minVolumeRatio, 1.5, 0.1, 100);
  const minMarketCap = boundedNumber(req.query.minMarketCap, 1_000_000_000, 0, 100_000_000_000_000);
  const minPrice = boundedNumber(req.query.minPrice, 0, 0, 10_000_000);
  const maxPrice = boundedNumber(req.query.maxPrice, 0, 0, 10_000_000);
  const minVolRaw = req.query.minVol || '';
  const minVolNum = parseVol(minVolRaw);
  const sectors =
    typeof req.query.sectors === 'string'
      ? [
          ...new Set(
            req.query.sectors
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          ),
        ]
      : [];
  const list = req.query.list || '';

  if (
    minVolumeRatio == null ||
    minMarketCap == null ||
    minPrice == null ||
    maxPrice == null ||
    minVolNum == null ||
    sectors.length > 20 ||
    sectors.some((sector) => !Object.prototype.hasOwnProperty.call(SECTOR_TICKERS, sector)) ||
    (list && !['nasdaq100', 'sp500', 'sectors'].includes(list)) ||
    (list === 'sectors' && sectors.length === 0) ||
    (maxPrice > 0 && minPrice > maxPrice)
  ) {
    return res.status(400).json({ error: 'Invalid scan filters' });
  }

  const userOpts = {
    minVolumeRatio,
    minMarketCap,
    minPrice,
    maxPrice,
    minVolRaw,
    minVolNum,
  };

  // Return background cache instantly if fresh and compatible.
  // When market is closed extend TTL to 24 h so users always see last-session data.
  const marketOpen = isMarketOpen();
  const maxCacheAge = marketOpen ? 15 * 60 * 1000 : 24 * 60 * 60 * 1000;

  if (backgroundCache.results && backgroundCache.scanTime && list !== 'sectors' && sectors.length === 0) {
    const cacheAgeMs = Date.now() - new Date(backgroundCache.scanTime).getTime();
    if (cacheAgeMs < maxCacheAge && minVolumeRatio >= FLOOR_RATIO && minMarketCap >= FLOOR_CAP) {
      const cachedFiltered = filterCachedResults(backgroundCache.results, {
        minVolumeRatio,
        minMarketCap,
        minPrice,
        maxPrice,
        minVolRaw,
        list,
        sectors,
      });
      const state = getUserScanState(req.user.id);
      state.lastResults = cachedFiltered;
      state.lastScanTime = backgroundCache.scanTime;
      // Served from cache — no real work happened, so it costs no quota.
      // Premium's 5/day pool only ever pays for scans that hit the market.
      // requireScanQuota already reserved a slot before we knew this would
      // be a cache hit (the atomic reserve has to happen before the scan
      // for the race-fix to work at all) — refund it here.
      await refundScan(req.user);
      return res.json({
        results: cachedFiltered,
        scanTime: backgroundCache.scanTime,
        tickersScanned: ALL_TICKERS.length,
        errors: 0,
        fromCache: true,
        cacheAge: Math.round(cacheAgeMs / 1000),
        marketClosed: !marketOpen,
        ...quotaFor(req.user),
      });
    }
  }

  let tickersToScan = ALL_TICKERS;
  if (list === 'nasdaq100') {
    tickersToScan = NASDAQ100;
  } else if (list === 'sp500') {
    tickersToScan = SP500;
  } else if (sectors.length > 0) {
    const sectorSet = new Set();
    sectors.forEach((s) => {
      const ticks = SECTOR_TICKERS[s];
      if (ticks) ticks.forEach((t) => sectorSet.add(t));
    });
    tickersToScan = [...sectorSet];
  }

  const state = getUserScanState(req.user.id);
  // Double-click protection only — scans by OTHER users never block this one.
  if (state.running) {
    await refundScan(req.user); // no scan actually happened for this request
    return res.status(409).json({ error: 'Scan already in progress' });
  }

  state.running = true;
  state.progress = { processed: 0, total: tickersToScan.length, found: 0 };
  state.liveResults = [];

  // A request below the shared floor can't reuse the shared scan (its
  // baseline filters would hide rows this user asked to see) — run private.
  const canShare = minVolumeRatio >= FLOOR_RATIO && minMarketCap >= FLOOR_CAP;
  const universeKey = universeKeyFor(list, sectors);

  try {
    let results;
    let errors = [];
    let processed = tickersToScan.length;

    if (canShare) {
      const raw = await joinSharedScan(universeKey, tickersToScan, state, userOpts);
      errors = raw.errors;
      processed = raw.processed;
      results = raw.results.filter((r) => rowPasses(r, userOpts));
      // The full-universe floor scan is byte-for-byte what the background
      // scheduler produces — refresh the shared cache so the next caller
      // gets an instant hit.
      if (universeKey === 'all') {
        backgroundCache.results = raw.results;
        backgroundCache.scanTime = new Date().toISOString();
      }
    } else {
      const raw = await scanner.scanTickers(tickersToScan, {
        minVolumeRatio,
        minMarketCap,
        minPrice,
        maxPrice,
        minVolRaw,
        onProgress: (p) => {
          state.progress = p;
        },
        onMatch: (match) => {
          state.liveResults.push(match);
        },
      });
      errors = raw.errors;
      processed = raw.processed;
      results = raw.results;
    }

    state.lastResults = results;
    state.lastScanTime = new Date().toISOString();
    state.running = false;

    res.json({
      results,
      scanTime: state.lastScanTime,
      tickersScanned: processed,
      errors: errors.length,
      marketClosed: !isMarketOpen(),
      ...quotaFor(req.user),
    });
  } catch (err) {
    state.running = false;
    await refundScan(req.user); // the reserved slot bought nothing — give it back
    reportError(err, '[scan]');
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/progress', requireAuth, (req, res) => {
  const state = getUserScanState(req.user.id);
  res.json({
    running: state.running,
    progress: state.progress,
    liveResults: state.liveResults || [],
  });
});

router.get('/last-results', requireAuth, (req, res) => {
  const state = getUserScanState(req.user.id);
  res.json({
    results: state.lastResults,
    scanTime: state.lastScanTime,
  });
});

router.get('/sectors', (req, res) => {
  const sectors = Object.keys(SECTOR_TICKERS).map((name) => ({
    name,
    count: SECTOR_TICKERS[name].length,
  }));
  res.json({ sectors });
});

module.exports = router;
