const router = require('express').Router();
const { publicDataLimiter } = require('../middleware/rateLimiters');

// Deprecated deliberately. Whop is the only authority for promo eligibility
// and the amount charged. Keeping a local validation endpoint that returns a
// discount percentage lets an old client show a cheaper price that the
// provider will still charge at full price. The checkout endpoint forwards a
// format-validated code to Whop, and the embedded checkout's final amount is
// the only amount we present as payable.
router.post('/coupons/validate', publicDataLimiter, (req, res) => {
  res.status(410).json({
    valid: false,
    error: 'Promo codes are validated in the secure checkout. Please continue to checkout to see the final amount.',
    code: 'provider_checkout_required',
  });
});

module.exports = router;
