'use strict';

// Durable Gemini budget reservations. Every reservation is an atomic UPSERT
// in the shared database, so a process restart or additional worker cannot
// reset the daily provider budget.
const db = require('../db');

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

async function reserveRow(day, scope, userId, limit) {
  await db.ready;
  const row = await db
    .prepare(
      `INSERT INTO ai_usage (usage_date, scope, user_id, calls, updated_at)
       VALUES (?, ?, ?, 1, unixepoch())
       ON CONFLICT(usage_date, scope, user_id) DO UPDATE SET
         calls = ai_usage.calls + 1,
         updated_at = unixepoch()
       WHERE ai_usage.calls < ?
       RETURNING calls`
    )
    .get(day, scope, userId, limit);
  return !!row;
}

/**
 * Reserve one AI call under both a global provider budget and, when supplied,
 * a per-user budget. A rare concurrent global-cap race can conservatively
 * consume a user slot without making a provider call; it can never exceed the
 * provider budget, which is the safety-critical property.
 */
async function reserveAiCall(scope, userId, { globalLimit, userLimit = null }) {
  const day = utcDay();
  if (userId != null && userLimit != null) {
    const userReserved = await reserveRow(day, scope + ':user', Number(userId), userLimit);
    if (!userReserved) return false;
  }
  return reserveRow(day, scope + ':global', 0, globalLimit);
}

async function pruneAiUsage(days = 90) {
  const safeDays = Math.max(7, Math.min(365, Number(days) || 90));
  return db.prepare("DELETE FROM ai_usage WHERE usage_date < date('now', ?)").run('-' + safeDays + ' days');
}

module.exports = { reserveAiCall, pruneAiUsage };
