const router = require('express').Router();
const { requireAuth } = require('../middleware/authMiddleware');
const { validateCoupon } = require('../services/coupons');
const paddle = require('../services/paddle');
const { PADDLE_PREMIUM_PRICE_ID, PADDLE_ELITE_PRICE_ID } = require('../config');

const PRICE_ID = { premium: PADDLE_PREMIUM_PRICE_ID, elite: PADDLE_ELITE_PRICE_ID };

// Creates a Paddle transaction for the requesting user's chosen tier, with
// an optional coupon applied — the frontend opens Paddle's checkout overlay
// against the returned transaction id. Requires auth so custom_data can
// carry the user id the webhook needs to know who to upgrade.
router.post('/checkout/transaction', requireAuth, async (req, res) => {
  if (!paddle.enabled) return res.status(503).json({ error: 'Checkout is not configured yet' });

  const { tier, couponCode } = req.body;
  const priceId = PRICE_ID[tier];
  if (!priceId) return res.status(400).json({ error: 'tier must be premium or elite, and its Paddle price must be configured' });

  let discountId = null;
  if (couponCode) {
    const coupon = validateCoupon(couponCode, tier);
    if (!coupon.valid) return res.status(400).json({ error: coupon.error });
    discountId = coupon.paddleDiscountId; // null is fine — coupon still valid, just not wired to a real Paddle discount
  }

  try {
    const transaction = await paddle.createTransaction({
      priceId,
      discountId,
      customData: { userId: req.user.id, tier, couponCode: couponCode || null },
    });
    res.json({ transactionId: transaction.id });
  } catch (err) {
    console.error('[checkout/transaction]', err);
    res.status(502).json({ error: 'Could not start checkout — please try again' });
  }
});

module.exports = router;
