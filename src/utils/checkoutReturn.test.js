import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearWhopReturnState,
  createWhopReturnUrl,
  redirectToWhopReturn,
  restoreWhopReturnScroll,
  saveWhopReturnState,
  WHOP_RETURN_STATE_KEY,
} from './checkoutReturn';

describe('Whop return navigation', () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
  });

  it('returns to the current app route while preserving its query and hash', () => {
    expect(createWhopReturnUrl('https://capitalflow.vip/scanner?universe=nasdaq#results')).toBe(
      'https://capitalflow.vip/scanner?universe=nasdaq&status=success#results'
    );
  });

  it('saves and restores the app scroll position on the same route', () => {
    const stored = new Map();
    const frames = [];
    const scrollTo = vi.fn();
    const win = {
      location: { href: 'https://capitalflow.vip/scanner?universe=nasdaq', pathname: '/scanner' },
      sessionStorage: {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, value),
        removeItem: (key) => stored.delete(key),
      },
      scrollX: 12,
      scrollY: 840,
      innerHeight: 700,
      requestAnimationFrame: (callback) => frames.push(callback),
      setTimeout: vi.fn(),
      scrollTo,
    };
    const documentRef = { documentElement: { scrollHeight: 1800 } };

    saveWhopReturnState(win);
    expect(JSON.parse(stored.get(WHOP_RETURN_STATE_KEY))).toMatchObject({
      pathname: '/scanner',
      scrollX: 12,
      scrollY: 840,
    });

    expect(restoreWhopReturnScroll(win, documentRef)).toBe(true);
    expect(stored.has(WHOP_RETURN_STATE_KEY)).toBe(false);
    frames.shift()();
    frames.shift()();
    expect(scrollTo).toHaveBeenCalledWith(12, 840);
    expect(win.setTimeout).not.toHaveBeenCalled();
  });

  it('does not restore a stale position onto a different route', () => {
    const stored = new Map();
    const win = {
      location: { href: 'https://capitalflow.vip/scanner', pathname: '/scanner' },
      sessionStorage: {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, value),
        removeItem: (key) => stored.delete(key),
      },
      scrollX: 0,
      scrollY: 0,
    };
    saveWhopReturnState(win);
    win.location.pathname = '/watchlist';

    expect(restoreWhopReturnScroll(win, { documentElement: { scrollHeight: 1000 } })).toBe(false);
    expect(stored.has(WHOP_RETURN_STATE_KEY)).toBe(false);
  });

  it('redirects the top-level app only after a successful checkout callback', () => {
    const locationRef = {
      href: 'https://capitalflow.vip/scanner',
      origin: 'https://capitalflow.vip',
      replace: vi.fn(),
    };
    expect(redirectToWhopReturn('https://capitalflow.vip/scanner?status=success', locationRef)).toBe(true);
    expect(locationRef.replace).toHaveBeenCalledWith('https://capitalflow.vip/scanner?status=success');
    expect(redirectToWhopReturn('', locationRef)).toBe(false);
    expect(redirectToWhopReturn('https://example.com/checkout', locationRef)).toBe(false);
  });

  it('clears saved return state when checkout is canceled or closed', () => {
    sessionStorage.setItem(WHOP_RETURN_STATE_KEY, 'state');
    clearWhopReturnState();
    expect(sessionStorage.getItem(WHOP_RETURN_STATE_KEY)).toBeNull();
  });
});
