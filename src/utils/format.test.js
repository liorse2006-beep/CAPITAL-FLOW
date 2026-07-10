import { describe, it, expect } from 'vitest';
import { fmt, parseVolInput, friendlyError } from './format';

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
  it('gives a default message when there is no error', () => {
    expect(friendlyError(null)).toMatch(/went wrong/i);
  });
  it('special-cases "Scan already in progress"', () => {
    expect(friendlyError('Scan already in progress')).toMatch(/already running/i);
  });
  it('classifies fetch/network failures generically', () => {
    expect(friendlyError('Failed to fetch')).toMatch(/network error/i);
    expect(friendlyError('NetworkError when attempting to fetch resource')).toMatch(/network error/i);
  });
  it('passes through any other message unchanged', () => {
    expect(friendlyError('Invalid ticker symbol')).toBe('Invalid ticker symbol');
  });
});
