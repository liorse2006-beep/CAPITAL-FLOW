import { describe, expect, it } from 'vitest';
import { TIER_COLUMNS, TIER_ROWS, tierFeatureChecklist } from './tierFeatures';

describe('tier entitlement matrix', () => {
  it('has a complete value for every current plan on every feature row', () => {
    expect(TIER_COLUMNS.map((column) => column.key)).toEqual(['free', 'premium', 'elite']);
    expect(TIER_ROWS.length).toBeGreaterThanOrEqual(10);
    for (const row of TIER_ROWS) {
      expect(row.label).toEqual(expect.any(String));
      for (const column of TIER_COLUMNS) {
        expect(Object.prototype.hasOwnProperty.call(row, column.key)).toBe(true);
        expect(row[column.key] === false || typeof row[column.key] === 'string').toBe(true);
      }
    }
  });

  it('keeps the currently configured price and one-time lifetime copy in one place', () => {
    expect(TIER_COLUMNS).toMatchObject([
      { key: 'free', price: '$0', access: '7-day trial', billing: 'No card required' },
      { key: 'premium', price: '$14.90', access: 'One-time payment', billing: 'Lifetime access' },
      { key: 'elite', price: '$29.90', access: 'One-time payment', billing: 'Lifetime access' },
    ]);
  });

  it('retains explicit excluded values for the post-purchase checklist', () => {
    const premium = tierFeatureChecklist('premium');
    expect(premium.find((row) => row.label === 'Capi — your AI market mentor')).toMatchObject({ included: false });
    expect(premium.find((row) => row.label === 'News & AI summaries')).toMatchObject({
      included: true,
      value: 'Signed-in access',
    });
  });
});
