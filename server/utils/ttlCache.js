// User-selected tickers and periods are not naturally bounded. Expired entries
// must not stay resident forever simply because nobody requests that key again.
function createTTLCache(ttlMs, { maxEntries = 500 } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
    throw new TypeError('Cache lifetime and entry limit must be positive finite values');
  }
  const store = new Map();

  function pruneExpired(current = Date.now()) {
    for (const [key, entry] of store) {
      if (current - entry.setAt >= ttlMs) store.delete(key);
    }
  }

  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.setAt >= ttlMs) {
      store.delete(key);
      return undefined;
    }
    // Refresh eviction priority, never the observation/cache lifetime.
    store.delete(key);
    store.set(key, entry);
    return entry.value;
  }

  function set(key, value) {
    pruneExpired();
    store.delete(key);
    while (store.size >= maxEntries) store.delete(store.keys().next().value);
    store.set(key, { value, setAt: Date.now() });
  }

  return {
    get,
    set,
    get size() {
      pruneExpired();
      return store.size;
    },
  };
}

module.exports = { createTTLCache };
