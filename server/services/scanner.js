const yahooFinance = require('./yahoo');
const quoteCache = require('./quoteCache');
const { fetchFinnhubQuote, fetchFinnhubMetric } = require('./finnhub');
const { getETMinutes, calculateRVOL } = require('./rvol');

// ── Slow-data caches ─────────────────────────────────────────────────────────
// Finnhub metric (52wk range, 10d avg vol, market cap) and the 7-day sparkline
// are both daily-update data — they cannot change minute-to-minute. Sector
// never changes. Caching these cuts Phase-2 API calls by ~75% on repeated
// scans without sacrificing accuracy: the only live call per match is the
// Finnhub quote (price, change%) which stays on a 60-second TTL.
const METRIC_TTL_MS = 24 * 60 * 60 * 1000; // 24 h — Finnhub metric
const SPARK_TTL_MS = 24 * 60 * 60 * 1000; // 24 h — sparkline closes
const SECTOR_TTL_MS = 7 * 24 * 60 * 60 * 1000; //  7 d — sector string

const metricCache = new Map(); // symbol → { data, fetchedAt }
const sparkCache = new Map(); // symbol → { data, fetchedAt }
const sectorCache = new Map(); // symbol → { data, fetchedAt }

function finiteOrNull(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function slowGet(cache, symbol, ttl) {
  const e = cache.get(symbol);
  return e && Date.now() - e.fetchedAt < ttl ? e.data : null;
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
  var minVolumeRatio = options.minVolumeRatio ?? 2.5;
  var minMarketCap = options.minMarketCap ?? 1000000000;
  var minPrice = options.minPrice ?? 0;
  var maxPrice = options.maxPrice ?? 0;
  var minVolRaw = options.minVolRaw ?? '';
  var onProgress = options.onProgress;
  var onMatch = options.onMatch;

  function parseVol(str) {
    if (!str) return 0;
    var s = str.toString().toUpperCase().trim();
    var match = /^(\d+(?:\.\d+)?)([KMB])?$/.exec(s);
    if (!match) return 0;
    var multiplier = match[2] === 'B' ? 1e9 : match[2] === 'M' ? 1e6 : match[2] === 'K' ? 1e3 : 1;
    var value = Number(match[1]) * multiplier;
    return Number.isFinite(value) ? value : 0;
  }
  var minVolNum = parseVol(minVolRaw);

  var results = [];
  var errors = [];
  var checkedSymbols = [];

  function addError(symbol) {
    if (!errors.includes(symbol)) errors.push(symbol);
  }

  // ── Phase 1: batch-fetch all quotes (5–6 HTTP calls for 516 tickers) ────────
  if (onProgress) onProgress({ processed: 0, total: tickers.length, found: 0 });

  var quotesMap = await quoteCache.getQuotes(tickers, function (fetched, fetchTotal) {
    if (onProgress) {
      // Map fetch progress onto the first half of the progress bar
      var approx = Math.round((fetched / fetchTotal) * (tickers.length * 0.5));
      onProgress({ processed: approx, total: tickers.length, found: 0 });
    }
  });
  var quoteDataAsOf = quotesMap.dataAsOf || null;
  var quoteDataStale = quotesMap.usedStaleFallback === true || Number(quotesMap.staleCount || 0) > 0;
  var staleQuoteSymbols = new Set(
    (Array.isArray(quotesMap.staleSymbols) ? quotesMap.staleSymbols : []).map(function (symbol) {
      return String(symbol || '')
        .trim()
        .toUpperCase();
    })
  );

  // ── Filter in memory — no more per-ticker HTTP calls ─────────────────────────
  var etMins = getETMinutes();

  tickers.forEach(function (symbol) {
    var quote = quotesMap.get(symbol);
    if (!quote) {
      addError(symbol);
      return;
    }

    // A symbol is considered checked only when every field needed to decide
    // the Capital Flow floor is present. This distinction is consumed by the
    // scheduled Radar evaluator: a missing quote must not be interpreted as a
    // real negative signal and must not re-arm an existing match.
    var quotePrice = Number(quote.regularMarketPrice);
    var quoteVolume = Number(quote.regularMarketVolume);
    var avgVolume = Number(quote.averageDailyVolume10Day);
    var quoteMarketCap = Number(quote.marketCap);
    if (
      !Number.isFinite(quotePrice) ||
      quotePrice <= 0 ||
      !Number.isFinite(quoteVolume) ||
      quoteVolume <= 0 ||
      !Number.isFinite(avgVolume) ||
      avgVolume <= 0 ||
      !Number.isFinite(quoteMarketCap) ||
      quoteMarketCap <= 0
    ) {
      addError(symbol);
      return;
    }

    checkedSymbols.push(
      String(quote.symbol || symbol)
        .trim()
        .toUpperCase()
    );
    if (quoteMarketCap < minMarketCap) return;

    var volumeRatio = Math.round((quoteVolume / avgVolume) * 100) / 100;
    if (volumeRatio < minVolumeRatio) return;

    var price = quotePrice;
    if (minPrice > 0 && price < minPrice) return;
    if (maxPrice > 0 && price > maxPrice) return;
    if (minVolNum > 0 && quoteVolume < minVolNum) return;

    var rvol = calculateRVOL(quoteVolume, avgVolume, etMins);

    var match = {
      symbol: quote.symbol,
      name: quote.shortName || quote.longName || symbol,
      price: price,
      change: finiteOrNull(quote.regularMarketChangePercent),
      volume: quoteVolume,
      avgVolume: avgVolume,
      volumeRatio: volumeRatio,
      rvol: rvol,
      marketCap: quoteMarketCap,
      sector: 'Pending',
      exchange: quote.exchange || 'N/A',
      dayHigh: finiteOrNull(quote.regularMarketDayHigh),
      dayLow: finiteOrNull(quote.regularMarketDayLow),
      prevClose: finiteOrNull(quote.regularMarketPreviousClose),
      fiftyTwoWeekHigh: finiteOrNull(quote.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: finiteOrNull(quote.fiftyTwoWeekLow),
      floatShares: finiteOrNull(quote.floatShares),
      shortPercent: finiteOrNull(quote.shortPercentOfFloat),
      sparkline: [],
      quoteDataStatus: staleQuoteSymbols.has(
        String(quote.symbol || symbol)
          .trim()
          .toUpperCase()
      )
        ? 'stale'
        : 'complete',
    };

    results.push(match);
    if (onMatch) onMatch(match);
  });

  if (onProgress) onProgress({ processed: tickers.length, total: tickers.length, found: results.length });

  // ── Phase 2: enrich matches with Finnhub + sparkline + sector ────────────────
  // Only fetchFinnhubQuote is called every scan (price/change% must be live).
  // Metric, sparkline, and sector are served from slow caches (24h / 7d) and
  // only fetched from the network when the cache entry is missing or expired.
  // This is the slow half of a scan (real per-match network calls, one at a
  // time per match) — Phase 1 had onProgress calls throughout, but until now
  // Phase 2 reported nothing at all, so the progress bar sat frozen at 100%
  // of Phase 1's range for however long enrichment actually took.
  var enrichedCount = 0;
  var enrichTotal = results.length || 1;
  var enrichPromises = results.map(function (r) {
    return (async function () {
      try {
        // Always fresh — price and change% are real-time data
        var fQuotePromise = fetchFinnhubQuote(r.symbol);

        // Slow data — resolve from cache or fetch once per day
        var cachedMetric = slowGet(metricCache, r.symbol, METRIC_TTL_MS);
        var metricPromise =
          cachedMetric !== null
            ? Promise.resolve(cachedMetric)
            : fetchFinnhubMetric(r.symbol).then(function (m) {
                if (m) slowSet(metricCache, r.symbol, m);
                return m;
              });

        var cachedSpark = slowGet(sparkCache, r.symbol, SPARK_TTL_MS);
        var sparkPromise =
          cachedSpark !== null
            ? Promise.resolve(cachedSpark)
            : yahooFinance
                .chart(r.symbol, {
                  period1: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
                  interval: '1d',
                })
                .then(function (chart) {
                  var closes = (chart && chart.quotes ? chart.quotes : [])
                    .filter(function (d) {
                      return d.close != null;
                    })
                    .sort(function (a, b) {
                      return new Date(a.date) - new Date(b.date);
                    })
                    .slice(-7)
                    .map(function (d) {
                      return d.close;
                    });
                  slowSet(sparkCache, r.symbol, closes);
                  return closes;
                });

        var resolved = await Promise.all([fQuotePromise, metricPromise, sparkPromise, enrichSector(r.symbol)]);
        var fQuote = resolved[0];
        var fMetric = resolved[1];
        var sparkline = resolved[2];
        var sector = resolved[3];

        if (fQuote && fQuote.price > 0) {
          // Cross-validate Finnhub price against the Yahoo baseline. A >25%
          // divergence almost certainly means Finnhub handed back a stale close
          // or a bad feed value — in that case keep the Yahoo price and log the
          // anomaly. Non-price fields (dayHigh/Low/prevClose) are still applied
          // because they are less likely to be wildly wrong.
          const yahooBasePrice = r.price;
          const priceDivergence = yahooBasePrice > 0 ? Math.abs(fQuote.price - yahooBasePrice) / yahooBasePrice : 0;
          if (priceDivergence > 0.25) {
            console.warn(
              `[Scanner] Price divergence rejected for ${r.symbol}: ` +
                `Yahoo=${yahooBasePrice.toFixed(2)} Finnhub=${fQuote.price.toFixed(2)} ` +
                `(${(priceDivergence * 100).toFixed(1)}% diff)`
            );
          } else {
            r.price = fQuote.price;
          }
          if (fQuote.change !== null) r.change = fQuote.change;
          if (fQuote.dayHigh !== null) r.dayHigh = fQuote.dayHigh;
          if (fQuote.dayLow !== null) r.dayLow = fQuote.dayLow;
          if (fQuote.prevClose !== null) r.prevClose = fQuote.prevClose;
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
      } finally {
        enrichedCount++;
        if (onProgress) {
          // Second half of the bar — mirrors Phase 1's "first half" mapping.
          var enrichApprox = Math.round((enrichedCount / enrichTotal) * (tickers.length * 0.5));
          onProgress({
            processed: Math.round(tickers.length * 0.5) + enrichApprox,
            total: tickers.length,
            found: results.length,
          });
        }
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

  results.sort(function (a, b) {
    return b.volumeRatio - a.volumeRatio;
  });

  var dataStatus =
    errors.length === 0
      ? 'complete'
      : errors.length >=
          new Set(
            tickers.map((symbol) =>
              String(symbol || '')
                .trim()
                .toUpperCase()
            )
          ).size
        ? 'unavailable'
        : 'partial';
  // A stale quote may still be usable for a best-effort result, but it is not
  // a complete market-data verification. Keep the existing public status
  // vocabulary so every caller renders the warning path consistently.
  if (dataStatus === 'complete' && quoteDataStale) dataStatus = 'partial';

  return {
    results: results,
    errors: errors,
    checkedSymbols: [...new Set(checkedSymbols)],
    // An all-symbol failure is not a valid empty scan. Mark it unavailable so
    // scheduled jobs and Radar never present a provider outage as "no hits".
    dataStatus,
    quoteDataStatus: quoteDataStale ? 'stale' : quotesMap.providerFailure ? 'unavailable' : 'complete',
    staleCount: Number(quotesMap.staleCount || 0),
    staleSymbols: [...staleQuoteSymbols],
    dataAsOf: quoteDataAsOf || new Date().toISOString(),
    processed: tickers.length,
  };
}

async function quickScan(symbols) {
  var quotesMap = await quoteCache.getQuotes(symbols);
  var results = [];

  symbols.forEach(function (symbol) {
    var quote = quotesMap.get(symbol);
    if (!quote || !quote.regularMarketVolume) {
      return;
    }

    var avgVolume = finiteOrNull(quote.averageDailyVolume10Day);
    var volumeRatio = avgVolume > 0 ? Math.round((quote.regularMarketVolume / avgVolume) * 100) / 100 : null;

    results.push({
      symbol: quote.symbol,
      name: quote.shortName || quote.longName || symbol,
      price: finiteOrNull(quote.regularMarketPrice),
      change: finiteOrNull(quote.regularMarketChangePercent),
      volume: quote.regularMarketVolume,
      avgVolume: avgVolume,
      volumeRatio: volumeRatio,
      marketCap: finiteOrNull(quote.marketCap),
      sector: 'N/A',
      exchange: quote.exchange || 'N/A',
      dayHigh: finiteOrNull(quote.regularMarketDayHigh),
      dayLow: finiteOrNull(quote.regularMarketDayLow),
      prevClose: finiteOrNull(quote.regularMarketPreviousClose),
      fiftyTwoWeekHigh: finiteOrNull(quote.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: finiteOrNull(quote.fiftyTwoWeekLow),
    });
  });

  return results;
}

module.exports = { sleep, enrichSector, scanTickers, quickScan };
