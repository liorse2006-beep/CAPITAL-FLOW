const yahooFinance = require('./yahoo');
const { getQuotes } = require('./quoteCache');

const CHART_BATCH_SIZE = 20;
const CHART_DELAY_MS = 250;
const MIN_MKT_CAP = 300_000_000;

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
  return Math.ceil(ma * daysPerBar * 1.65) * 24 * 60 * 60 * 1000;
}

/**
 * Scan all tickers for proximity to SMA(ma) within ±distance%.
 *
 * Phase 1 — batch-fetch all quotes (5–6 HTTP calls via quoteCache)
 * Phase 2 — chart history for filtered tickers only, compute SMA
 *            (no batch endpoint exists for charts — stays per-symbol)
 */
async function scanMA(tickers, { ma, distance, interval, onProgress }) {
  const total = tickers.length;

  // ── Phase 1: batch quote fetch → market cap filter ───────────────────────
  if (onProgress) onProgress({ processed: 0, total, found: 0, phase: 1 });

  const quotesMap = await getQuotes(tickers, function (fetched, fetchTotal) {
    if (onProgress) {
      const approx = Math.round((fetched / fetchTotal) * (total * 0.5));
      onProgress({ processed: approx, total, found: 0, phase: 1 });
    }
  });

  const qualified = [];
  tickers.forEach((sym) => {
    const q = quotesMap.get(sym);
    if (!q || !q.regularMarketPrice) return;
    if ((q.marketCap || 0) < MIN_MKT_CAP) return;
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
    const batchRes = await Promise.all(
      batch.map(async ({ symbol, q }) => {
        try {
          const chart = await yahooFinance.chart(symbol, {
            period1: new Date(Date.now() - lb),
            interval,
          });
          phase2Done++;

          const closes = (chart?.quotes || []).filter((x) => x?.close != null).map((x) => x.close);
          const maValue = sma(closes, ma);
          if (maValue === null) return null;

          const price = q.regularMarketPrice;
          const pctDist = ((price - maValue) / maValue) * 100;
          if (Math.abs(pctDist) > distance) return null;

          return {
            symbol,
            name: q.shortName || q.longName || symbol,
            price,
            change: q.regularMarketChangePercent || 0,
            volume: q.regularMarketVolume || 0,
            avgVolume: q.averageDailyVolume10Day || 0,
            marketCap: q.marketCap || 0,
            maValue: +maValue.toFixed(2),
            maDistance: +pctDist.toFixed(2),
            direction: pctDist >= 0 ? 'above' : 'below',
          };
        } catch {
          phase2Done++;
          return null;
        }
      })
    );

    batchRes.filter(Boolean).forEach((r) => results.push(r));

    const approxProcessed = Math.round(total * (0.5 + 0.5 * (phase2Done / Math.max(phase2Total, 1))));
    if (onProgress) onProgress({ processed: approxProcessed, total, found: results.length, phase: 2 });

    if (i + CHART_BATCH_SIZE < qualified.length) await sleep(CHART_DELAY_MS);
  }

  results.sort((a, b) => Math.abs(a.maDistance) - Math.abs(b.maDistance));

  return { results, processed: tickers.length, qualified: qualified.length };
}

module.exports = { scanMA };
