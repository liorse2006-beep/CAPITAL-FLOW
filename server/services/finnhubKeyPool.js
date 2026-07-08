// Rotates across every configured Finnhub account so a single account's free
// rate limit (60/min) never causes a scan to come back with missing or
// stale enrichment data. Keys are round-robined on every call; a key that
// gets rate-limited (HTTP 429) is put on a 65s cooldown and skipped until
// it recovers, so requests automatically fall through to the next account.
const { FINNHUB_API_KEY, FINNHUB_API_KEY_POOL } = require('../config');

const keys = [...new Set([FINNHUB_API_KEY, ...FINNHUB_API_KEY_POOL].filter(Boolean))];

let cursor = 0;
const cooldownUntil = new Map(); // key -> timestamp ms until which it's skipped

/** Returns the next available key, skipping any currently on cooldown. */
function getKey() {
  if (keys.length === 0) return '';
  const now = Date.now();
  for (let i = 0; i < keys.length; i++) {
    const idx = (cursor + i) % keys.length;
    const k = keys[idx];
    if (!(cooldownUntil.get(k) > now)) {
      cursor = (idx + 1) % keys.length;
      return k;
    }
  }
  // Every key is cooling down — hand back the least-stale one rather than
  // failing outright; Finnhub will just reject it and the caller no-ops.
  cursor = (cursor + 1) % keys.length;
  return keys[cursor];
}

/** Call when a request using `key` comes back rate-limited (HTTP 429). */
function reportRateLimited(key) {
  if (!key) return;
  cooldownUntil.set(key, Date.now() + 65 * 1000);
}

function poolSize() { return keys.length; }

module.exports = { getKey, reportRateLimited, poolSize };
