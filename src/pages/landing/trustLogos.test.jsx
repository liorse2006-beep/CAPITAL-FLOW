import { describe, expect, it } from 'vitest';
import { TRUST_LOGO_SYMBOLS } from './trustLogos';

describe('landing trust logos', () => {
  it('keeps a unique, valid 300-symbol set for the marquee', () => {
    expect(TRUST_LOGO_SYMBOLS).toHaveLength(300);
    expect(new Set(TRUST_LOGO_SYMBOLS).size).toBe(300);
    expect(TRUST_LOGO_SYMBOLS.every((symbol) => /^[A-Z0-9.-]{1,10}$/.test(symbol))).toBe(true);
    expect(TRUST_LOGO_SYMBOLS).not.toContain('FRT');
  });
});
