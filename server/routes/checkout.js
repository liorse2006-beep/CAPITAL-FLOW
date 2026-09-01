const router = require('express').Router();
const { requireAuth } = require('../middleware/authMiddleware');
const { checkoutLimiter } = require('../middleware/rateLimiters');
const { normalizeCode } = require('../services/coupons');
const whop = require('../services/whop');
const { WHOP_PREMIUM_PLAN_ID, WHOP_ELITE_PLAN_ID, WHOP_ELITE_UPGRADE_PLAN_ID, FRONTEND_URL } = require('../config');
const { reportError } = require('../utils/reportError');

const PLAN_ID = { premium: WHOP_PREMIUM_PLAN_ID, elite: WHOP_ELITE_PLAN_ID };

// Debounces a rapid double-click/double-submit into one Whop checkout
// session instead of two — bounded by design (a short TTL per user+tier,
// cleared as soon as it expires), never grows with total traffic the way an
// unbounded cache would. Not a security control (nothing prevents two
// genuinely separate purchases seconds apart from Whop's side), purely UX
// hygiene against creating orphaned duplicate sessions.
const recentCheckouts = new Map(); // `${userId}:${tier}` → timestamp
const CHECKOUT_DEBOUNCE_MS = 4000;

function isDuplicateCheckout(key) {
  const last = recentCheckouts.get(key);
  const now = Date.now();
  if (last && now - last < CHECKOUT_DEBOUNCE_MS) return true;
  recentCheckouts.set(key, now);
  // Best-effort cleanup so the map never accumulates stale entries.
  if (recentCheckouts.size > 5000) {
    for (const [k, ts] of recentCheckouts) {
      if (now - ts > CHECKOUT_DEBOUNCE_MS) recentCheckouts.delete(k);
    }
  }
  return false;
}

// The one-time, half-price Elite upgrade offered on the Premium welcome
// screen. It charges a DIFFERENT Whop plan (a discounted price configured
// directly in Whop, not something this app can apply on its own) but still
// grants the normal 'elite' tier once paid — the webhook independently checks
// that the authoritative plan matches this configured upgrade plan first.
router.post('/checkout/transaction', checkoutLimiter, requireAuth, async (req, res) => {
  if (!whop.enabled) return res.status(503).json({ error: 'Checkout is not configured yet' });

  const { tier, couponCode: rawCouponCode } = req.body || {};

  if (isDuplicateCheckout(`${req.user.id}:${tier}`)) {
    return res.status(429).json({ error: 'Checkout already starting — please wait a moment.' });
  }

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
        allowPromoCodes: true,
        redirectUrl: `${FRONTEND_URL}/`,
      });
      // sessionId + planId are what the embedded checkout (WhopCheckoutEmbed)
      // needs to render inline on our own page — purchaseUrl is kept only as
      // a fallback for any caller still using the old hosted-redirect flow.
      return res.json({ purchaseUrl: session.purchase_url, sessionId: session.id, planId: WHOP_ELITE_UPGRADE_PLAN_ID });
    } catch (err) {
      reportError(err, '[checkout/transaction eliteUpgrade]');
      return res.status(502).json({ error: 'Could not start checkout — please try again' });
    }
  }

  const planId = PLAN_ID[tier];
  if (!planId)
    return res.status(400).json({ error: 'tier must be premium or elite, and its Whop plan must be configured' });

  try {
    // Whop is the only authority for both promo eligibility and the amount
    // charged. The local coupons table is bookkeeping only: it cannot make a
    // Whop checkout cheaper. A code that is valid in the local table but was
    // never created/configured in Whop must still be allowed to reach the
    // provider, because Whop is the system that can accept or reject it. Most
    // importantly, we never return discount_percent or a locally calculated
    // price to the browser. The embedded checkout displays the provider's
    // final amount, and the webhook redeems local usage only after Whop
    // confirms that the promo was actually applied.
    let couponCode = '';
    if (rawCouponCode != null && typeof rawCouponCode !== 'string') {
      return res.status(400).json({ error: 'Promo code must be text' });
    }
    if (typeof rawCouponCode === 'string' && rawCouponCode.trim()) {
      const trimmedCouponCode = rawCouponCode.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/.test(trimmedCouponCode)) {
        return res.status(400).json({ error: 'Invalid promo code format' });
      }
      couponCode = normalizeCode(trimmedCouponCode);
    }

    const session = await whop.createCheckoutSession({
      planId,
      metadata: { userId: String(req.user.id), tier, ...(couponCode ? { couponCode } : {}) },
      allowPromoCodes: true,
      // Whop redirects here regardless of outcome, appending its own
      // ?status=success|error — never bake an assumed outcome into this
      // URL ourselves (see src/App.jsx, which reads that param).
      redirectUrl: `${FRONTEND_URL}/`,
    });
    res.json({
      purchaseUrl: session.purchase_url,
      sessionId: session.id,
      planId,
      ...(couponCode ? { couponCode } : {}),
    });
  } catch (err) {
    reportError(err, '[checkout/transaction]');
    res.status(502).json({ error: 'Could not start checkout — please try again' });
  }
});

module.exports = router;
