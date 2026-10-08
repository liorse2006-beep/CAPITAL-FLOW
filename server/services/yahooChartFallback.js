'use strict';

const { fetchWithTimeout } = require('../utils/fetchWithTimeout');
const { sessionDateForTimestamp, isTradingDateKey, previousTradingDateKey } = require('./marketCalendar');

// Yahoo's chart and fundamentals-timeseries endpoints are a separate public
// read path from the quote endpoint used by yahoo-finance2. This is a recovery
// path only: quoteCache bounds it and every value remains subject to the same
// timestamp and required-field checks as the primary provider response.
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const REQUEST_TIMEOUT_MS = 8000;
const LOOKBACK_DAYS = 45;
const MAX_FUTURE_SKEW_SECONDS = 300;
const MAX_HISTORY_ROWS = 64;
const MAX_RECOVERY_SYMBOLS = 6;

function normalizeSymbol(symbol) {
  return String(symbol || '')
    .trim()
    .toUpperCase();
}

function toYahooSymbol(symbol) {
  return normalizeSymbol(symbol).replace(/\./g, '-');
}

function finite(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

async function getJson(path, signal) {
  for (const host of HOSTS) {
    if (signal.aborted) return null;
    try {
      const response = await fetchWithTimeout(
        `https://${host}${path}`,
        { headers: { Accept: 'application/json' }, signal },
        REQUEST_TIMEOUT_MS
      );
      if (!response.ok) continue;
      const body = await response.json();
      if (signal.aborted) return null;
      if (body && typeof body === 'object') return body;
    } catch (_) {
      // Try the alternate Yahoo host. Return null only after both fail.
    }
  }
  return null;
}

function latestMarketCap(body, requestedSymbol) {
  const results = body?.timeseries?.result;
  if (!Array.isArray(results) || results.length > MAX_HISTORY_ROWS) return null;
  let newest = null;
  for (const result of results) {
    if (!Array.isArray(result?.trailingMarketCap) || result.trailingMarketCap.length > MAX_HISTORY_ROWS) continue;
    const identities = Array.isArray(result.meta?.symbol) ? result.meta.symbol : [result.meta?.symbol];
    if (requestedSymbol && (identities.length !== 1 || toYahooSymbol(identities[0]) !== toYahooSymbol(requestedSymbol)))
      continue;
    const seen = new Set();
    for (let index = 0; index < result.trailingMarketCap.length; index += 1) {
      const entry = result.trailingMarketCap[index];
      const raw = finite(entry?.reportedValue?.raw);
      const timestamp = finite(result.timestamp?.[index]);
      const date = timestamp === null ? null : new Date(timestamp * 1000);
      if (
        raw === null ||
        raw <= 0 ||
        timestamp === null ||
        timestamp <= 0 ||
        timestamp > Date.now() / 1000 + MAX_FUTURE_SKEW_SECONDS ||
        !Number.isFinite(date?.getTime())
      )
        continue;
      if (entry.currencyCode != null && entry.currencyCode !== 'USD') continue;
      if (seen.has(timestamp)) return null;
      seen.add(timestamp);
      if (!newest || timestamp > newest.timestamp) newest = { value: raw, asOf: date.toISOString(), timestamp };
    }
  }
  return newest ? { value: newest.value, asOf: newest.asOf } : null;
}

function parseChartQuote(body, requestedSymbol) {
  const result = body?.chart?.result?.[0];
  const meta = result?.meta;
  const quote = result?.indicators?.quote?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const volumes = Array.isArray(quote?.volume) ? quote.volume : [];
  const symbol = normalizeSymbol(requestedSymbol);
  if (!meta || !symbol || !timestamps.length || !volumes.length) return null;
  if (toYahooSymbol(meta.symbol) !== toYahooSymbol(symbol)) return null;
  if (meta.currency !== 'USD' || timestamps.length > MAX_HISTORY_ROWS || timestamps.length !== volumes.length)
    return null;

  const price = finite(meta.regularMarketPrice);
  const regularMarketTime = finite(meta.regularMarketTime);
  if (
    price === null ||
    price <= 0 ||
    regularMarketTime === null ||
    regularMarketTime <= 0 ||
    regularMarketTime > Date.now() / 1000 + MAX_FUTURE_SKEW_SECONDS ||
    !Number.isFinite(new Date(regularMarketTime * 1000).getTime())
  )
    return null;
  const quoteDate = sessionDateForTimestamp(regularMarketTime * 1000);
  if (!isTradingDateKey(quoteDate)) return null;
  const rows = [];
  const seenDates = new Set();
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = finite(timestamps[index]);
    if (
      timestamp === null ||
      timestamp <= 0 ||
      timestamp > Date.now() / 1000 + MAX_FUTURE_SKEW_SECONDS ||
      !Number.isFinite(new Date(timestamp * 1000).getTime())
    )
      return null;
    const date = sessionDateForTimestamp(timestamp * 1000);
    if (
      !isTradingDateKey(date) ||
      date > quoteDate ||
      seenDates.has(date) ||
      (rows.length && date < rows[rows.length - 1].date)
    )
      return null;
    seenDates.add(date);
    const volume = finite(volumes[index]);
    if (volume === null || volume <= 0) return null;
    rows.push({ date, volume, close: finite(quote.close?.[index]) });
  }
  const latest = rows[rows.length - 1];
  const lastVolume =
    meta.regularMarketVolume == null
      ? latest.date === quoteDate
        ? latest.volume
        : null
      : finite(meta.regularMarketVolume);
  if (lastVolume === null || lastVolume <= 0) return null;

  // A ten-session baseline must contain ten consecutive prior sessions.
  // Never use the observed session's still-growing volume in its denominator.
  const completedRows = rows.filter((row) => row.date < quoteDate).slice(-10);
  if (completedRows.length !== 10) return null;
  let expectedDate = previousTradingDateKey(quoteDate);
  for (let index = completedRows.length - 1; index >= 0; index -= 1) {
    if (completedRows[index].date !== expectedDate) return null;
    expectedDate = previousTradingDateKey(expectedDate);
  }
  const averageDailyVolume10Day = completedRows.reduce((sum, row) => sum + row.volume, 0) / 10;
  if (!Number.isFinite(averageDailyVolume10Day) || averageDailyVolume10Day <= 0) return null;

  // chartPreviousClose belongs to the query period, not necessarily yesterday.
  const metadataPreviousClose = finite(meta.previousClose);
  const priorSessionClose = completedRows[completedRows.length - 1].close;
  const previousClose =
    metadataPreviousClose > 0 ? metadataPreviousClose : priorSessionClose > 0 ? priorSessionClose : null;
  const changePercent =
    previousClose !== null && previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : null;
  if (changePercent !== null && !Number.isFinite(changePercent)) return null;

  return {
    symbol,
    currency: 'USD',
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

async function fetchYahooChartQuote(symbol, { signal: callerSignal } = {}) {
  const normalized = normalizeSymbol(symbol);
  const yahooSymbol = toYahooSymbol(normalized);
  if (!/^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(normalized) || normalized.length > 15) return null;
  const deadlineSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadlineSignal]) : deadlineSignal;
  if (signal.aborted) return null;

  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - LOOKBACK_DAYS * 24 * 60 * 60;
  const chart = await getJson(
    `/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history`,
    signal
  );
  const quote = parseChartQuote(chart, normalized);
  if (!quote) return null;

  const marketCapBody = await getJson(
    `/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(yahooSymbol)}` +
      `?symbol=${encodeURIComponent(yahooSymbol)}&type=trailingMarketCap&period1=${period1}&period2=${period2}`,
    signal
  );
  const marketCap = latestMarketCap(marketCapBody, normalized);
  if (!marketCap) return null;
  if (Date.parse(marketCap.asOf) < period1 * 1000) return null;

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

async function fetchYahooChartQuotes(symbols, { concurrency = 2, signal: callerSignal } = {}) {
  const deadlineSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadlineSignal]) : deadlineSignal;
  if (signal.aborted || !Array.isArray(symbols)) return [];
  const normalized = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))].slice(0, MAX_RECOVERY_SYMBOLS);
  const workers = Math.min(2, Math.max(1, Math.floor(Number(concurrency) || 2)));
  const rows = await mapWithConcurrency(normalized, workers, (symbol) => fetchYahooChartQuote(symbol, { signal }));
  return rows.filter(Boolean);
}

module.exports = {
  fetchYahooChartQuote,
  fetchYahooChartQuotes,
  latestMarketCap,
  parseChartQuote,
};
