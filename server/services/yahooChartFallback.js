'use strict';

const { fetchWithTimeout } = require('../utils/fetchWithTimeout');

// Yahoo's chart and fundamentals-timeseries endpoints are a separate public
// read path from the quote endpoint used by yahoo-finance2. This is a recovery
// path only: quoteCache bounds it and every value remains subject to the same
// timestamp and required-field checks as the primary provider response.
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const REQUEST_TIMEOUT_MS = 8000;
const LOOKBACK_DAYS = 45;

function normalizeSymbol(symbol) {
  return String(symbol || '')
    .trim()
    .toUpperCase();
}

function toYahooSymbol(symbol) {
  return normalizeSymbol(symbol).replace(/\./g, '-');
}

function finite(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

async function getJson(path) {
  for (const host of HOSTS) {
    try {
      const response = await fetchWithTimeout(
        `https://${host}${path}`,
        { headers: { Accept: 'application/json' } },
        REQUEST_TIMEOUT_MS
      );
      if (!response.ok) continue;
      const body = await response.json();
      if (body && typeof body === 'object') return body;
    } catch (_) {
      // Try the alternate Yahoo host. Return null only after both fail.
    }
  }
  return null;
}

function latestMarketCap(body) {
  const result = body?.timeseries?.result?.find((entry) => Array.isArray(entry?.trailingMarketCap));
  const values = result?.trailingMarketCap || [];
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const raw = finite(values[index]?.reportedValue?.raw);
    if (raw !== null && raw > 0) {
      const timestamp = Array.isArray(result.timestamp) ? finite(result.timestamp[index]) : null;
      return {
        value: raw,
        asOf: timestamp !== null ? new Date(timestamp * 1000).toISOString() : null,
      };
    }
  }
  return null;
}

function parseChartQuote(body, requestedSymbol) {
  const result = body?.chart?.result?.[0];
  const meta = result?.meta;
  const quote = result?.indicators?.quote?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const volumes = Array.isArray(quote?.volume) ? quote.volume : [];
  const symbol = normalizeSymbol(requestedSymbol);
  if (!meta || !symbol || !timestamps.length || !volumes.length) return null;

  const price = finite(meta.regularMarketPrice);
  const regularMarketTime = finite(meta.regularMarketTime);
  const lastVolume = finite(meta.regularMarketVolume) || finite(volumes[volumes.length - 1]);
  if (price === null || price <= 0 || lastVolume === null || lastVolume <= 0 || regularMarketTime === null) return null;

  // Exclude the newest daily bar so today's growing volume is never used as a
  // completed 10-session baseline.
  const completedVolumes = volumes
    .map((value, index) => ({ value: finite(value), timestamp: finite(timestamps[index]) }))
    .filter((entry) => entry.value !== null && entry.value > 0 && entry.timestamp !== null)
    .slice(-11, -1)
    .map((entry) => entry.value);
  const averageDailyVolume10Day =
    completedVolumes.length >= 5
      ? completedVolumes.reduce((sum, value) => sum + value, 0) / completedVolumes.length
      : null;
  if (averageDailyVolume10Day === null || averageDailyVolume10Day <= 0) return null;

  const previousClose = finite(meta.chartPreviousClose);
  const changePercent =
    previousClose !== null && previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : null;

  return {
    symbol,
    shortName: meta.shortName || meta.longName || symbol,
    longName: meta.longName || meta.shortName || symbol,
    regularMarketPrice: price,
    regularMarketTime,
    regularMarketVolume: lastVolume,
    averageDailyVolume10Day,
    marketCap: null,
    regularMarketChangePercent: changePercent,
    regularMarketDayHigh: finite(meta.regularMarketDayHigh),
    regularMarketDayLow: finite(meta.regularMarketDayLow),
    regularMarketPreviousClose: previousClose,
    exchange: meta.exchangeName || meta.fullExchangeName || null,
    fiftyTwoWeekHigh: finite(meta.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: finite(meta.fiftyTwoWeekLow),
    floatShares: null,
    shortPercentOfFloat: null,
    quoteProvider: 'Yahoo Finance Chart API',
  };
}

async function fetchYahooChartQuote(symbol) {
  const normalized = normalizeSymbol(symbol);
  const yahooSymbol = toYahooSymbol(normalized);
  if (!normalized) return null;

  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - LOOKBACK_DAYS * 24 * 60 * 60;
  const chart = await getJson(
    `/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history`
  );
  const quote = parseChartQuote(chart, normalized);
  if (!quote) return null;

  const marketCapBody = await getJson(
    `/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(yahooSymbol)}` +
      `?symbol=${encodeURIComponent(yahooSymbol)}&type=trailingMarketCap&period1=${period1}&period2=${period2}`
  );
  const marketCap = latestMarketCap(marketCapBody);
  if (!marketCap) return null;

  return {
    ...quote,
    marketCap: marketCap.value,
    metricProvider: 'Yahoo Finance Timeseries',
    metricAsOf: marketCap.asOf,
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Math.min(Math.max(1, limit), items.length);
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index]);
      } catch (_) {
        results[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: workers }, run));
  return results;
}

async function fetchYahooChartQuotes(symbols, { concurrency = 2 } = {}) {
  const normalized = [...new Set((symbols || []).map(normalizeSymbol).filter(Boolean))];
  const rows = await mapWithConcurrency(normalized, concurrency, fetchYahooChartQuote);
  return rows.filter(Boolean);
}

module.exports = {
  fetchYahooChartQuote,
  fetchYahooChartQuotes,
  latestMarketCap,
  parseChartQuote,
};
