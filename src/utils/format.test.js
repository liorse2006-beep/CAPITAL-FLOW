import { describe, it, expect } from 'vitest';
import { fmt, parseVolInput, friendlyError, formatPrice } from './format';

describe('fmt', () => {
  it('formats trillions', () => {
    expect(fmt(2.5e12)).toBe('2.5T');
  });
  it('formats billions', () => {
    expect(fmt(1.2e9)).toBe('1.2B');
  });
  it('formats millions', () => {
    expect(fmt(3.4e6)).toBe('3.4M');
  });
  it('formats thousands with no decimal', () => {
    expect(fmt(45000)).toBe('45K');
  });
  it('leaves small numbers as-is', () => {
    expect(fmt(950)).toBe('950');
  });
});

describe('parseVolInput', () => {
  it('parses M suffix', () => {
    expect(parseVolInput('1.5M')).toBe(1.5e6);
  });
  it('parses K suffix', () => {
    expect(parseVolInput('500K')).toBe(500e3);
  });
  it('parses B suffix', () => {
    expect(parseVolInput('2B')).toBe(2e9);
  });
  it('is case-insensitive', () => {
    expect(parseVolInput('1m')).toBe(1e6);
  });
  it('parses a plain number with no suffix', () => {
    expect(parseVolInput('12345')).toBe(12345);
  });
  it('returns 0 for empty/invalid input', () => {
    expect(parseVolInput('')).toBe(0);
    expect(parseVolInput(null)).toBe(0);
    expect(parseVolInput('abc')).toBe(0);
  });
});

describe('friendlyError', () => {
  it('explains a past schedule time without exposing arbitrary backend details', () => {
    expect(friendlyError('That date and time have already passed')).toBe('Choose a future date and time.');
    expect(friendlyError('That date and time have already passed; database user id 42')).toBe(
      'Something went wrong. Please try again.'
    );
  });
  it('gives a default message when there is no error', () => {
    expect(friendlyError(null)).toMatch(/went wrong/);
  });
  it('special-cases "Scan already in progress"', () => {
    expect(friendlyError('Scan already in progress')).toMatch(/already running/);
  });
  it('classifies fetch/network failures generically', () => {
    expect(friendlyError('Failed to fetch')).toMatch(/Check your connection/);
    expect(friendlyError('NetworkError when attempting to fetch resource')).toMatch(/Check your connection/);
  });
  it('does not pass unknown backend messages through to the customer', () => {
    expect(friendlyError('Invalid ticker symbol')).toBe('Something went wrong. Please try again.');
    for (const raw of [
      'Internal Server Error',
      'database user id 42',
      'undefined',
      'null',
      '<script>alert(1)</script>',
      'Bearer secret-token',
      'Error: failed at provider.js:12',
      '{"apiKey":"private-key"}',
    ]) {
      const safe = friendlyError(raw);
      expect(safe).toBe('Something went wrong. Please try again.');
      expect(safe).not.toContain(raw);
    }
  });
  it('localizes only known actionable error categories', () => {
    expect(friendlyError('Unauthorized')).toBe('Please sign in to continue.');
    expect(friendlyError('Too many requests')).toMatch(/Too many attempts/);
    expect(friendlyError('Notifications denied')).toMatch(/Notifications are blocked/);
    expect(friendlyError({ message: 'secret' })).toMatch(/went wrong/);
  });
  it('gives a friendly message for JSON SyntaxError (non-JSON server response)', () => {
    expect(friendlyError('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON')).toMatch(/went wrong/);
    expect(friendlyError("Unexpected token '<'")).toMatch(/went wrong/);
    expect(friendlyError('JSON.parse: unexpected character at line 1 column 1')).toMatch(/went wrong/);
  });
});

describe('formatPrice', () => {
  it('formats a finite positive price', () => {
    expect(formatPrice(190.126)).toBe('$190.13');
  });
  it('shows unavailable for null, invalid, and non-positive prices', () => {
    expect(formatPrice(null)).toBe('—');
    expect(formatPrice('not-a-price')).toBe('—');
    expect(formatPrice(true)).toBe('—');
    expect(formatPrice(0)).toBe('—');
    expect(formatPrice(-2)).toBe('—');
  });
});
