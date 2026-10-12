import { describe, it, expect } from 'vitest';
import { categoryQuota } from './quota';

describe('categoryQuota', () => {
  it('treats a missing scanMeta as not exhausted', () => {
    expect(categoryQuota(null, 'capitalFlow')).toEqual({ exhausted: false, label: '' });
  });

  it('elite is always unlimited', () => {
    const result = categoryQuota({ tier: 'elite' }, 'capitalFlow');
    expect(result.exhausted).toBe(false);
    expect(result.label).toBe('Unlimited');
  });

  it('premium is exhausted once the shared pool hits 0 left', () => {
    const result = categoryQuota({ tier: 'premium', premium: { used: 5, left: 0, limit: 5 } }, 'maScanner');
    expect(result.exhausted).toBe(true);
    expect(result.left).toBe(0);
  });

  it('premium is not exhausted while scans remain', () => {
    const result = categoryQuota({ tier: 'premium', premium: { used: 2, left: 3, limit: 5 } }, 'maScanner');
    expect(result.exhausted).toBe(false);
    expect(result.left).toBe(3);
  });

  it('premium falls back to a 5-scan default when the premium sub-object is missing', () => {
    const result = categoryQuota({ tier: 'premium' }, 'maScanner');
    expect(result.exhausted).toBe(false);
    expect(result.limit).toBe(5);
  });

  it('free tier is not exhausted while the trial is active, regardless of category', () => {
    const scanMeta = { tier: 'free', free: { trialActive: true, trialEndsAt: '2099-01-01T00:00:00.000Z' } };
    expect(categoryQuota(scanMeta, 'capitalFlow').exhausted).toBe(false);
    expect(categoryQuota(scanMeta, 'maScanner').exhausted).toBe(false);
    expect(categoryQuota(scanMeta, 'sectorMoving').exhausted).toBe(false);
  });

  it('free tier is exhausted once the trial has ended, for every category', () => {
    const scanMeta = { tier: 'free', free: { trialActive: false, trialEndsAt: '2020-01-01T00:00:00.000Z' } };
    expect(categoryQuota(scanMeta, 'capitalFlow').exhausted).toBe(true);
    expect(categoryQuota(scanMeta, 'maScanner').exhausted).toBe(true);
  });

  it('free tier with no free info yet is treated as exhausted, not silently allowed', () => {
    const result = categoryQuota({ tier: 'free', free: {} }, 'capitalFlow');
    expect(result.exhausted).toBe(true);
  });
});
