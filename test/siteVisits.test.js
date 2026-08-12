// Site-visit counter (server/services/siteVisits.js) — the admin "how many
// people opened the site" metric. Aggregated per UTC day.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');
before(async () => {
  await db.ready;
});

const { recordVisit, getVisitStats } = require('../server/services/siteVisits');

test('recordVisit increments today, and getVisitStats reports today/last7/total', async () => {
  const before = await getVisitStats();

  await recordVisit();
  await recordVisit();
  await recordVisit();

  const after = await getVisitStats();
  assert.strictEqual(after.today - before.today, 3, 'three visits recorded today');
  assert.strictEqual(after.last7 - before.last7, 3, 'last-7-day window includes today');
  assert.strictEqual(after.total - before.total, 3, 'all-time total climbs too');
  assert.ok(Array.isArray(after.daily), 'daily breakdown is an array');
});

test('an older day still counts toward the all-time total but not the 7-day window', async () => {
  const base = await getVisitStats();
  // A visit stamped 30 days ago — outside the 7-day window, inside all-time.
  await db
    .prepare(
      "INSERT INTO site_visits (day, count) VALUES (date('now','-30 days'), 5) ON CONFLICT(day) DO UPDATE SET count = count + 5"
    )
    .run();

  const after = await getVisitStats();
  assert.strictEqual(after.total - base.total, 5, 'all-time total includes the old day');
  assert.strictEqual(after.last7 - base.last7, 0, '7-day window excludes a 30-day-old visit');
});
