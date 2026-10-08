const router = require('express').Router();
const yahooFinance = require('../services/yahoo');
const finnhub = require('../services/finnhub');
const { requireScanQuota } = require('../middleware/authMiddleware');
const { refundScan, quotaFor } = require('../services/scanQuota');
const { reportError } = require('../utils/reportError');
const { buildFinancialProvenance, SECTOR_FLOW_SOURCES } = require('../services/financialProvenance');
const { isProviderTimestampStale, providerTimestampMs } = require('../services/quoteCache');
const {
  latestCompletedSessionDate,
  sessionDateForTimestamp,
  isTradingDateKey,
  previousTradingDateKey,
} = require('../services/marketCalendar');

const ETFS = [
  'XLK',
  'XLF',
  'XLV',
  'XLY',
  'XLP',
  'XLE',
  'XLI',
  'XLB',
  'XLRE',
  'XLU',
  'XLC',
  'SOXX',
  'XOP',
  'XTL',
  'IGV',
];
const CACHE_TTL_MS = 60 * 1000;
let flowCache = null;
let inFlight = null;

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
function observationTime(value) {
  const timestamp = providerTimestampMs({ regularMarketTime: value });
  if (timestamp === null || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() + 300000)
    return null;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function roundOrNull(value, digits = 2) {
  const number = finiteOrNull(value);
  const rounded = number === null ? null : Math.round(number * 10 ** digits) / 10 ** digits;
  return Number.isFinite(rounded) ? rounded : null;
}
function unavailable(symbol) {
  return {
    symbol,
    price: null,
    change: null,
    volume: null,
    avgVolume: null,
    volRatio: null,
    flow: 'unavailable',
    dayHigh: null,
    dayLow: null,
    prevClose: null,
    lastSession: false,
    dataStatus: 'unavailable',
    dataAsOf: null,
    dataSource: null,
  };
}
function completedBars(chart, symbol) {
  if (chart?.meta?.symbol !== symbol || chart?.meta?.currency !== 'USD' || !Array.isArray(chart.quotes)) return [];
  const lastSession = latestCompletedSessionDate();
  const bars = chart.quotes
    .map((bar) => {
      const dataAsOf = observationTime(bar?.date);
      const volume = positiveOrNull(bar?.volume);
      const close = positiveOrNull(bar?.close);
      const high = positiveOrNull(bar?.high);
      const low = positiveOrNull(bar?.low);
      if (!dataAsOf || volume === null || close === null) return null;
      const session = sessionDateForTimestamp(Date.parse(dataAsOf));
      if (!isTradingDateKey(session) || session > lastSession || Date.now() - Date.parse(dataAsOf) > 30 * 86400000)
        return null;
      if (
        (high !== null && high < close) ||
        (low !== null && low > close) ||
        (high !== null && low !== null && high < low)
      )
        return null;
      return { volume, close, high, low, dataAsOf, session };
    })
    .filter(Boolean)
    .sort((a, b) => b.dataAsOf.localeCompare(a.dataAsOf));
  if (bars.some((bar, index) => index > 0 && bar.session === bars[index - 1].session)) return [];
  if (bars[0]?.session !== lastSession) return [];
  return bars.slice(0, 10);
}
async function loadSymbol(symbol, quote) {
  try {
    const chart = await yahooFinance.chart(symbol, { period1: new Date(Date.now() - 25 * 86400000), interval: '1d' });
    const bars = completedBars(chart, symbol);
    if (bars.length < 3) return unavailable(symbol);
    const avgVolume = Math.round(bars.reduce((sum, bar) => sum + bar.volume, 0) / bars.length);
    if (!Number.isFinite(avgVolume) || avgVolume <= 0) return unavailable(symbol);
    const quoteAsOf = observationTime(quote?.regularMarketTime);
    const validQuote =
      quote?.symbol === symbol &&
      quote?.currency === 'USD' &&
      quoteAsOf &&
      !isProviderTimestampStale({ regularMarketTime: quoteAsOf }) &&
      positiveOrNull(quote.regularMarketPrice) !== null &&
      positiveOrNull(quote.regularMarketVolume) !== null;
    const lastSession = !validQuote;
    let price = validQuote ? positiveOrNull(quote.regularMarketPrice) : bars[0].close;
    const volume = validQuote ? positiveOrNull(quote.regularMarketVolume) : bars[0].volume;
    let change = validQuote
      ? finiteOrNull(quote.regularMarketChangePercent)
      : ((bars[0].close - bars[1].close) / bars[1].close) * 100;
    let dayHigh = validQuote ? positiveOrNull(quote.regularMarketDayHigh) : bars[0].high;
    let dayLow = validQuote ? positiveOrNull(quote.regularMarketDayLow) : bars[0].low;
    let prevClose = validQuote ? positiveOrNull(quote.regularMarketPreviousClose) : bars[1].close;
    let dataAsOf = validQuote ? quoteAsOf : bars[0].dataAsOf;
    let dataSource = 'Yahoo Finance';
    const completeBaseline =
      bars.length === 10 &&
      bars.every((bar, index) => index === 0 || bar.session === previousTradingDateKey(bars[index - 1].session));
    let partial = lastSession || !completeBaseline;
    // Do not give an undated price the timestamp of a different observation.
    const current = await finnhub.fetchFinnhubQuote(symbol);
    if (current && !lastSession && !isProviderTimestampStale({ regularMarketTime: current.dataAsOf })) {
      if (sessionDateForTimestamp(Date.parse(current.dataAsOf)) !== sessionDateForTimestamp(Date.parse(quoteAsOf)))
        return unavailable(symbol);
      price = current.price;
      change = current.change;
      dayHigh = current.dayHigh;
      dayLow = current.dayLow;
      prevClose = current.prevClose;
      dataAsOf = current.dataAsOf < quoteAsOf ? current.dataAsOf : quoteAsOf;
      dataSource = 'Finnhub / Yahoo Finance';
      partial = partial || current.dataStatus !== 'complete';
    }
    if ([change, dayHigh, dayLow, prevClose].some((value) => value === null)) partial = true;
    if (dayHigh !== null && dayLow !== null && dayHigh < dayLow) {
      dayHigh = null;
      dayLow = null;
      partial = true;
    }
    const volRatio = roundOrNull(volume / avgVolume);
    if (volRatio === null || !Number.isFinite(change === null ? 0 : change)) return unavailable(symbol);
    let flow = 'neutral';
    if (change !== null && change > 0.3 && volRatio > 1.1) flow = 'inflow';
    else if (change !== null && change < -0.3 && volRatio > 1.1) flow = 'outflow';
    return {
      symbol,
      price,
      change: roundOrNull(change),
      volume,
      avgVolume,
      volRatio,
      flow,
      dayHigh,
      dayLow,
      prevClose,
      lastSession,
      dataStatus: partial ? 'partial' : 'complete',
      dataAsOf,
      dataSource,
    };
  } catch (error) {
    reportError(error, '[sector-flow provider]');
    return unavailable(symbol);
  }
}
async function loadFlow() {
  const quotes = new Map();
  try {
    const batch = await yahooFinance.quote(ETFS);
    for (const quote of Array.isArray(batch) ? batch : [batch]) {
      if (quote && ETFS.includes(quote.symbol)) quotes.set(quote.symbol, quotes.has(quote.symbol) ? null : quote);
    }
  } catch (error) {
    reportError(error, '[sector-flow batch]');
  }
  const results = await Promise.all(ETFS.map((symbol) => loadSymbol(symbol, quotes.get(symbol))));
  const available = results.filter((row) => row.dataStatus !== 'unavailable');
  const dataStatus =
    available.length === 0
      ? 'unavailable'
      : available.length !== results.length || available.some((row) => row.dataStatus !== 'complete')
        ? 'partial'
        : 'complete';
  const times = available
    .map((row) => row.dataAsOf)
    .filter(Boolean)
    .sort();
  const payload = { results, fetchTime: new Date().toISOString(), dataStatus, dataAsOf: times[0] || null };
  flowCache = { payload, expiresAt: Date.now() + CACHE_TTL_MS };
  return payload;
}
function freshCache() {
  if (!flowCache || flowCache.expiresAt <= Date.now()) return false;
  return flowCache.payload.results.every(
    (row) =>
      row.dataStatus === 'unavailable' ||
      (row.lastSession
        ? sessionDateForTimestamp(Date.parse(row.dataAsOf)) === latestCompletedSessionDate()
        : !isProviderTimestampStale({ regularMarketTime: row.dataAsOf }))
  );
}
router.get('/sector-flow', requireScanQuota('sectorMoving'), async (req, res) => {
  try {
    let shared = false;
    let payload;
    if (freshCache()) {
      shared = true;
      payload = flowCache.payload;
    } else if (inFlight) {
      shared = true;
      payload = await inFlight;
    } else {
      const work = loadFlow();
      inFlight = work;
      try {
        payload = await work;
      } finally {
        if (inFlight === work) inFlight = null;
      }
    }
    if (shared || payload.dataStatus === 'unavailable') await refundScan(req.user, req.scanReservation);
    res.json({
      ...payload,
      ...(shared ? { fromCache: true } : {}),
      dataProvenance: buildFinancialProvenance({
        dataAsOf: payload.dataAsOf,
        capturedAt: payload.fetchTime,
        status: payload.dataStatus,
        quoteStatus: payload.dataStatus,
        sources: SECTOR_FLOW_SOURCES.map((source) => ({
          ...source,
          asOf: source.provider === 'Yahoo Finance' ? payload.dataAsOf : null,
          status: source.provider === 'Yahoo Finance' ? payload.dataStatus : 'unknown',
        })),
      }),
      ...quotaFor(req.user),
    });
  } catch (error) {
    await refundScan(req.user, req.scanReservation);
    reportError(error, '[sectors]');
    res.status(503).json({
      error: 'Market data is temporarily unavailable. Please try again in a few minutes.',
      dataStatus: 'unavailable',
    });
  }
});
module.exports = router;
