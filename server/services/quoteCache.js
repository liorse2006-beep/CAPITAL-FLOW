/**
 * quoteCache — shared Yahoo Finance quote layer for all scanners.
 *
 * Why this exists:
 *  - yahoo-finance2 supports array input: quote([sym1, sym2, ...]) → one HTTP
 *    request for all symbols. Without this, every scanner called quote(symbol)
 *    per ticker → 516 HTTP requests per scan → Yahoo rate-limits the server IP.
 *  - A 3-minute cache means a manual scan right after the background scan costs
 *    zero Yahoo requests. Multiple concurrent scans share the same data.
 *  - Retry with exponential backoff survives transient 429s without crashing.
 */

const yahooFinance = require('./yahoo');

const BATCH_SIZE = 100;           // symbols per HTTP call (Yahoo handles 200+ but 100 is safe)
const CACHE_TTL_MS = 3 * 60 * 1000;  // 3 minutes
const INTER_BATCH_DELAY_MS = 150;
const MAX_RETRIES = 2;
// Maximum age for stale fallback entries. Beyond this limit we refuse to serve
// them — it is better to show no data than silently show volume figures from
// an hour ago while claiming the scan just ran. 10 min gives enough cushion
// for a brief Yahoo outage without risking badly misleading results.
const MAX_STALE_AGE_MS = 10 * 60 * 1000;

// symbol → { data: QuoteResult, fetchedAt: number }
const cache = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isFresh(entry) {
  return entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

async function fetchBatch(symbols) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // validateResult:false — if any symbol has an unexpected field Yahoo returns,
      // the library normally throws and we'd lose the entire batch of 100. With
      // this option it skips schema validation and returns whatever data Yahoo sent.
      const results = await yahooFinance.quote(symbols, {}, { validateResult: false });
      const arr = Array.isArray(results) ? results : results ? [results] : [];
      const now = Date.now();
      arr.forEach((q) => {
        if (q && q.symbol) cache.set(q.symbol, { data: q, fetchedAt: now });
      });
      return arr;
    } catch (err) {
      const msg = (err && err.message) || '';
      const is429 = msg.includes('429') || msg.includes('Too Many') || msg.includes('rate limit');
      if (is429 && attempt < MAX_RETRIES) {
        const delay = 3000 * Math.pow(2, attempt); // 3 s → 6 s
        console.warn(`[QuoteCache] Yahoo rate limited — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
        await sleep(delay);
        continue;
      }
      // All retries exhausted — serve stale cache entries only if they are
      // recent enough (< MAX_STALE_AGE_MS). Entries older than that are
      // rejected: showing 10-minute-old volume as "just scanned" is
      // misleading enough to cause a bad trade. Better to omit the symbol
      // entirely and let the scan return fewer results than fabricate freshness.
      const now = Date.now();
      const stale = symbols
        .map((s) => {
          const e = cache.get(s);
          return e && (now - e.fetchedAt) < MAX_STALE_AGE_MS ? e.data : null;
        })
        .filter(Boolean);
      if (stale.length > 0) {
        console.warn(`[QuoteCache] Yahoo failed — serving ${stale.length}/${symbols.length} recent stale entries (< ${MAX_STALE_AGE_MS / 60000} min old): ${msg}`);
      } else {
        console.error(`[QuoteCache] Batch failed, no usable stale fallback (${symbols[0]}…${symbols[symbols.length - 1]}): ${msg}`);
      }
      return stale;
    }
  }
  // Loop exhausted without returning — same age-limited stale fallback
  const now2 = Date.now();
  return symbols
    .map((s) => { const e = cache.get(s); return e && (now2 - e.fetchedAt) < MAX_STALE_AGE_MS ? e.data : null; })
    .filter(Boolean);
}

/**
 * Get quotes for all `symbols`.
 * - Symbols with a fresh cache entry are returned instantly (no HTTP).
 * - The rest are fetched from Yahoo in batches of BATCH_SIZE (one HTTP call each).
 *
 * @param {string[]} symbols
 * @param {(fetched: number, total: number) => void} [onBatchDone]  progress hook
 * @returns {Promise<Map<string, object>>}  symbol → QuoteResult
 */
async function getQuotes(symbols, onBatchDone) {
  const result = new Map();
  const toFetch = [];

  for (const sym of symbols) {
    const entry = cache.get(sym);
    if (isFresh(entry)) {
      result.set(sym, entry.data);
    } else {
      toFetch.push(sym);
    }
  }

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    const quotes = await fetchBatch(batch);
    quotes.forEach((q) => {
      if (q && q.symbol) result.set(q.symbol, q);
    });
    if (onBatchDone) onBatchDone(Math.min(i + batch.length, toFetch.length), toFetch.length);
    if (i + BATCH_SIZE < toFetch.length) await sleep(INTER_BATCH_DELAY_MS);
  }

  return result;
}

module.exports = { getQuotes };
