const { MASSIVE_API_KEY } = require('../config');
const { fetchWithTimeout } = require('../utils/fetchWithTimeout');
const { createCircuitBreaker } = require('../utils/circuitBreaker');

// Massive is an optional secondary source for slow quote fields. The current
// account is authorized for reference data and delayed daily aggregates, but
// not for the live snapshot endpoint. This module therefore never presents a
// daily close as an intraday quote and never supplies the live volume used to
// trigger a scan alert.
const BASE_URL = 'https://api.massive.com';
const METRIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 21;
const REQUIRED_VOLUME_BARS = 10;
const breaker = createCircuitBreaker('massive-market-data', { failureThreshold: 5, cooldownMs: 30_000 });
const metricCache = new Map();

function normalizeSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function finiteOrNull(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoOrNull(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function aggregateFromDate() {
  return dateOnly(new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000));
}

function aggregateToDate() {
  return dateOnly(new Date());
}

function normalizeBar(row) {
  const close = finiteOrNull(row?.c);
  const volume = finiteOrNull(row?.v);
  const timestamp = finiteOrNull(row?.t);
  if (close === null || close <= 0 || volume === null || volume <= 0 || timestamp === null || timestamp <= 0) {
    return null;
  }
  const asOf = isoOrNull(new Date(timestamp));
  if (!asOf) return null;
  return { close, volume, timestamp, asOf };
}

/**
 * Normalize the two documented Massive responses into the only metric shape
 * the scanner is allowed to consume. This function intentionally requires
 * ten valid daily bars and a timestamp for both source payloads.
 */
function normalizeMassiveMetrics(referenceBody, aggregatesBody) {
  const marketCap = finiteOrNull(referenceBody?.results?.market_cap);
  const referenceAsOf = isoOrNull(referenceBody?.results?.last_updated_utc);
  const bars = (Array.isArray(aggregatesBody?.results) ? aggregatesBody.results : [])
    .map(normalizeBar)
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (marketCap === null || marketCap <= 0 || !referenceAsOf || bars.length < REQUIRED_VOLUME_BARS) return null;

  const window = bars.slice(-REQUIRED_VOLUME_BARS);
  const latest = window[window.length - 1];
  const avgVol10d = window.reduce((sum, bar) => sum + bar.volume, 0) / window.length;
  if (!Number.isFinite(avgVol10d) || avgVol10d <= 0) return null;

  return {
    marketCap,
    avgVol10d,
    latestClose: latest.close,
    latestVolume: latest.volume,
    dataAsOf: latest.asOf,
    dataWindowStart: window[0].asOf,
    referenceAsOf,
    providerStatus:
      String(aggregatesBody?.status || '')
        .trim()
        .toUpperCase() || 'UNKNOWN',
    delayed: true,
  };
}

async function getJson(path) {
  if (!MASSIVE_API_KEY) return null;
  try {
    return await breaker.execute(async () => {
      const response = await fetchWithTimeout(
        `${BASE_URL}${path}${path.includes('?') ? '&' : '?'}apiKey=${encodeURIComponent(MASSIVE_API_KEY)}`
      );
      if (!response || !response.ok) return null;
      const body = await response.json();
      return body && typeof body === 'object' ? body : null;
    });
  } catch (_) {
    return null;
  }
}

async function fetchMassiveMetrics(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized || !MASSIVE_API_KEY) return null;

  const cached = metricCache.get(normalized);
  if (cached && Date.now() - cached.fetchedAt < METRIC_CACHE_TTL_MS) return cached.data;

  const [referenceBody, aggregatesBody] = await Promise.all([
    getJson(`/v3/reference/tickers/${encodeURIComponent(normalized)}`),
    getJson(
      `/v2/aggs/ticker/${encodeURIComponent(normalized)}/range/1/day/${aggregateFromDate()}/${aggregateToDate()}?adjusted=true&sort=asc&limit=30`
    ),
  ]);
  const data = normalizeMassiveMetrics(referenceBody, aggregatesBody);
  if (data) metricCache.set(normalized, { data, fetchedAt: Date.now() });
  return data;
}

function isConfigured() {
  return Boolean(MASSIVE_API_KEY);
}

function clearCache() {
  metricCache.clear();
}

module.exports = {
  fetchMassiveMetrics,
  normalizeMassiveMetrics,
  isConfigured,
  clearCache,
  REQUIRED_VOLUME_BARS,
};
