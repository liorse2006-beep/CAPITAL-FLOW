// Per-user watchlist volume-alert thresholds, backed by SQLite.
// Each row: (user_id, symbol) → min_ratio. Alerts fire only for the user
// who set them — never shared across accounts.

const db = require('../db');
const fs = require('fs');
const path = require('path');

const SYMBOL_RE = /^[A-Z0-9.-]{1,10}$/;
const MAX_ALERTS_PER_USER = 50;
const MAX_VOLUME_RATIO = 1000;
const MAX_PRICE = 10_000_000;

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
        const symbol = String(s || '')
          .trim()
          .toUpperCase();
        if (SYMBOL_RE.test(symbol) && Number.isFinite(r) && r > 0 && r <= MAX_VOLUME_RATIO) {
          await db
            .prepare('INSERT OR IGNORE INTO watchlist_alerts (user_id, symbol, min_ratio) VALUES (?, ?, ?)')
            .run(admin.id, symbol, r);
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
  const rows = await db
    .prepare(
      'SELECT symbol, min_ratio, type, target_price, starting_side FROM watchlist_alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    )
    .all(userId, MAX_ALERTS_PER_USER);
  const out = {};
  rows.forEach((r) => {
    if (!SYMBOL_RE.test(String(r.symbol || ''))) return;
    if (r.type === 'price') {
      if (!Number.isFinite(Number(r.target_price)) || Number(r.target_price) <= 0 || Number(r.target_price) > MAX_PRICE)
        return;
      if (!['above', 'below'].includes(r.starting_side)) return;
    } else if (
      !Number.isFinite(Number(r.min_ratio)) ||
      Number(r.min_ratio) <= 0 ||
      Number(r.min_ratio) > MAX_VOLUME_RATIO
    ) {
      return;
    }
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
  if (!SYMBOL_RE.test(symbol)) {
    const error = new Error('Invalid symbol');
    error.code = 'INVALID_ALERT';
    throw error;
  }
  if (!alert || !['volume', 'price'].includes(alert.type)) {
    const error = new Error('Invalid alert type');
    error.code = 'INVALID_ALERT';
    throw error;
  }
  if (
    alert.type === 'volume' &&
    (!Number.isFinite(alert.minRatio) || alert.minRatio <= 0 || alert.minRatio > MAX_VOLUME_RATIO)
  ) {
    const error = new Error('minRatio is outside the supported range');
    error.code = 'INVALID_ALERT';
    throw error;
  }
  if (
    alert.type === 'price' &&
    (!Number.isFinite(alert.targetPrice) || alert.targetPrice <= 0 || alert.targetPrice > MAX_PRICE)
  ) {
    const error = new Error('targetPrice is outside the supported range');
    error.code = 'INVALID_ALERT';
    throw error;
  }
  if (alert.type === 'price' && !['above', 'below'].includes(alert.startingSide)) {
    const error = new Error('Invalid starting side');
    error.code = 'INVALID_ALERT';
    throw error;
  }

  const minRatio = alert.type === 'price' ? 0 : alert.minRatio;
  const targetPrice = alert.type === 'price' ? alert.targetPrice : null;
  const startingSide = alert.type === 'price' ? alert.startingSide : null;
  // Keep the cap decision inside the same INSERT that writes the row. A
  // SELECT-then-INSERT check lets two concurrent requests both observe 49
  // existing alerts and create 51. Existing symbols remain updatable even at
  // the cap; only a genuinely new symbol is rejected by the conditional
  // SELECT. `changes()` is not needed here because the caller only needs the
  // distinction between one inserted/updated row and a cap-rejected insert.
  const result = await db
    .prepare(
      `INSERT INTO watchlist_alerts (user_id, symbol, min_ratio, type, target_price, starting_side)
       SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM watchlist_alerts WHERE user_id = ? AND symbol = ?)
           OR (SELECT COUNT(*) FROM watchlist_alerts WHERE user_id = ?) < ?
       ON CONFLICT(user_id, symbol) DO UPDATE SET
         min_ratio = excluded.min_ratio,
         type = excluded.type,
         target_price = excluded.target_price,
         starting_side = excluded.starting_side`
    )
    .run(userId, symbol, minRatio, alert.type, targetPrice, startingSide, userId, symbol, userId, MAX_ALERTS_PER_USER);
  if (!result || result.changes !== 1) {
    const error = new Error(`Maximum ${MAX_ALERTS_PER_USER} alerts per user`);
    error.code = 'ALERT_LIMIT';
    throw error;
  }
}

async function removeAlert(userId, symbol) {
  if (!SYMBOL_RE.test(symbol)) return;
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
  const rows = await db
    .prepare(
      'SELECT user_id, symbol, min_ratio, type, target_price, starting_side FROM watchlist_alerts ORDER BY created_at DESC'
    )
    .all();
  const out = {};
  rows.forEach((r) => {
    if (!SYMBOL_RE.test(String(r.symbol || ''))) return;
    if (r.type === 'price') {
      if (!Number.isFinite(Number(r.target_price)) || Number(r.target_price) <= 0 || Number(r.target_price) > MAX_PRICE)
        return;
      if (!['above', 'below'].includes(r.starting_side)) return;
    } else if (
      !Number.isFinite(Number(r.min_ratio)) ||
      Number(r.min_ratio) <= 0 ||
      Number(r.min_ratio) > MAX_VOLUME_RATIO
    ) {
      return;
    }
    if (Object.keys(out[r.user_id] || {}).length >= MAX_ALERTS_PER_USER) return;
    (out[r.user_id] ||= {})[r.symbol] = rowToAlert(r);
  });
  return out;
}

module.exports = {
  getWatchlistAlerts,
  setAlert,
  removeAlert,
  clearAlerts,
  getAllAlertsGrouped,
  SYMBOL_RE,
  MAX_ALERTS_PER_USER,
  MAX_VOLUME_RATIO,
  MAX_PRICE,
};
