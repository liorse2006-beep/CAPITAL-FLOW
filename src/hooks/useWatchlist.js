import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import useAccountOperation from './useAccountOperation';

const SYMBOL = /^[A-Z0-9.-]{1,10}$/;
const MAX_SIZE = 50;
const QUOTE_ERROR = 'Prices are temporarily unavailable. Please try again.';
const SAVE_ERROR = "We couldn't save your watchlist change. Please try again.";

function normalizeList(value) {
  if (!Array.isArray(value)) return null;
  const list = value.map((s) => (typeof s === 'string' ? s.trim().toUpperCase() : ''));
  if (list.some((s) => !SYMBOL.test(s)) || list.length > MAX_SIZE) return null;
  return [...new Set(list)];
}

function cachedList(key) {
  try {
    return normalizeList(JSON.parse(localStorage.getItem(key))) || [];
  } catch {
    return [];
  }
}

function saveCache(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // The authenticated server remains authoritative when browser storage is unavailable.
  }
}

export default function useWatchlist({ user, getToken, storageKey }) {
  const userId = user?.id ?? null;
  const sessionToken = getToken?.() || '';
  const startOperation = useAccountOperation(getToken, `${userId ?? 'guest'}:${sessionToken}`);
  const [watchlist, setWatchlist] = useState(() => cachedList(storageKey));
  const [watchlistData, setWatchlistData] = useState(null);
  const [watchlistDataAsOf, setWatchlistDataAsOf] = useState(null);
  const [watchlistQuoteStatus, setWatchlistQuoteStatus] = useState('unknown');
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState(null);
  const listRef = useRef(watchlist);
  const revision = useRef(0);

  const updateList = useCallback(
    (list) => {
      listRef.current = list;
      setWatchlist(list);
      saveCache(storageKey, list);
    },
    [storageKey]
  );

  useLayoutEffect(() => {
    listRef.current = cachedList(storageKey);
    revision.current++;
    setWatchlist(listRef.current);
    setWatchlistData(null);
    setWatchlistDataAsOf(null);
    setWatchlistQuoteStatus('unknown');
    setWatchlistLoading(false);
    setWatchlistError(null);
  }, [storageKey, userId, sessionToken]);

  useEffect(() => {
    if (userId === null || !sessionToken) return undefined;
    const operation = startOperation('watchlist-sync');
    if (!operation) return undefined;
    const beforeSync = revision.current;
    (async () => {
      try {
        const response = await fetch('/api/watchlist', {
          headers: { Authorization: 'Bearer ' + operation.token },
          signal: operation.signal,
        });
        if (!response.ok) throw new Error('sync');
        const list = normalizeList(await response.json());
        if (!list) throw new Error('shape');
        if (operation.canCommit() && revision.current === beforeSync) updateList(list);
      } catch {
        if (operation.isCurrent() && revision.current === beforeSync) {
          setWatchlistError("We couldn't load your saved watchlist. Please try again.");
        }
      } finally {
        operation.finish();
      }
    })();
    return operation.cancel;
  }, [startOperation, updateList, userId, sessionToken]);

  async function toggleWatchlistTicker(value) {
    const symbol = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!SYMBOL.test(symbol)) return;
    const before = listRef.current;
    const oldIndex = before.indexOf(symbol);
    if (oldIndex < 0 && before.length >= MAX_SIZE) {
      setWatchlistError('Your watchlist is full. Remove a ticker before adding another.');
      return;
    }
    const operation = userId === null ? null : startOperation('watchlist-save:' + symbol);
    if (userId !== null && !operation) return;
    revision.current++;
    updateList(oldIndex >= 0 ? before.filter((s) => s !== symbol) : [...before, symbol]);
    setWatchlistError(null);
    if (!operation) return;
    try {
      const response = await fetch('/api/watchlist/' + encodeURIComponent(symbol), {
        method: oldIndex >= 0 ? 'DELETE' : 'POST',
        headers: { Authorization: 'Bearer ' + operation.token },
        signal: operation.signal,
      });
      if (!response.ok || (await response.json())?.ok !== true) throw new Error('save');
    } catch {
      if (operation.isCurrent()) {
        const current = listRef.current.filter((s) => s !== symbol);
        if (oldIndex >= 0) current.splice(Math.min(oldIndex, current.length), 0, symbol);
        updateList(current);
        setWatchlistError(SAVE_ERROR);
      }
    } finally {
      operation.finish();
    }
  }

  async function refreshWatchlist() {
    const requested = [...listRef.current];
    if (!requested.length) {
      setWatchlistData(null);
      return;
    }
    const operation = startOperation('watchlist-quotes');
    if (!operation) return;
    const beforeRefresh = revision.current;
    setWatchlistLoading(true);
    setWatchlistError(null);
    try {
      const response = await fetch('/api/watchlist-quotes?symbols=' + encodeURIComponent(requested.join(',')), {
        headers: { Authorization: 'Bearer ' + operation.token },
        signal: operation.signal,
      });
      if (!response.ok) throw new Error('quotes');
      const data = await response.json();
      if (!Array.isArray(data?.results) || data.results.some((r) => !r || typeof r.symbol !== 'string')) {
        throw new Error('shape');
      }
      if (!operation.canCommit() || revision.current !== beforeRefresh) return;
      const seen = new Set();
      setWatchlistData(
        data.results.filter((r) => {
          if (!requested.includes(r.symbol) || seen.has(r.symbol)) return false;
          seen.add(r.symbol);
          return true;
        })
      );
      const asOf = typeof data.dataAsOf === 'string' ? Date.parse(data.dataAsOf) : NaN;
      setWatchlistDataAsOf(Number.isFinite(asOf) && asOf > 0 && asOf <= Date.now() ? data.dataAsOf : null);
      setWatchlistQuoteStatus(
        ['complete', 'stale', 'unavailable'].includes(data.quoteDataStatus) ? data.quoteDataStatus : 'unknown'
      );
      if (data.dataStatus === 'unavailable') setWatchlistError(QUOTE_ERROR);
    } catch {
      if (operation.isCurrent()) setWatchlistError(QUOTE_ERROR);
    } finally {
      operation.finish();
      if (operation.isCurrent()) setWatchlistLoading(false);
    }
  }

  return {
    watchlist,
    watchlistData,
    watchlistDataAsOf,
    watchlistQuoteStatus,
    watchlistLoading,
    watchlistError,
    setWatchlistError,
    refreshWatchlist,
    toggleWatchlistTicker,
    isInWatchlist: (symbol) => listRef.current.includes(symbol),
  };
}
