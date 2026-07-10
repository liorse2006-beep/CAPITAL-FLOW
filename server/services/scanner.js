const yahooFinance = require('./yahoo');
const { fetchFinnhubQuote, fetchFinnhubMetric } = require('./finnhub');
const { getETMinutes, calculateRVOL } = require('./rvol');

const BATCH_SIZE = 30;
const DELAY_MS = 200;

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function enrichSector(symbol) {
  try {
    var summary = await yahooFinance.quoteSummary(symbol, {
      modules: ['assetProfile'],
    });
    return summary.assetProfile && summary.assetProfile.sector ? summary.assetProfile.sector : 'N/A';
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
  var processed = 0;

  for (var i = 0; i < tickers.length; i += BATCH_SIZE) {
    var batch = tickers.slice(i, i + BATCH_SIZE);

    var batchPromises = batch.map(function (symbol) {
      return (async function () {
        try {
          var quote = await yahooFinance.quote(symbol);
          processed++;

          if (!quote || !quote.regularMarketVolume) return null;
          if ((quote.marketCap || 0) < minMarketCap) return null;

          var avgVolume = quote.averageDailyVolume10Day || 0;
          if (avgVolume <= 0) return null;

          var volumeRatio = Math.round((quote.regularMarketVolume / avgVolume) * 100) / 100;
          if (volumeRatio < minVolumeRatio) return null;

          var etMins = getETMinutes();
          var rvol = calculateRVOL(quote.regularMarketVolume, avgVolume, etMins);

          var price = quote.regularMarketPrice || 0;
          if (minPrice > 0 && price < minPrice) return null;
          if (maxPrice > 0 && price > maxPrice) return null;
          if (minVolNum > 0 && quote.regularMarketVolume < minVolNum) return null;

          return {
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
        } catch (e) {
          errors.push(symbol);
          processed++;
          return null;
        }
      })();
    });

    var batchResults = await Promise.all(batchPromises);
    batchResults.forEach(function (r) {
      if (r) {
        results.push(r);
        if (onMatch) onMatch(r);
      }
    });

    if (onProgress) {
      onProgress({ processed: processed, total: tickers.length, found: results.length });
    }

    if (i + BATCH_SIZE < tickers.length) {
      await sleep(DELAY_MS);
    }
  }

  // Phase 2: Enrich matches with Finnhub prices + sparkline + sector
  var enrichPromises = results.map(function (r) {
    return (async function () {
      try {
        // No key passed — fetchFinnhubQuote/Metric pull from the rotating
        // account pool internally, so enrichment survives any single
        // account hitting its rate limit.
        var finnhubQuote = fetchFinnhubQuote(r.symbol);
        var finnhubMetric = fetchFinnhubMetric(r.symbol);
        var chartPromise = yahooFinance.chart(r.symbol, {
          period1: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
          interval: '1d',
        });
        var sectorPromise = enrichSector(r.symbol);

        var resolved = await Promise.all([finnhubQuote, finnhubMetric, chartPromise, sectorPromise]);
        var fQuote = resolved[0];
        var fMetric = resolved[1];
        var chart = resolved[2];
        var sector = resolved[3];

        if (fQuote && fQuote.price > 0) {
          r.price = fQuote.price;
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

        var quotes = chart && chart.quotes ? chart.quotes : [];
        r.sparkline = quotes
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

  results.sort(function (a, b) {
    return b.volumeRatio - a.volumeRatio;
  });

  return { results: results, errors: errors, processed: processed };
}

async function quickScan(symbols) {
  var results = [];

  for (var i = 0; i < symbols.length; i += BATCH_SIZE) {
    var batch = symbols.slice(i, i + BATCH_SIZE);

    var batchPromises = batch.map(function (symbol) {
      return (async function () {
        try {
          var quote = await yahooFinance.quote(symbol);
          if (!quote || !quote.regularMarketVolume) return null;

          var avgVolume = quote.averageDailyVolume10Day || 0;
          var volumeRatio = avgVolume > 0 ? Math.round((quote.regularMarketVolume / avgVolume) * 100) / 100 : 0;

          return {
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
          };
        } catch (e) {
          return null;
        }
      })();
    });

    var batchResults = await Promise.all(batchPromises);
    batchResults.forEach(function (r) {
      if (r) results.push(r);
    });

    if (i + BATCH_SIZE < symbols.length) {
      await sleep(DELAY_MS);
    }
  }

  return results;
}

async function scanPreMarket(tickers, options) {
  options = options || {};
  var onProgress = options.onProgress;

  var results = [];
  var errors = [];
  var processed = 0;

  for (var i = 0; i < tickers.length; i += BATCH_SIZE) {
    var batch = tickers.slice(i, i + BATCH_SIZE);

    var batchPromises = batch.map(function (symbol) {
      return (async function () {
        try {
          var quote = await yahooFinance.quote(symbol);
          processed++;

          if (!quote) return null;

          var prevClose = quote.regularMarketPreviousClose || 0;
          var preMarketPrice = quote.preMarketPrice || 0;

          if (!prevClose || !preMarketPrice) return null;

          var gapPercent = Math.round(((preMarketPrice - prevClose) / prevClose) * 10000) / 100;

          if (Math.abs(gapPercent) <= 2) return null;

          var avgVolume = quote.averageDailyVolume10Day || 0;
          var volume = quote.regularMarketVolume || 0;
          var volumeRatio = avgVolume > 0 ? Math.round((volume / avgVolume) * 100) / 100 : 0;

          return {
            symbol: quote.symbol,
            name: quote.shortName || quote.longName || symbol,
            preMarketPrice: preMarketPrice,
            preMarketChange: quote.preMarketChange || 0,
            preMarketChangePercent: quote.preMarketChangePercent || 0,
            regularPrice: quote.regularMarketPrice || 0,
            prevClose: prevClose,
            gapPercent: gapPercent,
            volume: volume,
            avgVolume: avgVolume,
            volumeRatio: volumeRatio,
            marketCap: quote.marketCap || 0,
          };
        } catch (e) {
          errors.push(symbol);
          processed++;
          return null;
        }
      })();
    });

    var batchResults = await Promise.all(batchPromises);
    batchResults.forEach(function (r) {
      if (r) results.push(r);
    });

    if (onProgress) {
      onProgress({ processed: processed, total: tickers.length, found: results.length });
    }

    if (i + BATCH_SIZE < tickers.length) {
      await sleep(DELAY_MS);
    }
  }

  results.sort(function (a, b) {
    return Math.abs(b.gapPercent) - Math.abs(a.gapPercent);
  });

  return { results: results, errors: errors, processed: processed };
}

module.exports = { sleep, enrichSector, scanTickers, quickScan, scanPreMarket };
