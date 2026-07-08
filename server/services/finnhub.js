const pool = require('./finnhubKeyPool');

/**
 * Fetch a Finnhub URL (without &token=) using the key pool, retrying once
 * on the next account if the first key is rate-limited.
 */
async function finnhubFetch(urlWithoutToken) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const key = pool.getKey();
    if (!key) return null;
    const res = await fetch(urlWithoutToken + '&token=' + key);
    if (res.status === 429) {
      pool.reportRateLimited(key);
      continue; // try the next account
    }
    return res;
  }
  return null;
}

async function fetchFinnhubQuote(symbol, apiKey) {
  try {
    var url = 'https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(symbol);
    var res = apiKey
      ? await fetch(url + '&token=' + apiKey)
      : await finnhubFetch(url);
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
    var res = apiKey
      ? await fetch(url + '&token=' + apiKey)
      : await finnhubFetch(url);
    if (!res) return null;
    var data = await res.json();
    if (!data || !data.metric) return null;
    return {
      weekHigh52: data.metric['52WeekHigh'] || 0,
      weekLow52: data.metric['52WeekLow'] || 0,
      marketCap: (data.metric.marketCapitalization || 0) * 1e6,
      avgVol10d: (data.metric['10DayAverageTradingVolume'] || 0) * 1e6,
    };
  } catch (e) {
    return null;
  }
}

module.exports = { fetchFinnhubQuote, fetchFinnhubMetric, finnhubFetch };
