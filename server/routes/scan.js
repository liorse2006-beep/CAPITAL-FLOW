const router = require('express').Router();
const { scanTickers } = require('../services/scanner');
const { backgroundCache, filterCachedResults } = require('../services/backgroundScan');
const { scanState } = require('../state');
const { SP500, NASDAQ100, ALL_TICKERS, SECTOR_TICKERS } = require('../../tickers');
const { requireScanQuota } = require('../middleware/authMiddleware');
const { spendScan: spendScanQuota, quotaFor } = require('../services/scanQuota');

function isMarketOpen() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay(), mins = et.getHours() * 60 + et.getMinutes();
  return day !== 0 && day !== 6 && mins >= 570 && mins < 960;
}

function spendScan(req) {
  spendScanQuota(req.user, 'capitalFlow');
  return quotaFor(req.user);
}

router.get('/scan', requireScanQuota('capitalFlow'), async (req, res) => {
  if (scanState.running) {
    return res.status(409).json({ error: 'Scan already in progress' });
  }

  const minVolumeRatio = parseFloat(req.query.minVolumeRatio) || 1.5;
  const minMarketCap = parseFloat(req.query.minMarketCap) || 1_000_000_000;
  const minPrice = parseFloat(req.query.minPrice) || 0;
  const maxPrice = parseFloat(req.query.maxPrice) || 0;
  const minVolRaw = req.query.minVol || '';
  const sectors = req.query.sectors ? req.query.sectors.split(',') : [];
  const list = req.query.list || '';

  // Return background cache instantly if fresh and compatible.
  // When market is closed extend TTL to 24 h so users always see last-session data.
  var marketOpen = isMarketOpen();
  var maxCacheAge = marketOpen ? 15 * 60 * 1000 : 24 * 60 * 60 * 1000;

  if (backgroundCache.results && backgroundCache.scanTime && list !== 'sectors' && sectors.length === 0) {
    var cacheAgeMs = Date.now() - new Date(backgroundCache.scanTime).getTime();
    if (cacheAgeMs < maxCacheAge) {
      var minRatioReq = minVolumeRatio;
      var minCapReq = minMarketCap;
      if (minRatioReq >= 1.5 && minCapReq >= 500000000) {
        var opts = {
          minVolumeRatio: minVolumeRatio,
          minMarketCap: minMarketCap,
          minPrice: minPrice,
          maxPrice: maxPrice,
          minVolRaw: minVolRaw,
          list: list,
          sectors: sectors,
        };
        var cachedFiltered = filterCachedResults(backgroundCache.results, opts);
        return res.json({
          results: cachedFiltered,
          scanTime: backgroundCache.scanTime,
          tickersScanned: ALL_TICKERS.length,
          errors: 0,
          fromCache: true,
          cacheAge: Math.round(cacheAgeMs / 1000),
          marketClosed: !marketOpen,
          ...spendScan(req),
        });
      }
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

  scanState.running = true;
  scanState.progress = { processed: 0, total: tickersToScan.length, found: 0 };
  scanState.liveResults = [];

  try {
    const { results, errors, processed } = await scanTickers(tickersToScan, {
      minVolumeRatio,
      minMarketCap,
      minPrice,
      maxPrice,
      minVolRaw,
      onProgress: (p) => {
        scanState.progress = p;
      },
      onMatch: (match) => {
        scanState.liveResults.push(match);
      },
    });

    scanState.lastResults = results;
    scanState.lastScanTime = new Date().toISOString();
    backgroundCache.results = results;
    backgroundCache.scanTime = scanState.lastScanTime;
    scanState.running = false;

    res.json({
      results,
      scanTime: scanState.lastScanTime,
      tickersScanned: processed,
      errors: errors.length,
      marketClosed: !isMarketOpen(),
      ...spendScan(req),
    });
  } catch (err) {
    scanState.running = false;
    res.status(500).json({ error: err.message });
  }
});

router.get('/progress', (req, res) => {
  res.json({
    running: scanState.running,
    progress: scanState.progress,
    liveResults: scanState.liveResults || [],
  });
});

router.get('/last-results', (req, res) => {
  res.json({
    results: scanState.lastResults,
    scanTime: scanState.lastScanTime,
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
