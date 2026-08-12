const db = require('../db');

function normalizeCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase();
}

/** Read-only check — does NOT consume a use. Safe to call from an
 * unauthenticated endpoint (checkout page "have a coupon?" field). */
async function validateCoupon(rawCode, tier) {
  const code = normalizeCode(rawCode);
  if (!code) return { valid: false, error: 'Enter a coupon code' };

  const coupon = await db.prepare('SELECT * FROM coupons WHERE code = ?').get(code);
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
  };
}

/**
 * Called once a purchase actually completes — atomically increments the use
 * counter, but only while still under max_uses. The guard lives in the same
 * UPDATE as the increment (not a separate check beforehand) so two
 * concurrent redemptions of a coupon with exactly one use left can never
 * both succeed — SQLite serializes writes, so the second UPDATE's WHERE
 * clause is evaluated against the row *after* the first has already
 * committed its increment, not against a stale read from before either ran.
 * Returns false if the coupon didn't exist or was already at its limit —
 * callers should treat that as "coupon not actually redeemed", not an error.
 */
async function redeemCoupon(rawCode) {
  const code = normalizeCode(rawCode);
  const result = await db
    .prepare(
      'UPDATE coupons SET uses_count = uses_count + 1 WHERE code = ? AND (max_uses IS NULL OR uses_count < max_uses)'
    )
    .run(code);
  return result.changes > 0;
}

module.exports = { normalizeCode, validateCoupon, redeemCoupon };
