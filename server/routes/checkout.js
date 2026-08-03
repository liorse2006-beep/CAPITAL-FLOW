const router = require('express').Router();
const { requireAuth } = require('../middleware/authMiddleware');
const { validateCoupon } = require('../services/coupons');
const whop = require('../services/whop');
const { WHOP_PREMIUM_PLAN_ID, WHOP_ELITE_PLAN_ID, WHOP_ELITE_UPGRADE_PLAN_ID, FRONTEND_URL } = require('../config');

const PLAN_ID = { premium: WHOP_PREMIUM_PLAN_ID, elite: WHOP_ELITE_PLAN_ID };

// The one-time, half-price Elite upgrade offered on the Premium welcome
// screen. It charges a DIFFERENT Whop plan (a discounted price configured
// directly in Whop, not something this app can apply on its own) but still
// grants the normal 'elite' tier once paid — see the webhook, which only
// ever reads metadata.tier, never which plan was actually charged.
router.post('/checkout/transaction', requireAuth, async (req, res) => {
  if (!whop.enabled) return res.status(503).json({ error: 'Checkout is not configured yet' });

  const { tier, couponCode } = req.body;

  if (tier === 'eliteUpgrade') {
    if (!WHOP_ELITE_UPGRADE_PLAN_ID) return res.status(503).json({ error: 'This offer is not configured yet' });
    // The exclusivity is enforced here, not just claimed in the copy — only
    // an account that is CURRENTLY Premium may start this checkout.
    if (req.user.tier !== 'premium') {
      return res.status(403).json({ error: 'This offer is only available to Premium accounts' });
    }
    try {
      const session = await whop.createCheckoutSession({
        planId: WHOP_ELITE_UPGRADE_PLAN_ID,
        metadata: { userId: String(req.user.id), tier: 'elite' },
        redirectUrl: `${FRONTEND_URL}/`,
      });
      // sessionId + planId are what the embedded checkout (WhopCheckoutEmbed)
      // needs to render inline on our own page — purchaseUrl is kept only as
      // a fallback for any caller still using the old hosted-redirect flow.
      return res.json({ purchaseUrl: session.purchase_url, sessionId: session.id, planId: WHOP_ELITE_UPGRADE_PLAN_ID });
    } catch (err) {
      console.error('[checkout/transaction eliteUpgrade]', err);
      return res.status(502).json({ error: 'Could not start checkout — please try again' });
    }
  }

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
    res.json({ purchaseUrl: session.purchase_url, sessionId: session.id, planId });
  } catch (err) {
    console.error('[checkout/transaction]', err);
    res.status(502).json({ error: 'Could not start checkout — please try again' });
  }
});

module.exports = router;
