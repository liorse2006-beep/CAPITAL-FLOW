const yahooFinance = require('./yahoo');

// This endpoint re-fetched the same 6-month daily chart from Yahoo on every
// single call with no caching at all, even for the same symbol requested
// seconds apart (e.g. two users expanding the same hot ticker's detail row,
// or one user re-opening it). The analysis itself is about a spike from
// weeks/months ago — a stale-by-up-to-a-day cache changes nothing the user
// could perceive, same reasoning already applied to the sibling chart-fetch
// caches in scanner.js (sparkline, 24h) and maScanner.js (closes, 24h).
// Cached here is only the raw sorted/filtered quote series (symbol-only key)
// — the ratio-dependent spike computation below still runs fresh every call
// on whatever quotes it gets, so accuracy for a given ratio is unaffected.
const CHART_TTL_MS = 24 * 60 * 60 * 1000;
const chartCache = new Map(); // symbol → { quotes, fetchedAt }

async function getCachedQuotes(symbol, sixMonthsAgo) {
  var cached = chartCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CHART_TTL_MS) return cached.quotes;

  var chart = await yahooFinance.chart(symbol, { period1: sixMonthsAgo, interval: '1d' });
  var rawQuotes = chart && chart.quotes ? chart.quotes : [];
  var quotes = rawQuotes
    .filter(function (q) {
      return q && q.volume && q.volume > 0 && q.close && q.close > 0 && q.date;
    })
    .sort(function (a, b) {
      return new Date(a.date) - new Date(b.date);
    });
  chartCache.set(symbol, { quotes: quotes, fetchedAt: Date.now() });
  return quotes;
}

async function getHistoricalVolumeContext(symbol, currentVolumeRatio) {
  try {
    var sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    var quotes;
    try {
      quotes = await getCachedQuotes(symbol, sixMonthsAgo);
    } catch (e) {
      return null;
    }

    if (quotes.length < 12) return null;

    // Calculate volume ratio for each day using prior 10 days average
    var ratios = [];
    for (var i = 10; i < quotes.length; i++) {
      var prior10 = quotes.slice(i - 10, i);
      var sumVol = prior10.reduce(function (s, d) {
        return s + d.volume;
      }, 0);
      var avgVol = sumVol / 10;
      var ratio = avgVol > 0 ? quotes[i].volume / avgVol : 0;
      ratios.push({ index: i, ratio: ratio, date: quotes[i].date, close: quotes[i].close });
    }

    if (ratios.length === 0) return null;

    // Threshold: 80% of current ratio
    var threshold = currentVolumeRatio * 0.8;

    // Find the most recent spike (before today) meeting the threshold
    // Exclude the last entry as it may be today
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var spikeEntry = null;
    for (var j = ratios.length - 1; j >= 0; j--) {
      var entryDate = new Date(ratios[j].date);
      entryDate.setHours(0, 0, 0, 0);
      if (entryDate < today && ratios[j].ratio >= threshold) {
        spikeEntry = ratios[j];
        break;
      }
    }

    if (!spikeEntry) return null;

    // Find the closing price 5 trading days after the spike
    var spikeQuoteIndex = spikeEntry.index;
    var afterIndex = spikeQuoteIndex + 5;
    if (afterIndex >= quotes.length) return null;

    var priceAtSpike = spikeEntry.close;
    var priceAfter5Days = quotes[afterIndex].close;
    var movePercent = Math.round(((priceAfter5Days - priceAtSpike) / priceAtSpike) * 10000) / 100;
    var direction = movePercent > 0 ? 'up' : movePercent < 0 ? 'down' : 'flat';

    var spikeDateRaw = spikeEntry.date;
    var lastSpikeDate =
      spikeDateRaw instanceof Date ? spikeDateRaw.toISOString().slice(0, 10) : String(spikeDateRaw).slice(0, 10);

    return {
      lastSpikeDate: lastSpikeDate,
      lastSpikeRatio: Math.round(spikeEntry.ratio * 100) / 100,
      priceAtSpike: Math.round(priceAtSpike * 100) / 100,
      priceAfter5Days: Math.round(priceAfter5Days * 100) / 100,
      movePercent: movePercent,
      direction: direction,
    };
  } catch (e) {
    return null;
  }
}

module.exports = { getHistoricalVolumeContext };
