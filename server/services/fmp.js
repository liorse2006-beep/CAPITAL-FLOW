const { FMP_API_KEY } = require('../config');
const { fetchWithTimeout } = require('../utils/fetchWithTimeout');
const { createCircuitBreaker } = require('../utils/circuitBreaker');

// FMP is deliberately a bounded recovery provider, not a second request for
// every symbol on every scan. The normal Yahoo batch/cache path remains the
// fast path; FMP is called only for symbols Yahoo could not verify.
const BASE_URL = 'https://financialmodelingprep.com/stable';
const REQUEST_TIMEOUT_MS = 8000;
const QUOTE_CACHE_TTL_MS = 60 * 1000;
const MAX_BATCH_SYMBOLS = 100;
const breaker = createCircuitBreaker('fmp-market-data', { failureThreshold: 5, cooldownMs: 20_000 });
const quoteCache = new Map();
const inFlightRequests = new Map();

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

async function fetchJson(path) {
  if (!FMP_API_KEY) return null;
  try {
    return await breaker.execute(async () => {
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
        throw new Error(`FMP HTTP ${response?.status || 'unknown'}`);
      }
      const body = await response.json();
      return body && typeof body === 'object' ? body : null;
    });
  } catch (_) {
    // Provider details and the key never leave the server. Callers receive an
    // empty recovery result and preserve the normal partial/unavailable path.
    return null;
  }
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
    const body = await fetchJson(`/batch-quote?symbols=${encodeURIComponent(missing.join(','))}`);
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
}

module.exports = {
  MAX_BATCH_SYMBOLS,
  fetchFmpQuotes,
  normalizeFmpQuote,
  extractQuoteRows,
  isConfigured,
  clearCache,
};
