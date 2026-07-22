const yahooFinance = require('./yahoo');
const { getQuotes } = require('./quoteCache');
const { fetchFinnhubQuote, fetchFinnhubMetric } = require('./finnhub');
const { getETMinutes, calculateRVOL } = require('./rvol');

// ── Slow-data caches ─────────────────────────────────────────────────────────
// Finnhub metric (52wk range, 10d avg vol, market cap) and the 7-day sparkline
// are both daily-update data — they cannot change minute-to-minute. Sector
// never changes. Caching these cuts Phase-2 API calls by ~75% on repeated
// scans without sacrificing accuracy: the only live call per match is the
// Finnhub quote (price, change%) which stays on a 60-second TTL.
const METRIC_TTL_MS = 24 * 60 * 60 * 1000;       // 24 h — Finnhub metric
const SPARK_TTL_MS  = 24 * 60 * 60 * 1000;        // 24 h — sparkline closes
const SECTOR_TTL_MS = 7  * 24 * 60 * 60 * 1000;  //  7 d — sector string

const metricCache = new Map();  // symbol → { data, fetchedAt }
const sparkCache  = new Map();  // symbol → { data, fetchedAt }
const sectorCache = new Map();  // symbol → { data, fetchedAt }

function slowGet(cache, symbol, ttl) {
  const e = cache.get(symbol);
  return e && (Date.now() - e.fetchedAt < ttl) ? e.data : null;
}
function slowSet(cache, symbol, data) {
  cache.set(symbol, { data, fetchedAt: Date.now() });
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function enrichSector(symbol) {
  const cached = slowGet(sectorCache, symbol, SECTOR_TTL_MS);
  if (cached !== null) return cached;
  try {
    var summary = await yahooFinance.quoteSummary(symbol, {
      modules: ['assetProfile'],
    });
    const sector = summary.assetProfile && summary.assetProfile.sector ? summary.assetProfile.sector : 'N/A';
    slowSet(sectorCache, symbol, sector);
    return sector;
  } catch (e) {
    return 'N/A';
  }
}

async function scanTickers(tickers, options) {
  options = options || {};
  var minVolumeRatio = options.minVolumeRatio || 2.5;
  var minMarketCap = options.minMarketCap || 1000000000;
  var minPrice = options.minPrice || 0;
  var maxPrice = options.maxPrice || 0;
  var minVolRaw = options.minVolRaw || '';
  var onProgress = options.onProgress;
  var onMatch = options.onMatch;

  function parseVol(str) {
    if (!str) return 0;
    var s = str.toString().toUpperCase().trim();
    if (s.endsWith('B')) return parseFloat(s) * 1e9;
    if (s.endsWith('M')) return parseFloat(s) * 1e6;
    if (s.endsWith('K')) return parseFloat(s) * 1e3;
    return parseFloat(s) || 0;
  }
  var minVolNum = parseVol(minVolRaw);

  var results = [];
  var errors = [];

  // ── Phase 1: batch-fetch all quotes (5–6 HTTP calls for 516 tickers) ────────
  if (onProgress) onProgress({ processed: 0, total: tickers.length, found: 0 });

  var quotesMap = await getQuotes(tickers, function (fetched, fetchTotal) {
    if (onProgress) {
      // Map fetch progress onto the first half of the progress bar
      var approx = Math.round((fetched / fetchTotal) * (tickers.length * 0.5));
      onProgress({ processed: approx, total: tickers.length, found: 0 });
    }
  });

  // ── Filter in memory — no more per-ticker HTTP calls ─────────────────────────
  var etMins = getETMinutes();

  tickers.forEach(function (symbol) {
    var quote = quotesMap.get(symbol);
    if (!quote) {
      errors.push(symbol);
      return;
    }

    if (!quote.regularMarketVolume) return;
    if ((quote.marketCap || 0) < minMarketCap) return;

    var avgVolume = quote.averageDailyVolume10Day || 0;
    if (avgVolume <= 0) return;

    var volumeRatio = Math.round((quote.regularMarketVolume / avgVolume) * 100) / 100;
    if (volumeRatio < minVolumeRatio) return;

    var price = quote.regularMarketPrice || 0;
    if (minPrice > 0 && price < minPrice) return;
    if (maxPrice > 0 && price > maxPrice) return;
    if (minVolNum > 0 && quote.regularMarketVolume < minVolNum) return;

    var rvol = calculateRVOL(quote.regularMarketVolume, avgVolume, etMins);

    var match = {
      symbol: quote.symbol,
      name: quote.shortName || quote.longName || symbol,
      price: price,
      change: quote.regularMarketChangePercent || 0,
      volume: quote.regularMarketVolume,
      avgVolume: avgVolume,
      volumeRatio: volumeRatio,
      rvol: rvol,
      marketCap: quote.marketCap || 0,
      sector: 'Pending',
      exchange: quote.exchange || 'N/A',
      dayHigh: quote.regularMarketDayHigh || 0,
      dayLow: quote.regularMarketDayLow || 0,
      prevClose: quote.regularMarketPreviousClose || 0,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh || 0,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow || 0,
      floatShares: quote.floatShares || 0,
      shortPercent: quote.shortPercentOfFloat || 0,
      sparkline: [],
    };

    results.push(match);
    if (onMatch) onMatch(match);
  });

  if (onProgress) onProgress({ processed: tickers.length, total: tickers.length, found: results.length });

  // ── Phase 2: enrich matches with Finnhub + sparkline + sector ────────────────
  // Only fetchFinnhubQuote is called every scan (price/change% must be live).
  // Metric, sparkline, and sector are served from slow caches (24h / 7d) and
  // only fetched from the network when the cache entry is missing or expired.
  var enrichPromises = results.map(function (r) {
    return (async function () {
      try {
        // Always fresh — price and change% are real-time data
        var fQuotePromise = fetchFinnhubQuote(r.symbol);

        // Slow data — resolve from cache or fetch once per day
        var cachedMetric = slowGet(metricCache, r.symbol, METRIC_TTL_MS);
        var metricPromise = cachedMetric !== null
          ? Promise.resolve(cachedMetric)
          : fetchFinnhubMetric(r.symbol).then(function (m) {
              if (m) slowSet(metricCache, r.symbol, m);
              return m;
            });

        var cachedSpark = slowGet(sparkCache, r.symbol, SPARK_TTL_MS);
        var sparkPromise = cachedSpark !== null
          ? Promise.resolve(cachedSpark)
          : yahooFinance.chart(r.symbol, {
              period1: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
              interval: '1d',
            }).then(function (chart) {
              var closes = (chart && chart.quotes ? chart.quotes : [])
                .filter(function (d) { return d.close != null; })
                .sort(function (a, b) { return new Date(a.date) - new Date(b.date); })
                .slice(-7)
                .map(function (d) { return d.close; });
              slowSet(sparkCache, r.symbol, closes);
              return closes;
            });

        var resolved = await Promise.all([fQuotePromise, metricPromise, sparkPromise, enrichSector(r.symbol)]);
        var fQuote  = resolved[0];
        var fMetric = resolved[1];
        var sparkline = resolved[2];
        var sector  = resolved[3];

        if (fQuote && fQuote.price > 0) {
          // Cross-validate Finnhub price against the Yahoo baseline. A >25%
          // divergence almost certainly means Finnhub handed back a stale close
          // or a bad feed value — in that case keep the Yahoo price and log the
          // anomaly. Non-price fields (dayHigh/Low/prevClose) are still applied
          // because they are less likely to be wildly wrong.
          const yahooBasePrice = r.price;
          const priceDivergence = yahooBasePrice > 0
            ? Math.abs(fQuote.price - yahooBasePrice) / yahooBasePrice
            : 0;
          if (priceDivergence > 0.25) {
            console.warn(
              `[Scanner] Price divergence rejected for ${r.symbol}: ` +
              `Yahoo=${yahooBasePrice.toFixed(2)} Finnhub=${fQuote.price.toFixed(2)} ` +
              `(${(priceDivergence * 100).toFixed(1)}% diff)`
            );
          } else {
            r.price = fQuote.price;
          }
          r.change = fQuote.change;
          if (fQuote.dayHigh > 0) r.dayHigh = fQuote.dayHigh;
          if (fQuote.dayLow > 0) r.dayLow = fQuote.dayLow;
          if (fQuote.prevClose > 0) r.prevClose = fQuote.prevClose;
        }

        if (fMetric) {
          if (fMetric.weekHigh52 > 0) r.fiftyTwoWeekHigh = fMetric.weekHigh52;
          if (fMetric.weekLow52 > 0) r.fiftyTwoWeekLow = fMetric.weekLow52;
          if (fMetric.marketCap > 0) r.marketCap = fMetric.marketCap;
          if (fMetric.avgVol10d > 0) {
            r.avgVolume = Math.round(fMetric.avgVol10d);
            if (r.volume > 0 && r.avgVolume > 0) {
              r.volumeRatio = Math.round((r.volume / r.avgVolume) * 100) / 100;
            }
          }
        }

        r.sparkline = Array.isArray(sparkline) ? sparkline : [];
        r.sector = sector;
      } catch (e) {
        r.sector = 'N/A';
      }
    })();
  });

  await Promise.all(enrichPromises);

  // Re-filter after enrichment — strict validation, no bad data reaches the user
  results = results.filter(function (r) {
    if (!r.price || r.price <= 0) return false;
    if (!r.volume || r.volume <= 0) return false;
    if (!r.avgVolume || r.avgVolume <= 0) return false;
    if (!r.volumeRatio || r.volumeRatio <= 0) return false;
    if (r.volumeRatio < minVolumeRatio) return false;
    if (minPrice > 0 && r.price < minPrice) return false;
    if (maxPrice > 0 && r.price > maxPrice) return false;
    if (minVolNum > 0 && r.volume < minVolNum) return false;
    if (r.marketCap < minMarketCap) return false;
    return true;
  });

  results.sort(function (a, b) { return b.volumeRatio - a.volumeRatio; });

  return { results: results, errors: errors, processed: tickers.length };
}

async function quickScan(symbols) {
  var quotesMap = await getQuotes(symbols);
  var results = [];

  symbols.forEach(function (symbol) {
    var quote = quotesMap.get(symbol);
    if (!quote || !quote.regularMarketVolume) {
      return;
    }

    var avgVolume = quote.averageDailyVolume10Day || 0;
    var volumeRatio = avgVolume > 0 ? Math.round((quote.regularMarketVolume / avgVolume) * 100) / 100 : 0;

    results.push({
      symbol: quote.symbol,
      name: quote.shortName || quote.longName || symbol,
      price: quote.regularMarketPrice || 0,
      change: quote.regularMarketChangePercent || 0,
      volume: quote.regularMarketVolume,
      avgVolume: avgVolume,
      volumeRatio: volumeRatio,
      marketCap: quote.marketCap || 0,
      sector: 'N/A',
      exchange: quote.exchange || 'N/A',
      dayHigh: quote.regularMarketDayHigh || 0,
      dayLow: quote.regularMarketDayLow || 0,
      prevClose: quote.regularMarketPreviousClose || 0,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh || 0,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow || 0,
    });
  });

  return results;
}

module.exports = { sleep, enrichSector, scanTickers, quickScan };
