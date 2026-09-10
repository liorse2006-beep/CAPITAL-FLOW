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
const { fetchYahooChartQuotes } = require('./yahooChartFallback');
const { createCircuitBreaker } = require('../utils/circuitBreaker');
const { redact } = require('../utils/reportError');
const { isMarketOpen, isPreMarket } = require('./marketCalendar');

// Opens after 5 consecutive batch failures (real network/5xx failures —
// the 429 branch below already retries those without going through the
// breaker's own failure count) and stays open for 20s, so a Yahoo outage
// stops burning a request per scan instead of every caller paying the
// same timeout/retry cost simultaneously.
const yahooBreaker = createCircuitBreaker('yahoo-quote', { failureThreshold: 5, cooldownMs: 20000 });

const BATCH_SIZE = 100; // symbols per HTTP call (Yahoo handles 200+ but 100 is safe)
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
const INTER_BATCH_DELAY_MS = 150;
const MAX_RETRIES = 2;
// Retry a partial response once at the same batch size. Smaller retry chunks
// multiply requests during a provider incident and make Yahoo rate-limit the
// very scan we are trying to recover.
const MISSING_SYMBOL_RETRY_BATCH_SIZE = BATCH_SIZE;
const MAX_LIVE_PROVIDER_AGE_MS = 45 * 60 * 1000;
const MAX_OFF_HOURS_PROVIDER_AGE_MS = 36 * 60 * 60 * 1000;
const MAX_CLOSED_PROVIDER_AGE_MS = 5 * 24 * 60 * 60 * 1000;
const SUMMARY_RECOVERY_CONCURRENCY = 3;
const MAX_SUMMARY_RECOVERY_SYMBOLS = 25;
// A provider incident must not turn one scan into hundreds of individual
// fallback requests. Six symbols are enough for the independent health probe;
// larger scans remain explicitly partial rather than hiding missing coverage.
const MAX_DIRECT_CHART_FALLBACK_SYMBOLS = 6;
const DIRECT_CHART_FALLBACK_ENABLED =
  process.env.NODE_ENV === 'production' || String(process.env.YAHOO_CHART_FALLBACK_ENABLED || '').trim() === 'true';
// Maximum age for stale fallback entries. Beyond this limit we refuse to serve
// them — it is better to show no data than silently show volume figures from
// an hour ago while claiming the scan just ran. 10 min gives enough cushion
// for a brief Yahoo outage without risking badly misleading results.
const MAX_STALE_AGE_MS = 10 * 60 * 1000;

// symbol → { data: QuoteResult, fetchedAt: number }
const cache = new Map();
// Exact concurrent requests share one provider operation. This protects the
// free Yahoo endpoint when several users open the same scanner at once and
// avoids turning a traffic spike into duplicate upstream calls.
const inFlightRequests = new Map();

function parseProviderTimestamp(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    // Yahoo normally returns epoch seconds; accept milliseconds as well so a
    // provider-shape change cannot silently turn a real timestamp into 1970.
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

function providerTimestampMs(quote) {
  // During pre/post-market windows Yahoo can expose a newer pre/post quote
  // alongside an older regular-session timestamp.  Taking the first field
  // would report the old close and make a live quote look stale.  The latest
  // provider timestamp is the truthful timestamp for the quote we received.
  const timestamps = [quote?.regularMarketTime, quote?.postMarketTime, quote?.preMarketTime]
    .map(parseProviderTimestamp)
    .filter((value) => value !== null);
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

function maxProviderAgeMs(now = new Date()) {
  if (isMarketOpen(now)) return MAX_LIVE_PROVIDER_AGE_MS;
  if (isPreMarket(now)) return MAX_OFF_HOURS_PROVIDER_AGE_MS;
  return MAX_CLOSED_PROVIDER_AGE_MS;
}

function isProviderTimestampStale(quote) {
  const timestamp = providerTimestampMs(quote);
  return timestamp !== null && Date.now() - timestamp > maxProviderAgeMs(new Date());
}

function normalizeSymbol(symbol) {
  return String(symbol || '')
    .trim()
    .toUpperCase();
}

// Yahoo's quote endpoint uses hyphens for class-share symbols while the
// product and Finnhub use the conventional dot form (BRK.B / BF.B).  Keep the
// product-facing symbol stable and translate only at the Yahoo boundary.
function toYahooSymbol(symbol) {
  return normalizeSymbol(symbol).replace(/\./g, '-');
}

function normalizeProviderQuotes(rows, requestedSymbols) {
  const requestedByYahooSymbol = new Map(
    requestedSymbols.map((symbol) => [toYahooSymbol(symbol), normalizeSymbol(symbol)])
  );
  return rows
    .filter((quote) => quote && quote.symbol)
    .map((quote) => {
      const providerSymbol = normalizeSymbol(quote.symbol);
      const requestedSymbol = requestedByYahooSymbol.get(providerSymbol) || providerSymbol;
      return requestedSymbol === quote.symbol ? quote : { ...quote, symbol: requestedSymbol };
    });
}

function yahooValue(value) {
  // quoteSummary can return either a plain primitive or Yahoo's { raw, fmt }
  // wrapper depending on the module and yahoo-finance2 version.
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'raw')) {
    return value.raw;
  }
  return value;
}

function normalizeSummaryQuote(summary, requestedSymbol) {
  const price = summary?.price || {};
  const detail = summary?.summaryDetail || {};
  const value = (key) => yahooValue(price[key] ?? detail[key]);
  const symbol = normalizeSymbol(requestedSymbol);
  const regularMarketTime = value('regularMarketTime');
  const regularMarketPrice = value('regularMarketPrice');
  const regularMarketVolume = value('regularMarketVolume');
  const averageDailyVolume10Day = value('averageDailyVolume10Day');
  const marketCap = value('marketCap');

  if (
    !symbol ||
    !Number.isFinite(Number(regularMarketPrice)) ||
    Number(regularMarketPrice) <= 0 ||
    !Number.isFinite(Number(regularMarketVolume)) ||
    Number(regularMarketVolume) <= 0 ||
    !Number.isFinite(Number(averageDailyVolume10Day)) ||
    Number(averageDailyVolume10Day) <= 0 ||
    !Number.isFinite(Number(marketCap)) ||
    Number(marketCap) <= 0
  ) {
    return null;
  }

  return {
    symbol,
    shortName: yahooValue(price.shortName) || yahooValue(price.longName) || symbol,
    longName: yahooValue(price.longName) || yahooValue(price.shortName) || symbol,
    regularMarketPrice: Number(regularMarketPrice),
    regularMarketTime,
    postMarketTime: value('postMarketTime'),
    preMarketTime: value('preMarketTime'),
    regularMarketVolume: Number(regularMarketVolume),
    averageDailyVolume10Day: Number(averageDailyVolume10Day),
    marketCap: Number(marketCap),
    regularMarketChangePercent: Number(yahooValue(price.regularMarketChangePercent)),
    regularMarketDayHigh: Number(yahooValue(price.regularMarketDayHigh)),
    regularMarketDayLow: Number(yahooValue(price.regularMarketDayLow)),
    regularMarketPreviousClose: Number(yahooValue(price.regularMarketPreviousClose)),
    exchange: yahooValue(price.exchange),
    fiftyTwoWeekHigh: Number(yahooValue(detail.fiftyTwoWeekHigh)),
    fiftyTwoWeekLow: Number(yahooValue(detail.fiftyTwoWeekLow)),
    floatShares: Number(yahooValue(detail.floatShares)),
    shortPercentOfFloat: Number(yahooValue(detail.shortPercentOfFloat)),
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);

  async function run() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index]);
      } catch (_) {
        results[index] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, run));
  return results;
}

async function directChartRecovery(symbols) {
  if (!DIRECT_CHART_FALLBACK_ENABLED || !symbols.length) return [];
  return fetchYahooChartQuotes(symbols.slice(0, MAX_DIRECT_CHART_FALLBACK_SYMBOLS), { concurrency: 2 });
}

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
      const providerSymbols = symbols.map(toYahooSymbol);
      const results = await yahooBreaker.execute(() =>
        yahooFinance.quote(providerSymbols, {}, { validateResult: false })
      );
      let arr = normalizeProviderQuotes(Array.isArray(results) ? results : results ? [results] : [], symbols);
      const providerStaleSymbols = new Set();

      const keepFreshProviderRows = (rows) =>
        rows.filter((quote) => {
          if (!isProviderTimestampStale(quote)) return true;
          providerStaleSymbols.add(normalizeSymbol(quote.symbol));
          return false;
        });

      arr = keepFreshProviderRows(arr);

      // Yahoo occasionally returns a successful HTTP response without every
      // requested symbol.  Retrying only the missing subset recovers transient
      // omissions and keeps the normal scan at six batched requests instead of
      // fanning out one request per ticker.  Symbols that remain absent are
      // still reported as errors by the scanner; they are never fabricated.
      const returned = new Set(arr.map((quote) => normalizeSymbol(quote.symbol)));
      const missing = symbols.filter((symbol) => !returned.has(normalizeSymbol(symbol)));
      if (missing.length > 0) {
        for (let i = 0; i < missing.length; i += MISSING_SYMBOL_RETRY_BATCH_SIZE) {
          const retrySymbols = missing.slice(i, i + MISSING_SYMBOL_RETRY_BATCH_SIZE);
          try {
            const retryRows = await yahooBreaker.execute(() =>
              yahooFinance.quote(retrySymbols.map(toYahooSymbol), {}, { validateResult: false })
            );
            arr = arr.concat(
              keepFreshProviderRows(
                normalizeProviderQuotes(
                  Array.isArray(retryRows) ? retryRows : retryRows ? [retryRows] : [],
                  retrySymbols
                )
              )
            );
          } catch (_) {
            // The original batch is still useful.  Leave the missing symbols
            // absent so the caller can surface partial/unavailable data.
          }
        }
      }

      // Yahoo's quote endpoint can omit a valid symbol while its summary
      // endpoint still has a complete, timestamped quote. Recover only the
      // bounded missing set through that endpoint. A stale or incomplete
      // summary is rejected by the same freshness gate below, never used as a
      // synthetic live result.
      const stillMissing = symbols
        .filter((symbol) => !new Set(arr.map((quote) => normalizeSymbol(quote.symbol))).has(normalizeSymbol(symbol)))
        .slice(0, MAX_SUMMARY_RECOVERY_SYMBOLS);
      if (stillMissing.length > 0) {
        const summaryRows = await mapWithConcurrency(stillMissing, SUMMARY_RECOVERY_CONCURRENCY, async (symbol) => {
          const summary = await yahooBreaker.execute(() =>
            yahooFinance.quoteSummary(
              toYahooSymbol(symbol),
              { modules: ['price', 'summaryDetail'] },
              { validateResult: false }
            )
          );
          return normalizeSummaryQuote(summary, symbol);
        });
        arr = arr.concat(keepFreshProviderRows(summaryRows.filter(Boolean)));
      }

      // yahoo-finance2's quote endpoint can be unavailable while Yahoo's
      // timestamped chart/timeseries endpoints remain healthy. Recover only a
      // bounded set through that independent public read path.
      const directMissing = symbols
        .filter((symbol) => !new Set(arr.map((quote) => normalizeSymbol(quote.symbol))).has(normalizeSymbol(symbol)))
        .slice(0, MAX_DIRECT_CHART_FALLBACK_SYMBOLS);
      if (directMissing.length > 0) {
        arr = arr.concat(await directChartRecovery(directMissing));
      }
      const now = Date.now();
      arr.forEach((q) => {
        if (q && q.symbol) cache.set(normalizeSymbol(q.symbol), { data: q, fetchedAt: now });
      });
      return {
        quotes: arr,
        providerStaleSymbols: [...providerStaleSymbols],
        usedStaleFallback: false,
        providerFailure: false,
        fallbackProvider: arr.some((quote) => quote?.quoteProvider) ? 'Yahoo Finance Chart API' : null,
      };
    } catch (err) {
      const msg = (err && err.message) || '';
      const safeMsg = redact(msg);
      const is429 = msg.includes('429') || msg.includes('Too Many') || msg.includes('rate limit');
      if (is429 && attempt < MAX_RETRIES) {
        const delay = 3000 * Math.pow(2, attempt); // 3 s → 6 s
        console.warn(`[QuoteCache] Yahoo rate limited — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
        await sleep(delay);
        continue;
      }
      // Before using stale cache, try a bounded timestamped chart recovery.
      // This is the no-cost failover path; it is still rejected when any
      // required field is missing, so it cannot manufacture scan rows.
      const directRows = await directChartRecovery(symbols);
      if (directRows.length > 0) {
        const recovered = new Set(directRows.map((quote) => normalizeSymbol(quote.symbol)));
        const now = Date.now();
        directRows.forEach((quote) => cache.set(normalizeSymbol(quote.symbol), { data: quote, fetchedAt: now }));
        return {
          quotes: directRows,
          providerStaleSymbols: [],
          staleSymbols: [],
          usedStaleFallback: false,
          providerFailure: recovered.size < symbols.length,
          fallbackProvider: 'Yahoo Finance Chart API',
        };
      }

      // All retries exhausted — serve stale cache entries only if they are
      // recent enough (< MAX_STALE_AGE_MS). Entries older than that are
      // rejected: showing 10-minute-old volume as "just scanned" is
      // misleading enough to cause a bad trade. Better to omit the symbol
      // entirely and let the scan return fewer results than fabricate freshness.
      const now = Date.now();
      const stale = symbols
        .map((s) => {
          const e = cache.get(normalizeSymbol(s));
          return e && now - e.fetchedAt < MAX_STALE_AGE_MS ? e.data : null;
        })
        .filter(Boolean);
      const staleSymbols = symbols.filter((symbol) => {
        const entry = cache.get(normalizeSymbol(symbol));
        return entry && now - entry.fetchedAt < MAX_STALE_AGE_MS;
      });
      if (stale.length > 0) {
        console.warn(
          `[QuoteCache] Yahoo failed — serving ${stale.length}/${symbols.length} recent stale entries (< ${MAX_STALE_AGE_MS / 60000} min old): ${safeMsg}`
        );
      } else {
        console.error(
          `[QuoteCache] Batch failed, no usable stale fallback (${symbols[0]}…${symbols[symbols.length - 1]}): ${safeMsg}`
        );
      }
      return {
        quotes: stale,
        providerStaleSymbols: [],
        staleSymbols,
        usedStaleFallback: stale.length > 0,
        providerFailure: true,
        fallbackProvider: null,
      };
    }
  }
  // Loop exhausted without returning — same age-limited stale fallback
  const now2 = Date.now();
  return {
    quotes: symbols
      .map((s) => {
        const e = cache.get(normalizeSymbol(s));
        return e && now2 - e.fetchedAt < MAX_STALE_AGE_MS ? e.data : null;
      })
      .filter(Boolean),
    providerStaleSymbols: [],
    staleSymbols: [],
    usedStaleFallback: false,
    providerFailure: true,
    fallbackProvider: null,
  };
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
async function fetchQuotes(symbols, onBatchDone) {
  const result = new Map();
  const toFetch = [];
  let oldestProviderTimestamp = null;
  let staleCount = 0;
  const staleSymbols = new Set();
  const providerStaleSymbols = new Set();
  let usedStaleFallback = false;
  let providerFailure = false;
  const fallbackProviders = new Set();

  function recordUsedQuote(symbol, quote) {
    const entry = cache.get(symbol);
    if (!entry) return;
    const timestamp = providerTimestampMs(quote || entry.data);
    if (timestamp !== null && (oldestProviderTimestamp === null || timestamp < oldestProviderTimestamp)) {
      oldestProviderTimestamp = timestamp;
    }
    if (Date.now() - entry.fetchedAt >= CACHE_TTL_MS) staleCount++;
  }

  for (const sym of symbols) {
    const normalizedSymbol = normalizeSymbol(sym);
    const entry = cache.get(normalizedSymbol);
    if (isFresh(entry)) {
      result.set(normalizedSymbol, entry.data);
      recordUsedQuote(normalizedSymbol, entry.data);
    } else {
      toFetch.push(sym);
    }
  }

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    const batchResult = await fetchBatch(batch);
    usedStaleFallback = usedStaleFallback || batchResult.usedStaleFallback === true;
    providerFailure = providerFailure || batchResult.providerFailure === true;
    if (batchResult.fallbackProvider) fallbackProviders.add(batchResult.fallbackProvider);
    (batchResult.staleSymbols || []).forEach((symbol) => staleSymbols.add(symbol));
    (batchResult.providerStaleSymbols || []).forEach((symbol) => providerStaleSymbols.add(symbol));
    batchResult.quotes.forEach((q) => {
      if (q && q.symbol) {
        const normalizedSymbol = normalizeSymbol(q.symbol);
        result.set(normalizedSymbol, q);
        recordUsedQuote(normalizedSymbol, q);
      }
    });
    if (onBatchDone) onBatchDone(Math.min(i + batch.length, toFetch.length), toFetch.length);
    if (i + BATCH_SIZE < toFetch.length) await sleep(INTER_BATCH_DELAY_MS);
  }

  // Map metadata is intentionally non-enumerable from the perspective of
  // callers iterating the map, but gives scanners an honest provider time.
  // In particular, a recent stale fallback must not be reported as if it were
  // fetched at the moment the scan request completed.
  Object.defineProperties(result, {
    dataAsOf: {
      value: oldestProviderTimestamp === null ? null : new Date(oldestProviderTimestamp).toISOString(),
      enumerable: false,
    },
    staleCount: { value: staleCount, enumerable: false },
    staleSymbols: { value: [...staleSymbols], enumerable: false },
    providerStaleSymbols: { value: [...providerStaleSymbols], enumerable: false },
    usedStaleFallback: { value: usedStaleFallback, enumerable: false },
    providerFailure: { value: providerFailure, enumerable: false },
    fallbackProvider: {
      value: fallbackProviders.size ? [...fallbackProviders].join(' + ') : null,
      enumerable: false,
    },
  });
  return result;
}

function quoteRequestKey(symbols) {
  return [...new Set(symbols.map(normalizeSymbol).filter(Boolean))].sort().join('\u0000');
}

async function getQuotes(symbols, onBatchDone) {
  const key = quoteRequestKey(symbols);
  const existing = inFlightRequests.get(key);
  if (existing) {
    const result = await existing;
    if (onBatchDone) onBatchDone(symbols.length, symbols.length);
    return result;
  }

  const request = fetchQuotes(symbols, onBatchDone);
  inFlightRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
  }
}

module.exports = { getQuotes };
