const pool = require('./finnhubKeyPool');
const { fetchWithTimeout } = require('../utils/fetchWithTimeout');
const { createCircuitBreaker } = require('../utils/circuitBreaker');

// A key-pool 429 already has its own next-key fallback below — this breaker
// is for the case every key is exhausted or Finnhub itself is unreachable,
// so callers (chart, sectors, scanner, news) stop paying a full timeout per
// request during an outage and fall back to their own null-handling
// immediately instead.
const finnhubBreaker = createCircuitBreaker('finnhub', { failureThreshold: 5, cooldownMs: 20000 });

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
        const res = await fetchWithTimeout(urlWithoutToken + '&token=' + key);
        if (res.status === 429) {
          pool.reportRateLimited(key);
          continue; // try the next account
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

async function fetchFinnhubQuote(symbol, apiKey) {
  try {
    var url = 'https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(symbol);
    var res = apiKey ? await fetchWithTimeout(url + '&token=' + apiKey) : await finnhubFetch(url);
    if (!res) return null;
    var data = await res.json();
    if (!data || data.error) return null;
    if (!data.c || data.c <= 0) return null;
    if (data.t && data.t > 0) {
      var age = Date.now() / 1000 - data.t;
      if (age > 86400) return null;
    }
    return {
      price: data.c,
      change: data.dp || 0,
      changeAbs: data.d || 0,
      dayHigh: data.h || 0,
      dayLow: data.l || 0,
      open: data.o || 0,
      prevClose: data.pc || 0,
    };
  } catch (e) {
    return null;
  }
}

async function fetchFinnhubMetric(symbol, apiKey) {
  try {
    var url = 'https://finnhub.io/api/v1/stock/metric?symbol=' + encodeURIComponent(symbol) + '&metric=all';
    var res = apiKey ? await fetchWithTimeout(url + '&token=' + apiKey) : await finnhubFetch(url);
    if (!res) return null;
    var data = await res.json();
    if (!data || !data.metric) return null;
    return {
      weekHigh52: data.metric['52WeekHigh'] || 0,
      weekLow52: data.metric['52WeekLow'] || 0,
      marketCap: (data.metric.marketCapitalization || 0) * 1e6,
      avgVol10d: (data.metric['10DayAverageTradingVolume'] || 0) * 1e6,
      // Swing-trading fundamentals (Premium/Elite) — all come from this same
      // already-cached 24h metric payload, so no extra API call is needed.
      // 0/undefined from Finnhub means "not reported for this company" (e.g.
      // early-stage names with no P/E) — passed through as-is, never guessed.
      peRatio: data.metric.peExclExtraTTM || data.metric.peTTM || 0,
      debtToEquity: data.metric['totalDebt/totalEquityQuarterly'] || 0,
      revenueGrowth5Y: data.metric.revenueGrowth5Y != null ? data.metric.revenueGrowth5Y : null,
    };
  } catch (e) {
    return null;
  }
}

module.exports = { fetchFinnhubQuote, fetchFinnhubMetric, finnhubFetch };
