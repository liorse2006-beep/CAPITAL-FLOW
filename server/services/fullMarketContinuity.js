const db = require('../db');
const { ALL_TICKERS } = require('../../tickers');
const {
  configuredEarlyCloseMinutes,
  isTradingDateKey,
  newYorkParts,
  sessionDateForTimestamp,
} = require('./marketCalendar');
const { reportError } = require('../utils/reportError');

const KEY = 'capital_flow_full_market_matches_v1';
const MAX_AGE_MS = 60 * 60 * 1000;
const universe = new Set(ALL_TICKERS);

function toPublicMarketRow(row) {
  const result = { ...row };
  delete result.quoteProvider;
  delete result.priceProvider;
  return result;
}

function eligibleRows(rows, now) {
  const session = sessionDateForTimestamp(now);
  if (!session || !isTradingDateKey(session)) return [];
  const close = configuredEarlyCloseMinutes().get(session) ?? 960;
  return rows.filter((row) => {
    if (
      !universe.has(row?.symbol) ||
      row.quoteDataStatus !== 'complete' ||
      ![row.price, row.volume, row.avgVolume, row.volumeRatio, row.marketCap].every((n) => Number.isFinite(n) && n > 0)
    )
      return false;
    const observed = Date.parse(row.quoteAsOf);
    if (!(observed <= now && observed > now - MAX_AGE_MS) || sessionDateForTimestamp(observed) !== session)
      return false;
    const { minutes } = newYorkParts(new Date(observed));
    return minutes >= 570 && minutes <= close;
  });
}

function reconcile(scan, previous, now) {
  const current = new Set(scan.results.map((row) => row.symbol));
  const stale = new Set(scan.staleSymbols || []);
  const checked = new Set((scan.checkedSymbols || []).filter((symbol) => !stale.has(symbol)));
  const retained =
    scan.dataStatus !== 'complete' && Array.isArray(scan.checkedSymbols)
      ? eligibleRows(previous, now).filter((row) => !checked.has(row.symbol) && !current.has(row.symbol))
      : [];
  return { retained, observed: [...eligibleRows(scan.results, now).map(toPublicMarketRow), ...retained] };
}

// Keep one bounded, public-market snapshot in the existing metadata store so
// brief rate limits can reuse observations even after a worker restart. A
// conditional write protects against concurrent workers and late scans.
async function retainFullMarketMatches(scan, previous, startedAt, now = Date.now()) {
  const local = () => reconcile(scan, previous, now);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const entry = await db.prepare('SELECT value FROM app_meta WHERE key = ?').get(KEY);
      const stored = entry ? JSON.parse(entry.value) : null;
      if (stored?.startedAt > startedAt) return { retained: [], observed: [] };
      const history = Array.isArray(stored?.rows) ? stored.rows : previous;
      const snapshot = reconcile(scan, history, now);
      const updated = await db
        .prepare(
          `INSERT INTO app_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE app_meta.value = ?`
        )
        .run(KEY, JSON.stringify({ startedAt, rows: snapshot.observed }), entry?.value ?? null);
      if (updated.changes > 0) return snapshot;
    }
  } catch (error) {
    reportError(error, '[All Markets] previous observations store');
  }
  return local();
}

function displayFullMarketScan(scan, retained = [], now = Date.now()) {
  const previous = eligibleRows(retained, now);
  const results = scan.results.map(toPublicMarketRow);
  for (const row of previous) {
    results.push({ ...row, previousMatch: true, quoteDataStatus: 'stale' });
  }
  return { results, dataStatus: previous.length ? 'partial' : scan.dataStatus };
}

function displayPrivateFullMarketScan(scan, previous, now = Date.now()) {
  // Only the server marks previously verified rows as previousMatch. Restore
  // that original quality for eligibility, without changing their as-of time.
  const observations = previous.map((row) =>
    row.previousMatch ? { ...row, previousMatch: false, quoteDataStatus: 'complete' } : row
  );
  return displayFullMarketScan(scan, reconcile(scan, observations, now).retained, now);
}

module.exports = { retainFullMarketMatches, displayFullMarketScan, displayPrivateFullMarketScan };
