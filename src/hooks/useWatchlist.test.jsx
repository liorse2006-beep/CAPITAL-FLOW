import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import useWatchlist from './useWatchlist';

const response = (data, ok = true) => ({ ok, json: async () => data });
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function renderWatchlist(overrides = {}) {
  const config = { user: { id: 1 }, getToken: () => 'synthetic-one', storageKey: 'vs-watchlist:1', ...overrides };
  return renderHook((props) => useWatchlist(props), { initialProps: config });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe('account-scoped watchlist operations', () => {
  it('rejects malformed browser cache without crashing', () => {
    localStorage.setItem('vs-watchlist:1', JSON.stringify({ symbol: 'AAPL' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response([]))
    );
    const view = renderWatchlist();
    expect(view.result.current.watchlist).toEqual([]);
    view.unmount();
  });

  it('normalizes and deduplicates a valid server list even when storage is denied', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response([' aapl ', 'AAPL', 'MSFT']))
    );
    const view = renderWatchlist();
    await waitFor(() => expect(view.result.current.watchlist).toEqual(['AAPL', 'MSFT']));
  });

  it('does not let a slow initial sync overwrite an optimistic ticker change', async () => {
    const sync = deferred();
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => (url === '/api/watchlist' ? sync.promise : Promise.resolve(response({ ok: true }))))
    );
    const view = renderWatchlist();
    await act(() => view.result.current.toggleWatchlistTicker('AAPL'));
    await act(() => sync.resolve(response([])));
    expect(view.result.current.watchlist).toEqual(['AAPL']);
  });

  it('rolls back a rejected write, preserves a different successful change, and shows a safe error', async () => {
    localStorage.setItem('vs-watchlist:1', JSON.stringify(['AAPL']));
    const rejected = deferred();
    vi.stubGlobal(
      'fetch',
      vi.fn((url) =>
        url.endsWith('/AAPL')
          ? rejected.promise
          : Promise.resolve(response(url === '/api/watchlist' ? ['AAPL'] : { ok: true }))
      )
    );
    const view = renderWatchlist();
    await waitFor(() => expect(view.result.current.watchlist).toEqual(['AAPL']));
    let removal;
    act(() => {
      removal = view.result.current.toggleWatchlistTicker('AAPL');
    });
    await act(() => view.result.current.toggleWatchlistTicker('MSFT'));
    await act(async () => {
      rejected.resolve(response({ error: 'raw DB error' }, false));
      await removal;
    });
    expect(view.result.current.watchlist).toEqual(['AAPL', 'MSFT']);
    expect(view.result.current.watchlistError).toBe("We couldn't save your watchlist change. Please try again.");
  });

  it('deduplicates simultaneous toggles of the same ticker', async () => {
    const save = deferred();
    const fetch = vi.fn((url) => (url === '/api/watchlist' ? Promise.resolve(response([])) : save.promise));
    vi.stubGlobal('fetch', fetch);
    const view = renderWatchlist();
    await act(async () => {});
    let first;
    act(() => {
      first = view.result.current.toggleWatchlistTicker('AAPL');
      view.result.current.toggleWatchlistTicker('AAPL');
    });
    expect(view.result.current.watchlist).toEqual(['AAPL']);
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/AAPL'))).toHaveLength(1);
    await act(async () => {
      save.resolve(response({ ok: true }));
      await first;
    });
  });

  it('aborts old-owner requests and never writes old data to the new cache', async () => {
    const oldSync = deferred();
    let oldSignal;
    vi.stubGlobal(
      'fetch',
      vi.fn((url, options) => {
        if (options.headers.Authorization === 'Bearer synthetic-one') {
          oldSignal = options.signal;
          return oldSync.promise;
        }
        return Promise.resolve(response(['MSFT']));
      })
    );
    const view = renderWatchlist();
    view.rerender({ user: { id: 2 }, getToken: () => 'synthetic-two', storageKey: 'vs-watchlist:2' });
    await waitFor(() => expect(view.result.current.watchlist).toEqual(['MSFT']));
    expect(oldSignal.aborted).toBe(true);
    await act(() => oldSync.resolve(response(['AAPL'])));
    expect(view.result.current.watchlist).toEqual(['MSFT']);
    expect(localStorage.getItem('vs-watchlist:2')).toBe('["MSFT"]');
  });

  it('does not accept a body that arrives after token rotation or unmount', async () => {
    const body = deferred();
    let token = 'synthetic-one';
    let signal;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        signal = options.signal;
        return url === '/api/watchlist' ? response(['AAPL']) : { ok: true, json: () => body.promise };
      })
    );
    const getToken = () => token;
    const view = renderWatchlist({ getToken });
    await waitFor(() => expect(view.result.current.watchlist).toEqual(['AAPL']));
    let pending;
    await act(async () => {
      pending = view.result.current.refreshWatchlist();
    });
    token = 'synthetic-rotated';
    view.rerender({ user: { id: 1 }, getToken, storageKey: 'vs-watchlist:1' });
    expect(signal.aborted).toBe(false); // new sync owns a separate signal
    await act(async () => {
      body.resolve({ results: [{ symbol: 'AAPL', price: 99 }] });
      await pending;
    });
    expect(view.result.current.watchlistData).toBeNull();
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it('deduplicates refreshes, filters unrequested/duplicate rows and retains only a source timestamp', async () => {
    const quotes = deferred();
    const fetch = vi.fn((url) => (url === '/api/watchlist' ? Promise.resolve(response(['AAPL'])) : quotes.promise));
    vi.stubGlobal('fetch', fetch);
    const view = renderWatchlist();
    await waitFor(() => expect(view.result.current.watchlist).toEqual(['AAPL']));
    let pending;
    act(() => {
      pending = view.result.current.refreshWatchlist();
      view.result.current.refreshWatchlist();
    });
    expect(fetch.mock.calls.filter(([url]) => url.startsWith('/api/watchlist-quotes'))).toHaveLength(1);
    await act(async () => {
      quotes.resolve(
        response({
          results: [
            { symbol: 'AAPL', price: 99 },
            { symbol: 'AAPL', price: 10 },
            { symbol: 'MSFT', price: 11 },
          ],
          dataAsOf: '2026-01-02T18:00:00Z',
          quoteDataStatus: 'stale',
        })
      );
      await pending;
    });
    expect(view.result.current.watchlistData).toEqual([{ symbol: 'AAPL', price: 99 }]);
    expect(view.result.current.watchlistDataAsOf).toBe('2026-01-02T18:00:00Z');
    expect(view.result.current.watchlistQuoteStatus).toBe('stale');
    expect(view.result.current.watchlistLoading).toBe(false);
  });

  it('keeps the last quote and its real timestamp on provider failure, without exposing raw errors', async () => {
    let fails = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        url === '/api/watchlist'
          ? response(['AAPL'])
          : fails
            ? response({ error: 'raw provider stack' }, false)
            : response({
                results: [{ symbol: 'AAPL', price: 99 }],
                dataAsOf: '2026-01-02T18:00:00Z',
                quoteDataStatus: 'complete',
              })
      )
    );
    const view = renderWatchlist();
    await waitFor(() => expect(view.result.current.watchlist).toEqual(['AAPL']));
    await act(() => view.result.current.refreshWatchlist());
    fails = true;
    await act(() => view.result.current.refreshWatchlist());
    expect(view.result.current.watchlistData[0].price).toBe(99);
    expect(view.result.current.watchlistDataAsOf).toBe('2026-01-02T18:00:00Z');
    expect(view.result.current.watchlistError).toBe('Prices are temporarily unavailable. Please try again.');
  });

  it('does not replace old quotes with a malformed result or use request time as quote time', async () => {
    let malformed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        url === '/api/watchlist'
          ? response(['AAPL'])
          : response(
              malformed
                ? { results: [null] }
                : {
                    results: [],
                    fetchTime: new Date().toISOString(),
                    dataAsOf: '2999-01-01T00:00:00Z',
                    dataStatus: 'unavailable',
                  }
            )
      )
    );
    const view = renderWatchlist();
    await waitFor(() => expect(view.result.current.watchlist).toEqual(['AAPL']));
    await act(() => view.result.current.refreshWatchlist());
    expect(view.result.current.watchlistDataAsOf).toBeNull();
    expect(view.result.current.watchlistError).toBeTruthy();
    malformed = true;
    await act(() => view.result.current.refreshWatchlist());
    expect(view.result.current.watchlistData).toEqual([]);
  });

  it('bounds a stalled refresh to thirty seconds and leaves no timer after unmount', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((url, options) =>
        url === '/api/watchlist'
          ? Promise.resolve(response(['AAPL']))
          : new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('abort'))))
      )
    );
    const view = renderWatchlist();
    await act(async () => {});
    let pending;
    act(() => {
      pending = view.result.current.refreshWatchlist();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
      await pending;
    });
    expect(view.result.current.watchlistLoading).toBe(false);
    expect(view.result.current.watchlistError).toBeTruthy();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
