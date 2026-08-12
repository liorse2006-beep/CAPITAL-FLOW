/**
 * Client-side feature access helpers.
 *
 * The server remains authoritative. These helpers only keep the UI aligned
 * with the same contract: a free account inside its seven-day trial receives
 * the full Elite experience, while a paid account is identified by its tier.
 */
export function hasEliteAccess(user, scanMeta) {
  if (!user) return false;
  if (user.tier === 'elite' || user.elite_access) return true;
  return user.tier === 'free' && !!(scanMeta && scanMeta.free && scanMeta.free.trialActive);
}

export function hasPremiumFeatureAccess(user, scanMeta) {
  return !!(user && (user.is_premium || hasEliteAccess(user, scanMeta)));
}
