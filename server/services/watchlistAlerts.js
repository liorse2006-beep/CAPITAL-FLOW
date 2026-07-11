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

/** All alert thresholds for one user → { SYMBOL: ratio } */
async function getWatchlistAlerts(userId) {
  const rows = await db.prepare('SELECT symbol, min_ratio FROM watchlist_alerts WHERE user_id = ?').all(userId);
  const out = {};
  rows.forEach((r) => {
    out[r.symbol] = r.min_ratio;
  });
  return out;
}

async function setAlert(userId, symbol, minRatio) {
  await db.prepare(
    `INSERT INTO watchlist_alerts (user_id, symbol, min_ratio) VALUES (?, ?, ?)
     ON CONFLICT(user_id, symbol) DO UPDATE SET min_ratio = excluded.min_ratio`
  ).run(userId, symbol, minRatio);
}

async function removeAlert(userId, symbol) {
  await db.prepare('DELETE FROM watchlist_alerts WHERE user_id = ? AND symbol = ?').run(userId, symbol);
}

async function clearAlerts(userId) {
  await db.prepare('DELETE FROM watchlist_alerts WHERE user_id = ?').run(userId);
}

/**
 * Every alert across all users, grouped for the background scanner:
 * { userId: { SYMBOL: ratio, ... }, ... }
 */
async function getAllAlertsGrouped() {
  const rows = await db.prepare('SELECT user_id, symbol, min_ratio FROM watchlist_alerts').all();
  const out = {};
  rows.forEach((r) => {
    (out[r.user_id] ||= {})[r.symbol] = r.min_ratio;
  });
  return out;
}

module.exports = { getWatchlistAlerts, setAlert, removeAlert, clearAlerts, getAllAlertsGrouped };
