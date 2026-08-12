import { describe, expect, it } from 'vitest';
import { hasEliteAccess, hasPremiumFeatureAccess } from './access';

describe('feature access helpers', () => {
  it('grants the complete Elite surface during the free trial', () => {
    const user = { tier: 'free', is_premium: 0 };
    const scanMeta = { free: { trialActive: true } };

    expect(hasEliteAccess(user, scanMeta)).toBe(true);
    expect(hasPremiumFeatureAccess(user, scanMeta)).toBe(true);
  });

  it('does not grant expired free users paid features', () => {
    const user = { tier: 'free', is_premium: 0 };
    const scanMeta = { free: { trialActive: false } };

    expect(hasEliteAccess(user, scanMeta)).toBe(false);
    expect(hasPremiumFeatureAccess(user, scanMeta)).toBe(false);
  });

  it('recognizes paid tiers and server-provided elite access', () => {
    expect(hasPremiumFeatureAccess({ tier: 'premium', is_premium: 1 }, null)).toBe(true);
    expect(hasEliteAccess({ tier: 'elite', is_premium: 1 }, null)).toBe(true);
    expect(hasEliteAccess({ tier: 'free', elite_access: true }, null)).toBe(true);
  });
});
