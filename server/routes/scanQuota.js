const router = require('express').Router();
const { requireAuth } = require('../middleware/authMiddleware');
const { quotaFor } = require('../services/scanQuota');

// ── Remaining free-scan quota — shared across every scan type ──────────────
router.get('/scan-quota', requireAuth, (req, res) => {
  res.json(quotaFor(req.user));
});

module.exports = router;
