// Aggregated daily site-visit counter. One row per UTC day in site_visits,
// bumped once per browser session by the frontend (see POST /api/visit). Kept
// deliberately coarse — a session count, not a raw pageview log — so it stays
// cheap to write and read and never needs pruning.

const db = require('../db');

function utcDay(d) {
  return (d || new Date()).toISOString().slice(0, 10); // YYYY-MM-DD
}

async function recordVisit() {
  const day = utcDay();
  await db
    .prepare(
      `INSERT INTO site_visits (day, count) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET count = count + 1`
    )
    .run(day);
}

/** { today, last7, total, daily: [{ day, count }] (last 7, newest first) } */
async function getVisitStats() {
  const today = utcDay();
  const weekAgo = utcDay(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)); // inclusive 7-day window

  const totalRow = await db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM site_visits').get();
  const todayRow = await db.prepare('SELECT count AS n FROM site_visits WHERE day = ?').get(today);
  const weekRow = await db
    .prepare('SELECT COALESCE(SUM(count), 0) AS n FROM site_visits WHERE day >= ?')
    .get(weekAgo);
  const daily = await db
    .prepare('SELECT day, count FROM site_visits WHERE day >= ? ORDER BY day DESC')
    .all(weekAgo);

  return {
    today: todayRow ? todayRow.n : 0,
    last7: weekRow ? weekRow.n : 0,
    total: totalRow ? totalRow.n : 0,
    daily,
  };
}

module.exports = { recordVisit, getVisitStats };
