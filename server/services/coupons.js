const db = require('../db');

function normalizeCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase();
}

/** Read-only check — does NOT consume a use. Safe to call from an
 * unauthenticated endpoint (checkout page "have a coupon?" field). */
function validateCoupon(rawCode, tier) {
  const code = normalizeCode(rawCode);
  if (!code) return { valid: false, error: 'Enter a coupon code' };

  const coupon = db.prepare('SELECT * FROM coupons WHERE code = ?').get(code);
  if (!coupon) return { valid: false, error: 'Invalid coupon code' };
  if (!coupon.active) return { valid: false, error: 'This coupon is no longer active' };
  if (coupon.expires_at && coupon.expires_at < Math.floor(Date.now() / 1000)) {
    return { valid: false, error: 'This coupon has expired' };
  }
  if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses) {
    return { valid: false, error: 'This coupon has reached its usage limit' };
  }
  if (coupon.applies_to !== 'both' && coupon.applies_to !== tier) {
    return { valid: false, error: `This coupon only applies to ${coupon.applies_to}` };
  }

  return {
    valid: true,
    code,
    discountPercent: coupon.discount_percent,
    appliesTo: coupon.applies_to,
    paddleDiscountId: coupon.paddle_discount_id || null,
  };
}

/** Called once a purchase actually completes — increments the use counter. */
function redeemCoupon(rawCode) {
  const code = normalizeCode(rawCode);
  db.prepare('UPDATE coupons SET uses_count = uses_count + 1 WHERE code = ?').run(code);
}

module.exports = { normalizeCode, validateCoupon, redeemCoupon };
