const router = require('express').Router();
const { requireAuth } = require('../middleware/authMiddleware');
const { validateCoupon } = require('../services/coupons');
const whop = require('../services/whop');
const { WHOP_PREMIUM_PLAN_ID, WHOP_ELITE_PLAN_ID, FRONTEND_URL } = require('../config');

const PLAN_ID = { premium: WHOP_PREMIUM_PLAN_ID, elite: WHOP_ELITE_PLAN_ID };

// Creates a Whop checkout session for the requesting user's chosen tier —
// the frontend redirects to the returned purchase_url. Requires auth so
// metadata can carry the user id the webhook needs to know who to upgrade.
router.post('/checkout/transaction', requireAuth, async (req, res) => {
  if (!whop.enabled) return res.status(503).json({ error: 'Checkout is not configured yet' });

  const { tier, couponCode } = req.body;
  const planId = PLAN_ID[tier];
  if (!planId) return res.status(400).json({ error: 'tier must be premium or elite, and its Whop plan must be configured' });

  try {
    if (couponCode) {
      const coupon = await validateCoupon(couponCode, tier);
      if (!coupon.valid) return res.status(400).json({ error: coupon.error });
      // Validated and tracked in our own system, but not auto-applied at
      // Whop checkout — only the price shown to the customer changes.
    }

    const session = await whop.createCheckoutSession({
      planId,
      metadata: { userId: String(req.user.id), tier, couponCode: couponCode || null },
      // Whop redirects here regardless of outcome, appending its own
      // ?status=success|error — never bake an assumed outcome into this
      // URL ourselves (see src/App.jsx, which reads that param).
      redirectUrl: `${FRONTEND_URL}/`,
    });
    res.json({ purchaseUrl: session.purchase_url });
  } catch (err) {
    console.error('[checkout/transaction]', err);
    res.status(502).json({ error: 'Could not start checkout — please try again' });
  }
});

module.exports = router;
