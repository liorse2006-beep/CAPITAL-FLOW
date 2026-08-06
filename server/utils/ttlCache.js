// Small in-memory TTL cache for short-lived, expensive-to-refetch responses
// (a chart route's full computed payload, etc). Deliberately not a generic
// LRU/size-bounded cache — every user of this module keys on a small,
// naturally bounded set (symbols, periods), so unbounded growth isn't a
// real risk and a Map is simpler to reason about than an eviction policy.
function createTTLCache(ttlMs) {
  const store = new Map();

  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.setAt >= ttlMs) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function set(key, value) {
    store.set(key, { value, setAt: Date.now() });
  }

  return { get, set };
}

module.exports = { createTTLCache };
