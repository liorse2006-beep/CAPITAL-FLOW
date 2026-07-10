const router = require('express').Router();
const { backgroundCache } = require('../services/backgroundScan');

router.get('/background-status', function (req, res) {
  var hasCache = !!(backgroundCache.results && backgroundCache.scanTime);
  var cacheAge = hasCache ? Math.round((Date.now() - new Date(backgroundCache.scanTime).getTime()) / 1000) : null;
  var nextScanIn = hasCache ? Math.max(0, 900 - cacheAge) : 0;
  res.json({
    hasCache: hasCache,
    cacheAge: cacheAge,
    scanTime: backgroundCache.scanTime,
    resultsCount: hasCache ? backgroundCache.results.length : 0,
    nextScanIn: nextScanIn,
    running: backgroundCache.running,
  });
});

module.exports = router;
