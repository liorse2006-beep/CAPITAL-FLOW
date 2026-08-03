// Per-user watchlist volume-alert thresholds, backed by SQLite.
// Each row: (user_id, symbol) → min_ratio. Alerts fire only for the user
// who set them — never shared across accounts.

const db = require('../db');
const fs = require('fs');
const path = require('path');

// ── One-time migration from the legacy global JSON file ────────────────────
// Older builds stored a single shared { symbol: ratio } map. If that file
// exists, fold it into the admin user's alerts once, then rename it away so
// it can never leak into another account.
(async function migrateLegacy() {
  const LEGACY = path.join(__dirname, '../../watchlist-alerts.json');
  try {
    if (!fs.existsSync(LEGACY)) return;
    const legacy = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
    const admin = await db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
    if (admin && legacy && typeof legacy === 'object') {
      for (const [s, r] of Object.entries(legacy)) {
        if (typeof r === 'number' && r > 0) {
          await db.prepare('INSERT OR IGNORE INTO watchlist_alerts (user_id, symbol, min_ratio) VALUES (?, ?, ?)').run(admin.id, s, r);
        }
      }
    }
    fs.renameSync(LEGACY, LEGACY + '.migrated');
  } catch (_) {
    /* non-fatal */
  }
})();

/** One row → the shape both the frontend and the background checker use. */
function rowToAlert(r) {
  return r.type === 'price'
    ? { type: 'price', targetPrice: r.target_price, startingSide: r.starting_side }
    : { type: 'volume', minRatio: r.min_ratio };
}

/** All alert thresholds for one user → { SYMBOL: {type, minRatio|targetPrice, ...} } */
async function getWatchlistAlerts(userId) {
  const rows = await db.prepare('SELECT symbol, min_ratio, type, target_price, starting_side FROM watchlist_alerts WHERE user_id = ?').all(userId);
  const out = {};
  rows.forEach((r) => {
    out[r.symbol] = rowToAlert(r);
  });
  return out;
}

/**
 * alert is either { type: 'volume', minRatio } or
 * { type: 'price', targetPrice, startingSide }. min_ratio is stored as 0 for
 * a price row purely to satisfy the column's NOT NULL constraint — it's
 * never read back for that type.
 */
async function setAlert(userId, symbol, alert) {
  const minRatio = alert.type === 'price' ? 0 : alert.minRatio;
  const targetPrice = alert.type === 'price' ? alert.targetPrice : null;
  const startingSide = alert.type === 'price' ? alert.startingSide : null;
  await db.prepare(
    `INSERT INTO watchlist_alerts (user_id, symbol, min_ratio, type, target_price, starting_side) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, symbol) DO UPDATE SET min_ratio = excluded.min_ratio, type = excluded.type, target_price = excluded.target_price, starting_side = excluded.starting_side`
  ).run(userId, symbol, minRatio, alert.type, targetPrice, startingSide);
}

async function removeAlert(userId, symbol) {
  await db.prepare('DELETE FROM watchlist_alerts WHERE user_id = ? AND symbol = ?').run(userId, symbol);
}

async function clearAlerts(userId) {
  await db.prepare('DELETE FROM watchlist_alerts WHERE user_id = ?').run(userId);
}

/**
 * Every alert across all users, grouped for the background scanner:
 * { userId: { SYMBOL: {type, minRatio|targetPrice, ...}, ... }, ... }
 */
async function getAllAlertsGrouped() {
  const rows = await db.prepare('SELECT user_id, symbol, min_ratio, type, target_price, starting_side FROM watchlist_alerts').all();
  const out = {};
  rows.forEach((r) => {
    (out[r.user_id] ||= {})[r.symbol] = rowToAlert(r);
  });
  return out;
}

module.exports = { getWatchlistAlerts, setAlert, removeAlert, clearAlerts, getAllAlertsGrouped };
