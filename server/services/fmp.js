const { FMP_API_KEY } = require('../config');
const { fetchWithTimeout } = require('../utils/fetchWithTimeout');
const { createCircuitBreaker } = require('../utils/circuitBreaker');

// FMP is the primary quote provider. Prefer one bounded batch request when the
// subscription permits it; if that endpoint is restricted, use the permitted
// single-quote endpoint with bounded concurrency. Yahoo remains a complementary
// path only for symbols FMP could not verify.
const BASE_URL = 'https://financialmodelingprep.com/stable';
const REQUEST_TIMEOUT_MS = 8000;
const QUOTE_CACHE_TTL_MS = 60 * 1000;
const MAX_BATCH_SYMBOLS = 100;
const SINGLE_QUOTE_CONCURRENCY = 4;
// Starter exposes the single-symbol quote endpoint but not batch delivery.
// Keep a conservative in-process budget so a wide scan cannot consume the
// entire provider minute and turn every other user into a 429 response.
const BATCH_CAPABILITY_TTL_MS = 5 * 60 * 1000;
const MAX_SINGLE_QUOTE_FALLBACK_SYMBOLS = 25;
const SINGLE_QUOTE_WINDOW_MS = 60 * 1000;
const SINGLE_QUOTE_BUDGET_PER_WINDOW = 240;
const breaker = createCircuitBreaker('fmp-market-data', { failureThreshold: 5, cooldownMs: 20_000 });
const quoteCache = new Map();
const inFlightRequests = new Map();
let batchRestrictedUntil = 0;
let singleQuoteRequestTimes = [];

function normalizeSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function comparableSymbol(value) {
  return normalizeSymbol(value).replace(/-/g, '.');
}

function finiteOrNull(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const number = typeof value === 'number' ? value : Number(String(value).replace(/%/g, '').trim());
  return Number.isFinite(number) ? number : null;
}

function timestampMs(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number < 1e12 ? number * 1000 : number;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

function extractQuoteRows(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.results)) return body.results;
  if (Array.isArray(body.quotes)) return body.quotes;
  return [body];
}

/**
 * Convert FMP's batch-quote shape to the internal Yahoo-compatible quote
 * shape. A row is accepted only when it has a positive price, positive
 * volume, and an explicit provider timestamp. We intentionally do not use
 * `close` or the request time as a substitute for a live quote.
 */
function normalizeFmpQuote(raw, requestedSymbol) {
  if (!raw || typeof raw !== 'object') return null;
  const requested = normalizeSymbol(requestedSymbol);
  const providerSymbol = normalizeSymbol(raw.symbol || raw.ticker);
  if (!requested || !providerSymbol || comparableSymbol(providerSymbol) !== comparableSymbol(requested)) return null;

  const price = finiteOrNull(raw.price ?? raw.currentPrice);
  const volume = finiteOrNull(raw.volume ?? raw.dayVolume);
  const timestamp = timestampMs(raw.timestamp ?? raw.lastUpdated ?? raw.updatedAt);
  if (price === null || price <= 0 || volume === null || volume <= 0 || timestamp === null) return null;

  const avgVolume = finiteOrNull(raw.avgVolume ?? raw.averageVolume ?? raw.averageDailyVolume10Day);
  const marketCap = finiteOrNull(raw.marketCap ?? raw.marketCapitalization);
  const changePercent = finiteOrNull(raw.changePercentage ?? raw.changesPercentage ?? raw.changePercent);

  return {
    symbol: requested,
    shortName: String(raw.name || raw.companyName || raw.shortName || requested).trim() || requested,
    longName: String(raw.name || raw.companyName || raw.longName || requested).trim() || requested,
    regularMarketPrice: price,
    regularMarketTime: Math.floor(timestamp / 1000),
    regularMarketVolume: volume,
    averageDailyVolume10Day: avgVolume,
    marketCap,
    regularMarketChangePercent: changePercent,
    regularMarketDayHigh: finiteOrNull(raw.dayHigh ?? raw.high),
    regularMarketDayLow: finiteOrNull(raw.dayLow ?? raw.low),
    regularMarketPreviousClose: finiteOrNull(raw.previousClose ?? raw.prevClose),
    exchange: raw.exchange || raw.exchangeShortName || null,
    quoteProvider: 'FMP',
  };
}

async function requestJson(path) {
  if (!FMP_API_KEY) return null;
  return breaker.execute(async () => {
    const response = await fetchWithTimeout(
      `${BASE_URL}${path}`,
      {
        headers: {
          accept: 'application/json',
          // Header auth keeps the secret out of URLs, proxy logs, and
          // browser-visible request history.
          apikey: FMP_API_KEY,
        },
      },
      REQUEST_TIMEOUT_MS
    );
    if (!response || !response.ok) {
      const error = new Error(`FMP HTTP ${response?.status || 'unknown'}`);
      error.status = Number(response?.status) || 0;
      throw error;
    }
    const body = await response.json();
    return body && typeof body === 'object' ? body : null;
  });
}

async function mapWithConcurrency(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

async function loadSingleQuote(symbol) {
  try {
    const body = await requestJson(`/quote?symbol=${encodeURIComponent(symbol)}`);
    return (
      extractQuoteRows(body)
        .map((raw) => normalizeFmpQuote(raw, symbol))
        .find(Boolean) || null
    );
  } catch (_) {
    // Keep provider details and the key server-side. Missing rows remain
    // missing so the caller can report partial/unavailable data truthfully.
    return null;
  }
}

function reserveSingleQuoteSymbols(symbols) {
  const now = Date.now();
  singleQuoteRequestTimes = singleQuoteRequestTimes.filter((timestamp) => now - timestamp < SINGLE_QUOTE_WINDOW_MS);
  const available = Math.max(0, SINGLE_QUOTE_BUDGET_PER_WINDOW - singleQuoteRequestTimes.length);
  const selected = symbols.slice(0, Math.min(MAX_SINGLE_QUOTE_FALLBACK_SYMBOLS, available));
  singleQuoteRequestTimes.push(...selected.map(() => now));
  return selected;
}

async function loadQuotes(symbols) {
  const result = new Map();
  const missing = [];
  const now = Date.now();

  symbols.forEach((symbol) => {
    const cached = quoteCache.get(symbol);
    if (cached && now - cached.fetchedAt < QUOTE_CACHE_TTL_MS) result.set(symbol, cached.data);
    else missing.push(symbol);
  });

  if (missing.length > 0) {
    let body = null;
    let batchRestricted = Date.now() < batchRestrictedUntil;
    if (!batchRestricted) {
      try {
        body = await requestJson(`/batch-quote?symbols=${encodeURIComponent(missing.join(','))}`);
      } catch (error) {
        // FMP accounts can expose the single quote endpoint while restricting
        // batch delivery. Remember that capability for a short period so a
        // wide scan does not repeatedly spend calls on the same 402 response.
        batchRestricted = [402, 403].includes(Number(error?.status));
        if (batchRestricted) batchRestrictedUntil = Date.now() + BATCH_CAPABILITY_TTL_MS;
      }
    }
    const requestedByComparable = new Map(missing.map((symbol) => [comparableSymbol(symbol), symbol]));
    extractQuoteRows(body).forEach((raw) => {
      const rawSymbol = raw && (raw.symbol || raw.ticker);
      const requested = requestedByComparable.get(comparableSymbol(rawSymbol));
      const normalized = requested ? normalizeFmpQuote(raw, requested) : null;
      if (normalized) {
        quoteCache.set(normalized.symbol, { data: normalized, fetchedAt: Date.now() });
        result.set(normalized.symbol, normalized);
      }
    });

    if (batchRestricted) {
      const singleRows = await mapWithConcurrency(
        reserveSingleQuoteSymbols(missing),
        SINGLE_QUOTE_CONCURRENCY,
        loadSingleQuote
      );
      singleRows.filter(Boolean).forEach((normalized) => {
        quoteCache.set(normalized.symbol, { data: normalized, fetchedAt: Date.now() });
        result.set(normalized.symbol, normalized);
      });
    }
  }

  return symbols.map((symbol) => result.get(symbol)).filter(Boolean);
}

function fetchFmpQuotes(symbols) {
  if (!FMP_API_KEY) return Promise.resolve([]);
  const normalized = [...new Set((symbols || []).map(normalizeSymbol).filter(Boolean))].slice(0, MAX_BATCH_SYMBOLS);
  if (normalized.length === 0) return Promise.resolve([]);
  const key = [...normalized].sort().join('\u0000');
  const existing = inFlightRequests.get(key);
  if (existing) return existing;

  const request = loadQuotes(normalized).finally(() => {
    if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
  });
  inFlightRequests.set(key, request);
  return request;
}

function isConfigured() {
  return Boolean(FMP_API_KEY);
}

function clearCache() {
  quoteCache.clear();
  inFlightRequests.clear();
  batchRestrictedUntil = 0;
  singleQuoteRequestTimes = [];
}

module.exports = {
  MAX_BATCH_SYMBOLS,
  fetchFmpQuotes,
  normalizeFmpQuote,
  extractQuoteRows,
  isConfigured,
  clearCache,
};
