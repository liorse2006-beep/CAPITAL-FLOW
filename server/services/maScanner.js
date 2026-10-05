const yahooFinance = require('./yahoo');
const quoteCache = require('./quoteCache');
const { buildFinancialProvenance, MOVING_AVERAGE_SOURCES } = require('./financialProvenance');
const { latestCompletedSessionDate, sessionDateForTimestamp } = require('./marketCalendar');

const CHART_BATCH_SIZE = 20;
const CHART_DELAY_MS = 250;
const MIN_MKT_CAP = 300_000_000;
// How many bars back we're willing to look for an actual MA crossing. Chosen
// so a chart's own historical closes decide the answer — never a guess or a
// default — and results.length beyond this window come back as `null`
// rather than a fabricated number.
const CROSS_LOOKBACK_BARS = 10;

// Reuse verified historical closes, but never let the cache TTL hide a newly
// completed exchange session. Cache/request time is not a bar observation.
const CLOSES_TTL_MS = 24 * 60 * 60 * 1000;
const closesCache = new Map(); // `${symbol}|${interval}` → { closes, asOf, fetchedAt }
const YAHOO_ALIASES = { 'BRK.B': 'BRK-B', 'BF.B': 'BF-B' };

function finiteOrNull(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function historyIsCurrent(asOf, interval, now = Date.now()) {
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp) || timestamp > now + 300000) return false;
  const latestSession = latestCompletedSessionDate(new Date(now));
  const startDate = sessionDateForTimestamp(timestamp);
  if (!startDate) return false;
  if (interval === '1d') return startDate >= latestSession;
  if (interval !== '1wk') return false;
  // A weekly candle is stamped at the start of its period, not Friday's
  // close. Its seven-day period must cover the most recent completed session.
  const end = new Date(startDate + 'T00:00:00.000Z');
  end.setUTCDate(end.getUTCDate() + 6);
  return end.toISOString().slice(0, 10) >= latestSession;
}

function invalidHistory(reason) {
  const error = new Error('Moving average history could not be verified');
  error.code = reason;
  return error;
}

function verifiedHistory(chart, symbol, interval) {
  const expected = YAHOO_ALIASES[symbol] || symbol;
  if (typeof chart?.meta?.symbol !== 'string' || chart.meta.symbol.trim().toUpperCase() !== expected) {
    throw invalidHistory('MA_HISTORY_SYMBOL');
  }
  if (chart.meta.currency !== 'USD') throw invalidHistory('MA_HISTORY_CURRENCY');
  if (!Array.isArray(chart.quotes) || !chart.quotes.length) throw invalidHistory('MA_HISTORY_EMPTY');
  const now = Date.now();
  const seen = new Set();
  const bars = chart.quotes
    .map((bar) => {
      const rawDate = bar?.date;
      if (!(rawDate instanceof Date) && typeof rawDate !== 'string' && typeof rawDate !== 'number') {
        throw invalidHistory('MA_HISTORY_TIMESTAMP');
      }
      if (rawDate === '') throw invalidHistory('MA_HISTORY_TIMESTAMP');
      const date = rawDate instanceof Date ? rawDate : new Date(rawDate);
      const timestamp = date.getTime();
      const close = finiteOrNull(bar?.close);
      if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now + 300000) {
        throw invalidHistory('MA_HISTORY_TIMESTAMP');
      }
      if (seen.has(timestamp)) throw invalidHistory('MA_HISTORY_DUPLICATE');
      if (close === null || close <= 0) throw invalidHistory('MA_HISTORY_CLOSE');
      seen.add(timestamp);
      return { timestamp, close };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
  // Do not drop malformed bars and compress a different sequence into SMA(n).
  const asOf = new Date(bars.at(-1).timestamp).toISOString();
  if (!historyIsCurrent(asOf, interval, now)) throw invalidHistory('MA_HISTORY_STALE');
  return { closes: bars.map((bar) => bar.close), asOf };
}

function getCachedHistory(symbol, interval, minBars) {
  const e = closesCache.get(symbol + '|' + interval);
  if (!e) return null;
  if (
    Date.now() - e.fetchedAt < 0 ||
    Date.now() - e.fetchedAt >= CLOSES_TTL_MS ||
    !historyIsCurrent(e.asOf, interval)
  ) {
    closesCache.delete(symbol + '|' + interval);
    return null;
  }
  // A cached window fetched for a small MA can't serve a larger one — e.g.
  // closes fetched for SMA20 don't have the 150 bars SMA150 needs.
  if (e.closes.length < minBars) return null;
  return e;
}

function setCachedHistory(symbol, interval, history) {
  closesCache.set(symbol + '|' + interval, { ...history, fetchedAt: Date.now() });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sma(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function lookbackMs(ma, interval) {
  const daysPerBar = interval === '1wk' ? 7 : 1;
  // Needs to cover the MA window itself plus CROSS_LOOKBACK_BARS of history
  // before it, so daysSinceCross always has real bars to check rather than
  // running out of data and having to guess.
  const barsNeeded = ma + CROSS_LOOKBACK_BARS + 1;
  return Math.ceil(barsNeeded * daysPerBar * 1.65) * 24 * 60 * 60 * 1000;
}

/**
 * How many bars ago the price last crossed from one side of SMA(period) to
 * the other, computed strictly from `closes` — the same historical bars
 * Yahoo returned for this symbol, nothing else. Walks backward bar by bar,
 * each time computing the SMA as it actually stood using only the closes up
 * to and including that bar (never a later bar's data), and compares the
 * bar's own close against it.
 *
 * Returns:
 *  - 0 if the most recently completed bar is the first bar on its side
 *    (i.e. it flipped relative to the bar before it) — "crossed as of the
 *    latest close".
 *  - N > 0 if the flip happened N bars before the latest completed bar.
 *  - null if no flip is found within CROSS_LOOKBACK_BARS, OR there isn't
 *    enough history to check that far back. null always means "unknown
 *    from the data available" — it is never coerced into 0 or any other
 *    number.
 */
function daysSinceCross(closes, period) {
  const latest = closes.length - 1;
  let prevSide = null;
  for (let k = 0; k <= CROSS_LOOKBACK_BARS; k++) {
    const j = latest - k;
    if (j - period + 1 < 0) return null; // ran out of real history — unknown, not guessed
    const maAtJ = sma(closes.slice(0, j + 1), period);
    if (maAtJ === null) return null;
    const side = closes[j] >= maAtJ ? 'above' : 'below';
    if (prevSide !== null && side !== prevSide) return k - 1;
    prevSide = side;
  }
  return null; // side held for the entire lookback window — no cross found
}

/**
 * Scan all tickers for proximity to SMA(ma) within ±distance%.
 *
 * Phase 1 — batch-fetch all quotes (5–6 HTTP calls via quoteCache)
 * Phase 2 — chart history for filtered tickers only, compute SMA
 *            (no batch endpoint exists for charts — stays per-symbol)
 */
async function scanMA(tickers, { ma, distance, interval, direction = 'all', onProgress } = {}) {
  const total = tickers.length;
  const errors = new Set();
  const checkedSymbols = new Set();

  function addError(symbol) {
    const normalized = String(symbol || '')
      .trim()
      .toUpperCase();
    if (normalized) errors.add(normalized);
  }

  // ── Phase 1: batch quote fetch → market cap filter ───────────────────────
  if (onProgress) onProgress({ processed: 0, total, found: 0, phase: 1 });

  const quotesMap = await quoteCache.getQuotes(tickers, function (fetched, fetchTotal) {
    if (onProgress) {
      const approx = Math.round((fetched / fetchTotal) * (total * 0.5));
      onProgress({ processed: approx, total, found: 0, phase: 1 });
    }
  });
  const quoteDataAsOf = quotesMap.dataAsOf || null;
  const quoteDataStale = quotesMap.usedStaleFallback === true || Number(quotesMap.staleCount || 0) > 0;
  const staleQuoteSymbols = new Set(
    (Array.isArray(quotesMap.staleSymbols) ? quotesMap.staleSymbols : []).map((symbol) =>
      String(symbol || '')
        .trim()
        .toUpperCase()
    )
  );

  const qualified = [];
  tickers.forEach((sym) => {
    const q = quotesMap.get(sym);
    if (!q) {
      addError(sym);
      return;
    }
    const price = finiteOrNull(q.regularMarketPrice);
    const marketCap = finiteOrNull(q.marketCap);
    if (
      price === null ||
      price <= 0 ||
      marketCap === null ||
      marketCap <= 0 ||
      String(q.symbol || '')
        .trim()
        .toUpperCase() !== sym ||
      (q.currency != null && q.currency !== 'USD')
    ) {
      addError(sym);
      return;
    }
    if (marketCap < MIN_MKT_CAP) {
      checkedSymbols.add(sym);
      return;
    }
    qualified.push({ symbol: sym, q });
  });

  if (onProgress) onProgress({ processed: Math.round(total * 0.5), total, found: 0, phase: 1 });

  // ── Phase 2: chart history → SMA → distance filter ───────────────────────
  const lb = lookbackMs(ma, interval);
  const results = [];
  const phase2Total = qualified.length;
  let phase2Done = 0;

  for (let i = 0; i < qualified.length; i += CHART_BATCH_SIZE) {
    const batch = qualified.slice(i, i + CHART_BATCH_SIZE);
    let batchFetches = 0;
    const batchRes = await Promise.all(
      batch.map(async ({ symbol, q }) => {
        try {
          let history = getCachedHistory(symbol, interval, ma + CROSS_LOOKBACK_BARS + 1);
          if (history === null) {
            batchFetches++;
            const chart = await yahooFinance.chart(YAHOO_ALIASES[symbol] || symbol, {
              period1: new Date(Date.now() - lb),
              interval,
            });
            history = verifiedHistory(chart, symbol, interval);
            setCachedHistory(symbol, interval, history);
          }
          phase2Done++;

          const closes = history.closes;
          const maValue = sma(closes, ma);
          if (maValue === null || !Number.isFinite(maValue) || maValue <= 0) {
            addError(symbol);
            return null;
          }

          checkedSymbols.add(symbol);
          const price = finiteOrNull(q.regularMarketPrice);
          const pctDist = ((price - maValue) / maValue) * 100;
          if (Math.abs(pctDist) > distance) return null;
          if (direction === 'above' && pctDist < 0) return null;
          if (direction === 'below' && pctDist >= 0) return null;

          return {
            symbol,
            name: q.shortName || q.longName || symbol,
            price,
            change: finiteOrNull(q.regularMarketChangePercent),
            volume: finiteOrNull(q.regularMarketVolume),
            avgVolume: finiteOrNull(q.averageDailyVolume10Day),
            marketCap: finiteOrNull(q.marketCap),
            maValue: +maValue.toFixed(2),
            maDistance: +pctDist.toFixed(2),
            direction: pctDist >= 0 ? 'above' : 'below',
            maPeriod: ma,
            maInterval: interval,
            maDirection: pctDist >= 0 ? 'above' : 'below',
            dataQuality: 'complete',
            historyAsOf: history.asOf,
            quoteDataStatus: staleQuoteSymbols.has(String(symbol).trim().toUpperCase()) ? 'stale' : 'complete',
            quoteAsOf:
              quoteCache.providerTimestampMs(q) === null
                ? null
                : new Date(quoteCache.providerTimestampMs(q)).toISOString(),
            // Real bars-since-crossing computed from the same `closes`
            // history above, or null when the data doesn't show one within
            // the lookback window — see daysSinceCross's own doc comment.
            daysSinceCross: daysSinceCross(closes, ma),
          };
        } catch (err) {
          addError(symbol);
          phase2Done++;
          console.warn('[MA Scanner] History unavailable', {
            symbol,
            reason: /^MA_HISTORY_[A-Z_]+$/.test(err?.code || '') ? err.code : 'PROVIDER_FAILURE',
            timestamp: new Date().toISOString(),
          });
          return null;
        }
      })
    );

    batchRes.filter(Boolean).forEach((r) => results.push(r));

    const approxProcessed = Math.round(total * (0.5 + 0.5 * (phase2Done / Math.max(phase2Total, 1))));
    if (onProgress) onProgress({ processed: approxProcessed, total, found: results.length, phase: 2 });

    // The delay only exists to stay polite to the chart API — a batch served
    // entirely from cache made zero network calls and needs no pause.
    if (i + CHART_BATCH_SIZE < qualified.length && batchFetches > 0) await sleep(CHART_DELAY_MS);
  }

  results.sort((a, b) => Math.abs(a.maDistance) - Math.abs(b.maDistance));

  let dataStatus =
    errors.size === 0
      ? 'complete'
      : errors.size >=
          new Set(
            tickers.map((symbol) =>
              String(symbol || '')
                .trim()
                .toUpperCase()
            )
          ).size
        ? 'unavailable'
        : 'partial';
  if (dataStatus === 'complete' && quoteDataStale) dataStatus = 'partial';

  return {
    results,
    processed: tickers.length,
    qualified: qualified.length,
    errors: [...errors],
    checkedSymbols: [...checkedSymbols],
    // Do not turn a total quote/chart outage into a trustworthy empty result.
    // The caller can still distinguish a subset outage as partial.
    dataStatus,
    quoteDataStatus: quoteDataStale ? 'stale' : quotesMap.providerFailure ? 'unavailable' : 'complete',
    staleCount: Number(quotesMap.staleCount || 0),
    staleSymbols: [...staleQuoteSymbols],
    dataAsOf: quoteDataAsOf,
    dataProvenance: buildFinancialProvenance({
      dataAsOf: quoteDataAsOf || null,
      status: dataStatus,
      quoteStatus: quoteDataStale ? 'stale' : quotesMap.providerFailure ? 'unavailable' : 'complete',
      sources: MOVING_AVERAGE_SOURCES.map((source) => ({
        ...source,
        asOf: quoteDataAsOf || null,
        status: quoteDataStale ? 'stale' : quotesMap.providerFailure ? 'unavailable' : 'complete',
      })),
    }),
  };
}

module.exports = { scanMA };
