const yahooFinance = require('./yahoo');

const BATCH_SIZE  = 20;
const DELAY_MS    = 250;
const MIN_MKT_CAP = 300_000_000; // $300M floor — avoids tiny illiquid names

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sma(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

// Calendar days needed to guarantee `ma` trading bars with buffer
function lookbackMs(ma, interval) {
  const daysPerBar = interval === '1wk' ? 7 : 1;
  return Math.ceil(ma * daysPerBar * 1.65) * 24 * 60 * 60 * 1000;
}

/**
 * Scan all tickers for proximity to SMA(ma) within ±distance%.
 *
 * Phase 1 — quote all tickers, filter by market cap (fast)
 * Phase 2 — chart history for filtered tickers only, compute SMA
 *
 * @param {string[]} tickers
 * @param {{ ma: number, distance: number, interval: string, onProgress: Function }} opts
 */
async function scanMA(tickers, { ma, distance, interval, onProgress }) {
  const total = tickers.length;
  let processed = 0;

  // ── Phase 1: quote → market cap filter ───────────────────────────────────
  const qualified = [];

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const rows = await Promise.all(batch.map(async (sym) => {
      try {
        const q = await yahooFinance.quote(sym);
        processed++;
        if (!q || !q.regularMarketPrice) return null;
        if ((q.marketCap || 0) < MIN_MKT_CAP) return null;
        return { symbol: sym, q };
      } catch { processed++; return null; }
    }));
    rows.filter(Boolean).forEach(x => qualified.push(x));
    if (onProgress) onProgress({ processed, total, found: 0, phase: 1 });
    if (i + BATCH_SIZE < tickers.length) await sleep(DELAY_MS);
  }

  // ── Phase 2: chart history → SMA → distance filter ───────────────────────
  const lb = lookbackMs(ma, interval);
  const results = [];
  const phase2Total = qualified.length;
  let phase2Done = 0;

  for (let i = 0; i < qualified.length; i += BATCH_SIZE) {
    const batch = qualified.slice(i, i + BATCH_SIZE);
    const batchRes = await Promise.all(batch.map(async ({ symbol, q }) => {
      try {
        const chart = await yahooFinance.chart(symbol, {
          period1: new Date(Date.now() - lb),
          interval,
        });
        phase2Done++;

        const closes = (chart?.quotes || [])
          .filter(x => x?.close != null)
          .map(x => x.close);

        const maValue = sma(closes, ma);
        if (maValue === null) return null;

        const price = q.regularMarketPrice;
        const pctDist = ((price - maValue) / maValue) * 100;
        if (Math.abs(pctDist) > distance) return null;

        return {
          symbol,
          name:      q.shortName || q.longName || symbol,
          price,
          change:    q.regularMarketChangePercent || 0,
          volume:    q.regularMarketVolume || 0,
          avgVolume: q.averageDailyVolume10Day || 0,
          marketCap: q.marketCap || 0,
          maValue:   +maValue.toFixed(2),
          maDistance: +pctDist.toFixed(2),
          direction: pctDist >= 0 ? 'above' : 'below',
        };
      } catch { phase2Done++; return null; }
    }));

    batchRes.filter(Boolean).forEach(r => results.push(r));

    // Report phase 2 progress mapped onto the second half of the progress bar
    const approxProcessed = Math.round(total * (0.5 + 0.5 * (phase2Done / Math.max(phase2Total, 1))));
    if (onProgress) onProgress({ processed: approxProcessed, total, found: results.length, phase: 2 });

    if (i + BATCH_SIZE < qualified.length) await sleep(DELAY_MS);
  }

  // Sort by absolute distance ascending (closest to MA first)
  results.sort((a, b) => Math.abs(a.maDistance) - Math.abs(b.maDistance));

  return { results, processed: tickers.length, qualified: qualified.length };
}

module.exports = { scanMA };
