const router = require('express').Router();
const { validateCoupon } = require('../services/coupons');
const { publicDataLimiter } = require('../middleware/rateLimiters');
const { reportError } = require('../utils/reportError');

const VALID_TIERS = new Set(['premium', 'elite']);

// Unauthenticated on purpose — a visitor checks a coupon before signing up.
// Read-only (does not consume a use); redemption happens when checkout
// actually completes.
router.post('/coupons/validate', publicDataLimiter, async (req, res) => {
  try {
    const { code, tier } = req.body;
    if (!VALID_TIERS.has(tier)) return res.status(400).json({ valid: false, error: 'tier must be premium or elite' });
    const result = await validateCoupon(code, tier);
    res.json(result);
  } catch (err) {
    reportError(err, '[coupons/validate]');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
