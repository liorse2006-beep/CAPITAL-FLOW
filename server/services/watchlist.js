// Per-user starred-ticker list, backed by SQLite so it follows the account
// across devices — mirrors the watchlist_alerts pattern (same table shape,
// same per-user isolation), just for "which symbols" instead of "at what ratio".

const db = require('../db');

async function getWatchlist(userId) {
  const rows = await db.prepare('SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY created_at ASC').all(userId);
  return rows.map((r) => r.symbol);
}

async function addToWatchlist(userId, symbol) {
  await db.prepare('INSERT OR IGNORE INTO watchlist (user_id, symbol) VALUES (?, ?)').run(userId, symbol);
}

async function removeFromWatchlist(userId, symbol) {
  await db.prepare('DELETE FROM watchlist WHERE user_id = ? AND symbol = ?').run(userId, symbol);
}

module.exports = { getWatchlist, addToWatchlist, removeFromWatchlist };
