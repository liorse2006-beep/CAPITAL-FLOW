const router = require('express').Router();
const { backgroundCache } = require('../services/backgroundScan');
const { buildFinancialProvenance, CAPITAL_FLOW_SOURCES } = require('../services/financialProvenance');

router.get('/background-status', function (req, res) {
  var hasCache = !!(backgroundCache.results && backgroundCache.scanTime);
  var cacheAge = hasCache ? Math.round((Date.now() - new Date(backgroundCache.scanTime).getTime()) / 1000) : null;
  var nextScanIn = hasCache ? Math.max(0, 900 - cacheAge) : 0;
  res.json({
    hasCache: hasCache,
    cacheAge: cacheAge,
    scanTime: backgroundCache.scanTime,
    dataStatus: backgroundCache.dataStatus,
    dataAsOf: backgroundCache.dataAsOf,
    coverage: backgroundCache.coverage,
    dataProvenance: buildFinancialProvenance({
      dataAsOf: backgroundCache.dataAsOf,
      capturedAt: backgroundCache.scanTime,
      status: backgroundCache.dataStatus || 'unknown',
      quoteStatus: backgroundCache.dataStatus || 'unknown',
      sources: CAPITAL_FLOW_SOURCES.map((source) => ({
        ...source,
        asOf: source.role === 'quote baseline' ? backgroundCache.dataAsOf : null,
        status: source.role === 'quote baseline' ? backgroundCache.dataStatus || 'unknown' : 'unknown',
      })),
    }),
    resultsCount: hasCache ? backgroundCache.results.length : 0,
    nextScanIn: nextScanIn,
    running: backgroundCache.running,
  });
});

module.exports = router;
