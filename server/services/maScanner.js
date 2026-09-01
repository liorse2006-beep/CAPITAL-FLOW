const yahooFinance = require('./yahoo');
const quoteCache = require('./quoteCache');

const CHART_BATCH_SIZE = 20;
const CHART_DELAY_MS = 250;
const MIN_MKT_CAP = 300_000_000;
// How many bars back we're willing to look for an actual MA crossing. Chosen
// so a chart's own historical closes decide the answer — never a guess or a
// default — and results.length beyond this window come back as `null`
// rather than a fabricated number.
const CROSS_LOOKBACK_BARS = 10;

// Daily closes cache — the expensive half of an MA scan is fetching a chart
// per symbol (hundreds of HTTP calls per scan). Closing prices gain at most
// one new bar per day, so within a 24h window the closes fetched for the
// first scan are still correct for every later scan. Live price still comes
// fresh from the Phase-1 quote — only the historical closes are reused.
const CLOSES_TTL_MS = 24 * 60 * 60 * 1000;
const closesCache = new Map(); // `${symbol}|${interval}` → { closes, fetchedAt }

function finiteOrNull(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function getCachedCloses(symbol, interval, minBars) {
  const e = closesCache.get(symbol + '|' + interval);
  if (!e) return null;
  if (Date.now() - e.fetchedAt >= CLOSES_TTL_MS) return null;
  // A cached window fetched for a small MA can't serve a larger one — e.g.
  // closes fetched for SMA20 don't have the 150 bars SMA150 needs.
  if (e.closes.length < minBars) return null;
  return e.closes;
}

function setCachedCloses(symbol, interval, closes) {
  closesCache.set(symbol + '|' + interval, { closes, fetchedAt: Date.now() });
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

  const qualified = [];
  tickers.forEach((sym) => {
    const q = quotesMap.get(sym);
    if (!q) {
      addError(sym);
      return;
    }
    const price = Number(q.regularMarketPrice);
    const marketCap = Number(q.marketCap);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(marketCap) || marketCap <= 0) {
      addError(sym);
      return;
    }
    checkedSymbols.add(
      String(q.symbol || sym)
        .trim()
        .toUpperCase()
    );
    if (marketCap < MIN_MKT_CAP) return;
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
          let closes = getCachedCloses(symbol, interval, ma + CROSS_LOOKBACK_BARS + 1);
          if (closes === null) {
            batchFetches++;
            const chart = await yahooFinance.chart(symbol, {
              period1: new Date(Date.now() - lb),
              interval,
            });
            closes = (chart?.quotes || [])
              .filter((x) => x?.close != null && Number.isFinite(Number(x.close)))
              .sort((a, b) => new Date(a.date) - new Date(b.date))
              .map((x) => Number(x.close));
            setCachedCloses(symbol, interval, closes);
          }
          phase2Done++;

          const maValue = sma(closes, ma);
          if (maValue === null) {
            addError(symbol);
            return null;
          }

          const price = q.regularMarketPrice;
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
            // Real bars-since-crossing computed from the same `closes`
            // history above, or null when the data doesn't show one within
            // the lookback window — see daysSinceCross's own doc comment.
            daysSinceCross: daysSinceCross(closes, ma),
          };
        } catch {
          addError(symbol);
          phase2Done++;
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

  return {
    results,
    processed: tickers.length,
    qualified: qualified.length,
    errors: [...errors],
    checkedSymbols: [...checkedSymbols],
    // Do not turn a total quote/chart outage into a trustworthy empty result.
    // The caller can still distinguish a subset outage as partial.
    dataStatus:
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
          : 'partial',
    dataAsOf: quoteDataAsOf || new Date().toISOString(),
  };
}

module.exports = { scanMA };
