const db = require('../db');

// All snapshot rows, read in one query and kept for a few minutes so page
// views and the sitemap never hit the database per request.
const TTL_MS = 10 * 60 * 1000;
let cached = null;
let loadedAt = 0;
let inFlight = null;

async function loadAll() {
  const rows = await db.prepare('SELECT symbol, data FROM stock_snapshots').all();
  const map = new Map();
  for (const row of rows) {
    try {
      map.set(row.symbol, JSON.parse(row.data));
    } catch {
      // Skip a corrupt row; the next snapshot run rewrites it.
    }
  }
  return map;
}

async function getSnapshots() {
  if (cached && Date.now() - loadedAt < TTL_MS) return cached;
  if (!inFlight) {
    inFlight = loadAll()
      .then((map) => {
        cached = map;
        loadedAt = Date.now();
        return map;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

function resetSnapshotCache() {
  cached = null;
  loadedAt = 0;
}

// A page is worth indexing only with its core data: price, size, a trend
// reference and a sector. Anything less is served with noindex.
function isIndexable(snapshot) {
  if (!snapshot || !snapshot.price || !(snapshot.sma50 || snapshot.sma150)) return false;
  if (snapshot.kind === 'etf') return Array.isArray(snapshot.holdings) && snapshot.holdings.length > 0;
  return !!(snapshot.marketCap && snapshot.sector);
}

module.exports = { getSnapshots, resetSnapshotCache, isIndexable };
