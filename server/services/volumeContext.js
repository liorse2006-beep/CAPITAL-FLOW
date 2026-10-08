const yahooFinance = require('./yahoo');
const { createTTLCache } = require('../utils/ttlCache');
const {
  latestCompletedSessionDate,
  sessionDateForTimestamp,
  isTradingDateKey,
  previousTradingDateKey,
} = require('./marketCalendar');
const { reportError } = require('../utils/reportError');

// Reuse a validated six-month series for the same completed market session,
// within a bounded 24-hour TTL. A newly completed session invalidates the old
// entry even before the TTL expires. Concurrent callers share the fetch, but
// their requested ratio calculations remain independent.
const CHART_TTL_MS = 24 * 60 * 60 * 1000;
const chartCache = createTTLCache(CHART_TTL_MS);
const inFlight = new Map();

function positiveNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function verifiedQuotes(chart, symbol) {
  const normalized = (value) =>
    String(value || '')
      .trim()
      .toUpperCase()
      .replace(/\./g, '-');
  if (
    normalized(chart?.meta?.symbol) !== normalized(symbol) ||
    chart?.meta?.currency !== 'USD' ||
    !Array.isArray(chart?.quotes)
  )
    throw new Error('Historical chart identity or currency could not be verified');
  if (chart.quotes.length > 512) throw new Error('Historical chart exceeded its bounded daily window');
  const lastSession = latestCompletedSessionDate();
  const quotes = [];
  for (const bar of chart.quotes) {
    const time =
      bar?.date instanceof Date ? bar.date.getTime() : typeof bar?.date === 'string' ? Date.parse(bar.date) : NaN;
    if (!Number.isFinite(time) || time <= 0 || time > Date.now() + 300000)
      throw new Error('Historical chart contains an unverifiable observation time');
    const session = sessionDateForTimestamp(time);
    if (!isTradingDateKey(session)) throw new Error('Historical chart contains a non-trading session');
    // A still-growing current daily bar is not a completed historical session.
    if (session > lastSession) continue;
    const close = positiveNumber(bar.close);
    const volume = positiveNumber(bar.volume);
    if (close === null || volume === null) throw new Error('Historical chart contains an invalid price or volume');
    quotes.push({ date: new Date(time), close, volume, session });
  }
  quotes.sort((a, b) => a.date - b.date);
  if (quotes.length < 12 || quotes.at(-1).session !== lastSession)
    throw new Error('Historical chart is incomplete or stale');
  for (let index = 1; index < quotes.length; index++) {
    if (previousTradingDateKey(quotes[index].session) !== quotes[index - 1].session)
      throw new Error('Historical chart has a duplicate or missing trading session');
  }
  return { quotes, lastSession };
}

function latestTimestamp(quotes) {
  return quotes.reduce(function (latest, quote) {
    if (!quote || !quote.date) return latest;
    const date = new Date(quote.date);
    if (!Number.isFinite(date.getTime())) return latest;
    const iso = date.toISOString();
    return !latest || iso > latest ? iso : latest;
  }, null);
}

async function getCachedQuotes(symbol, sixMonthsAgo) {
  var cached = chartCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CHART_TTL_MS && cached.lastSession === latestCompletedSessionDate())
    return cached;
  if (inFlight.has(symbol)) return inFlight.get(symbol);
  if (inFlight.size >= 32) throw new Error('Historical chart request capacity is temporarily unavailable');
  const pending = (async () => {
    const chart = await yahooFinance.chart(symbol, { period1: sixMonthsAgo, interval: '1d' });
    const { quotes, lastSession } = verifiedQuotes(chart, symbol);
    const entry = { quotes, lastSession, dataAsOf: latestTimestamp(quotes), fetchedAt: Date.now() };
    chartCache.set(symbol, entry);
    return entry;
  })();
  inFlight.set(symbol, pending);
  try {
    return await pending;
  } finally {
    if (inFlight.get(symbol) === pending) inFlight.delete(symbol);
  }
}

async function getHistoricalVolumeContextResult(symbol, currentVolumeRatio) {
  try {
    if (positiveNumber(currentVolumeRatio) === null) throw new Error('Historical comparison ratio is invalid');
    var sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    var quotes;
    try {
      const cachedChart = await getCachedQuotes(symbol, sixMonthsAgo);
      quotes = cachedChart.quotes;
      var dataAsOf = cachedChart.dataAsOf;
    } catch (e) {
      reportError(e, '[volume-context/provider]');
      return { status: 'unavailable', context: null };
    }

    if (quotes.length < 12) return { status: 'unavailable', context: null };

    // Calculate volume ratio for each day using prior 10 days average
    var ratios = [];
    for (var i = 10; i < quotes.length; i++) {
      var prior10 = quotes.slice(i - 10, i);
      var sumVol = prior10.reduce(function (s, d) {
        return s + d.volume;
      }, 0);
      var avgVol = sumVol / 10;
      var ratio = avgVol > 0 ? quotes[i].volume / avgVol : 0;
      if (!Number.isFinite(avgVol) || !Number.isFinite(ratio))
        throw new Error('Historical volume calculation is not finite');
      ratios.push({ index: i, ratio: ratio, date: quotes[i].date, close: quotes[i].close });
    }

    if (ratios.length === 0) return { status: 'unavailable', context: null };

    // Threshold: 80% of current ratio
    var threshold = currentVolumeRatio * 0.8;

    // Only completed, consecutive exchange sessions reached this point.
    var spikeEntry = null;
    for (var j = ratios.length - 1; j >= 0; j--) {
      if (ratios[j].ratio >= threshold) {
        spikeEntry = ratios[j];
        break;
      }
    }

    if (!spikeEntry) return { status: 'complete', context: null, dataAsOf };

    // Find the closing price 5 trading days after the spike
    var spikeQuoteIndex = spikeEntry.index;
    var afterIndex = spikeQuoteIndex + 5;
    if (afterIndex >= quotes.length) return { status: 'complete', context: null, dataAsOf };

    var priceAtSpike = spikeEntry.close;
    var priceAfter5Days = quotes[afterIndex].close;
    var movePercent = Math.round(((priceAfter5Days - priceAtSpike) / priceAtSpike) * 10000) / 100;
    var direction = movePercent > 0 ? 'up' : movePercent < 0 ? 'down' : 'flat';

    const context = {
      lastSpikeDate: quotes[spikeQuoteIndex].session,
      lastSpikeRatio: Math.round(spikeEntry.ratio * 100) / 100,
      priceAtSpike: Math.round(priceAtSpike * 100) / 100,
      priceAfter5Days: Math.round(priceAfter5Days * 100) / 100,
      movePercent: movePercent,
      direction: direction,
      dataAsOf: dataAsOf || null,
    };
    if (
      [context.lastSpikeRatio, context.priceAtSpike, context.priceAfter5Days, context.movePercent].some(
        (value) => !Number.isFinite(value)
      )
    )
      throw new Error('Historical price calculation is not finite');
    return { status: 'complete', context, dataAsOf };
  } catch (e) {
    reportError(e, '[volume-context]');
    return { status: 'unavailable', context: null };
  }
}

async function getHistoricalVolumeContext(symbol, currentVolumeRatio) {
  return (await getHistoricalVolumeContextResult(symbol, currentVolumeRatio)).context;
}

module.exports = { getHistoricalVolumeContext, getHistoricalVolumeContextResult };
