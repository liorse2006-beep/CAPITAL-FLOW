import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import WatchlistPage from './WatchlistPage';

vi.mock('../../hooks/useSeo', () => ({ default: vi.fn() }));
vi.mock('./AddTickerModal', () => ({ default: () => <div>Add ticker dialog</div> }));

const quote = { symbol: 'AAPL', name: 'Synthetic company', price: 123, change: 2, volumeRatio: 1.5, marketCap: 1e9 };
function props(overrides = {}) {
  return {
    watchlist: ['AAPL'],
    watchlistData: [quote],
    watchlistLoading: false,
    watchlistError: null,
    refreshWatchlist: vi.fn(),
    toggleWatchlistTicker: vi.fn(),
    setWatchlistError: vi.fn(),
    canNotify: false,
    user: null,
    alertLevels: {},
    promptCreateAlert: vi.fn(),
    ...overrides,
  };
}
afterEach(() => vi.useRealTimers());

describe('Watchlist quote freshness and controls', () => {
  it('keeps Active Price beside Add Ticker and calls the existing refresh action', () => {
    const p = props();
    render(<WatchlistPage {...p} />);
    const refresh = screen.getByRole('button', { name: 'Active Price' });
    const add = screen.getByRole('button', { name: 'Add Ticker' });
    expect(refresh.parentElement).toBe(add.parentElement);
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    fireEvent.click(refresh);
    expect(p.refreshWatchlist).toHaveBeenCalledTimes(1);
  });

  it('uses the provider timestamp and never changes it on an unrelated rerender', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T20:00:00Z'));
    const p = props({ watchlistDataAsOf: '2026-10-08T18:00:00Z', watchlistQuoteStatus: 'complete' });
    const view = render(<WatchlistPage {...p} />);
    const timestamp = view.container.querySelector('time');
    expect(timestamp?.getAttribute('datetime')).toBe(p.watchlistDataAsOf);
    expect(timestamp?.textContent).toBe(new Date(p.watchlistDataAsOf).toLocaleString());
    vi.setSystemTime(new Date('2026-10-08T21:00:00Z'));
    view.rerender(<WatchlistPage {...p} pushBusy />);
    expect(view.container.querySelector('time')?.textContent).toBe(timestamp.textContent);
    expect(screen.queryByText(/Last refreshed/)).toBeNull();
  });

  it('marks undated and stale quotes without inventing a current timestamp', () => {
    const p = props();
    const view = render(<WatchlistPage {...p} />);
    expect(screen.getByText('Quote time unavailable')).toBeTruthy();
    expect(view.container.querySelector('time')).toBeNull();
    view.rerender(<WatchlistPage {...p} watchlistDataAsOf="2026-10-08T18:00:00Z" watchlistQuoteStatus="stale" />);
    expect(screen.getByText(/Prices may be delayed/)).toBeTruthy();
  });

  it('does not turn a missing provider quote into a nonexistent ticker', () => {
    render(<WatchlistPage {...props({ watchlistData: [] })} />);
    expect(screen.queryByText('Not found')).toBeNull();
    expect(screen.getAllByText('Quote unavailable')).toHaveLength(2);
  });

  it('does not crash on an invalid result container or render a non-finite ratio', () => {
    const p = props({ watchlistData: {} });
    const view = render(<WatchlistPage {...p} />);
    expect(screen.getAllByText('Quote unavailable')).toHaveLength(2);
    view.rerender(<WatchlistPage {...props({ watchlistData: [{ ...quote, volumeRatio: Infinity }] })} />);
    expect(screen.queryByText('Infinityx')).toBeNull();
  });
});
