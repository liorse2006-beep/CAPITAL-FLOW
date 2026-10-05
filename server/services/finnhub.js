const pool = require('./finnhubKeyPool');
const { fetchWithTimeout } = require('../utils/fetchWithTimeout');
const { createCircuitBreaker } = require('../utils/circuitBreaker');

// A key-pool 429 already has its own next-key fallback below — this breaker
// is for the case every key is exhausted or Finnhub itself is unreachable,
// so callers (chart, sectors, scanner, news) stop paying a full timeout per
// request during an outage and fall back to their own null-handling
// immediately instead.
const finnhubBreaker = createCircuitBreaker('finnhub', { failureThreshold: 5, cooldownMs: 20000 });

function finiteOrNull(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveOrNull(value) {
  const number = finiteOrNull(value);
  return number !== null && number > 0 ? number : null;
}

function millionsOrNull(value) {
  const number = positiveOrNull(value);
  return number !== null && Number.isFinite(number * 1e6) ? number * 1e6 : null;
}

function providerTimeOrNull(value) {
  const timestamp = finiteOrNull(value);
  if (timestamp === null || timestamp <= 0) return null;
  const date = new Date(timestamp * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function hasPositiveFinite(value) {
  const number = finiteOrNull(value);
  return number !== null && number > 0;
}

function parseFinnhubQuote(data, nowMs = Date.now()) {
  if (!data || typeof data !== 'object' || data.error) return null;

  const price = finiteOrNull(data.c);
  const timestamp = finiteOrNull(data.t);
  const dataAsOf = providerTimeOrNull(data.t);
  if (price === null || price <= 0 || timestamp === null || !dataAsOf) return null;

  const ageMs = nowMs - timestamp * 1000;
  // Finnhub's quote timestamp is the provider's last quote update. Do not
  // accept a future value or a quote older than one day as a current quote.
  if (ageMs < -5 * 60 * 1000 || ageMs > 24 * 60 * 60 * 1000) return null;

  const missingFields = ['d', 'dp', 'h', 'l', 'o', 'pc'].filter((field) => {
    if (field === 'd' || field === 'dp') return finiteOrNull(data[field]) === null;
    return !hasPositiveFinite(data[field]);
  });

  return {
    price,
    change: finiteOrNull(data.dp),
    changeAbs: finiteOrNull(data.d),
    dayHigh: positiveOrNull(data.h),
    dayLow: positiveOrNull(data.l),
    open: positiveOrNull(data.o),
    prevClose: positiveOrNull(data.pc),
    dataAsOf,
    dataStatus: missingFields.length === 0 ? 'complete' : 'partial',
    missingFields,
  };
}

function parseFinnhubMetric(data) {
  if (!data || typeof data !== 'object' || !data.metric || typeof data.metric !== 'object') return null;
  const metric = data.metric;
  const result = {
    weekHigh52: positiveOrNull(metric['52WeekHigh']),
    weekLow52: positiveOrNull(metric['52WeekLow']),
    marketCap: millionsOrNull(metric.marketCapitalization),
    avgVol10d: millionsOrNull(metric['10DayAverageTradingVolume']),
    // These fields are optional for the Capital Flow scanner, but are kept
    // explicit so Fundamentals can distinguish a missing value from a failed
    // provider response.
    peRatio: finiteOrNull(metric.peExclExtraTTM) ?? finiteOrNull(metric.peTTM),
    debtToEquity: finiteOrNull(metric['totalDebt/totalEquityQuarterly']),
    revenueGrowth5Y: finiteOrNull(metric.revenueGrowth5Y),
  };
  const missingFields = [];
  if (result.marketCap === null || result.marketCap <= 0) missingFields.push('marketCap');
  if (result.avgVol10d === null || result.avgVol10d <= 0) missingFields.push('avgVol10d');
  return {
    ...result,
    dataStatus: missingFields.length === 0 ? 'complete' : 'partial',
    missingFields,
  };
}

/**
 * Fetch a Finnhub URL (without &token=) using the key pool, retrying once
 * on the next account if the first key is rate-limited.
 */
async function finnhubFetch(urlWithoutToken) {
  try {
    return await finnhubBreaker.execute(async () => {
      // Try every key in the pool before giving up — with N keys we get N
      // attempts, so a single exhausted key never blocks the request when
      // others are available.
      const attempts = Math.max(pool.poolSize(), 1);
      for (let attempt = 0; attempt < attempts; attempt++) {
        const key = pool.getKey();
        if (!key) return null;
        const separator = urlWithoutToken.includes('?') ? '&' : '?';
        const res = await fetchWithTimeout(urlWithoutToken + separator + 'token=' + encodeURIComponent(key));
        if (res.status === 429) {
          await res.body?.cancel().catch(() => {});
          pool.reportRateLimited(key);
          continue; // try the next account
        }
        // An error body with quote-shaped JSON is still a failed request.
        // Do not include the token-bearing URL or upstream body in errors.
        if (!res.ok) {
          await res.body?.cancel().catch(() => {});
          throw new Error('Finnhub request was unsuccessful');
        }
        return res;
      }
      return null;
    });
  } catch (err) {
    if (err.circuitOpen) return null;
    throw err;
  }
}

async function fetchFinnhubQuote(symbol) {
  try {
    var url = 'https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(symbol);
    var res = await finnhubFetch(url);
    if (!res) return null;
    var data = await res.json();
    return parseFinnhubQuote(data);
  } catch (e) {
    return null;
  }
}

async function fetchFinnhubMetric(symbol) {
  try {
    var url = 'https://finnhub.io/api/v1/stock/metric?symbol=' + encodeURIComponent(symbol) + '&metric=all';
    var res = await finnhubFetch(url);
    if (!res) return null;
    var data = await res.json();
    return parseFinnhubMetric(data);
  } catch (e) {
    return null;
  }
}

module.exports = { fetchFinnhubQuote, fetchFinnhubMetric, finnhubFetch, parseFinnhubQuote, parseFinnhubMetric };
