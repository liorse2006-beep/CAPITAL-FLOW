// Mirrors the prices shown to users in src/constants/tierFeatures.js and
// src/components/shared/WelcomeTierModal.jsx. Kept here as the one place the
// backend needs them, to record what was actually paid on each Whop
// payment_succeeded event for the admin revenue ledger (server/routes/webhooks.js).
// Update in both places if pricing ever changes.
const TIER_PRICE_CENTS = { premium: 1490, elite: 2990 };
const ELITE_UPGRADE_PRICE_CENTS = 1495; // the discounted, one-time Premium→Elite offer

function priceForPurchase(tier, isUpgrade) {
  if (tier === 'elite' && isUpgrade) return ELITE_UPGRADE_PRICE_CENTS;
  return TIER_PRICE_CENTS[tier] || 0;
}

module.exports = { TIER_PRICE_CENTS, ELITE_UPGRADE_PRICE_CENTS, priceForPurchase };
