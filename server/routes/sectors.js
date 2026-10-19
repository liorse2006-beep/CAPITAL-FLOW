const router = require('express').Router();
const { requireScanQuota } = require('../middleware/authMiddleware');
const { refundScan, quotaFor } = require('../services/scanQuota');
const { getSectorFlow } = require('../services/sectorFlow');
const { buildFinancialProvenance, SECTOR_FLOW_SOURCES } = require('../services/financialProvenance');
const { reportError } = require('../utils/reportError');

router.get('/sector-flow', requireScanQuota('sectorMoving'), async (req, res) => {
  try {
    const { payload, shared } = await getSectorFlow();
    if (shared || payload.dataStatus === 'unavailable') await refundScan(req.user, req.scanReservation);
    res.json({
      ...payload,
      ...(shared ? { fromCache: true } : {}),
      dataProvenance: buildFinancialProvenance({
        dataAsOf: payload.dataAsOf,
        capturedAt: payload.fetchTime,
        status: payload.dataStatus,
        quoteStatus: payload.dataStatus,
        sources: SECTOR_FLOW_SOURCES.map((source) => ({
          ...source,
          asOf: source.provider === 'Yahoo Finance' ? payload.dataAsOf : null,
          status: source.provider === 'Yahoo Finance' ? payload.dataStatus : 'unknown',
        })),
      }),
      ...quotaFor(req.user),
    });
  } catch (error) {
    await refundScan(req.user, req.scanReservation);
    reportError(error, '[sectors]');
    res.status(503).json({
      error: 'Market data is temporarily unavailable. Please try again in a few minutes.',
      dataStatus: 'unavailable',
    });
  }
});
module.exports = router;
