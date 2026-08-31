// Per-user starred-ticker list, backed by SQLite so it follows the account
// across devices — mirrors the watchlist_alerts pattern (same table shape,
// same per-user isolation), just for "which symbols" instead of "at what ratio".

const db = require('../db');
const MAX_WATCHLIST_SIZE = 50;

async function getWatchlist(userId) {
  const rows = await db.prepare('SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY created_at ASC').all(userId);
  return rows.map((r) => r.symbol);
}

async function addToWatchlist(userId, symbol) {
  // Keep the size check inside the write. A route-level COUNT followed by an
  // INSERT has a TOCTOU gap where concurrent tabs can both observe 49 rows
  // and create a 51-ticker watchlist. Existing symbols remain harmless
  // no-ops, including when the list is already full.
  const result = await db
    .prepare(
      `INSERT INTO watchlist (user_id, symbol)
       SELECT ?, ?
        WHERE EXISTS (SELECT 1 FROM watchlist WHERE user_id = ? AND symbol = ?)
           OR (SELECT COUNT(*) FROM watchlist WHERE user_id = ?) < ?
       ON CONFLICT(user_id, symbol) DO NOTHING`
    )
    .run(userId, symbol, userId, symbol, userId, MAX_WATCHLIST_SIZE);
  if (result && result.changes === 1) return true;
  const exists = await db.prepare('SELECT 1 FROM watchlist WHERE user_id = ? AND symbol = ?').get(userId, symbol);
  if (exists) return false;
  const error = new Error(`Watchlist is full (max ${MAX_WATCHLIST_SIZE} tickers)`);
  error.code = 'WATCHLIST_LIMIT';
  throw error;
}

async function removeFromWatchlist(userId, symbol) {
  await db.prepare('DELETE FROM watchlist WHERE user_id = ? AND symbol = ?').run(userId, symbol);
}

module.exports = { getWatchlist, addToWatchlist, removeFromWatchlist, MAX_WATCHLIST_SIZE };
