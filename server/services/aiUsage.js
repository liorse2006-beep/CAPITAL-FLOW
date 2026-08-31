'use strict';

// Durable Gemini budget reservations. Every reservation is an atomic UPSERT
// in the shared database, so a process restart or additional worker cannot
// reset the daily provider budget.
const crypto = require('crypto');
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

function hasReturnedRow(result) {
  return !!result && Array.isArray(result.rows) && result.rows.length > 0;
}

// A per-user reservation and its matching global reservation must be made in
// one database transaction. The token is deliberately stored only in the
// quota row: it lets the second statement prove that the first statement
// succeeded, so a rejected per-user request cannot accidentally increment the
// global counter. The first statement also checks global capacity, so an
// exhausted provider budget does not consume a user's allowance.
async function reserveUserAndGlobal(day, scope, userId, globalLimit, userLimit) {
  await db.ready;
  const reservationToken = crypto.randomUUID();
  const userScope = scope + ':user';
  const globalScope = scope + ':global';

  const results = await db.transaction([
    {
      sql: `
        INSERT INTO ai_usage (usage_date, scope, user_id, calls, updated_at, reservation_token)
        SELECT ?, ?, ?, 1, unixepoch(), ?
        WHERE NOT EXISTS (
          SELECT 1 FROM ai_usage
          WHERE usage_date = ? AND scope = ? AND user_id = 0
        )
        OR EXISTS (
          SELECT 1 FROM ai_usage
          WHERE usage_date = ? AND scope = ? AND user_id = 0 AND calls < ?
        )
        ON CONFLICT(usage_date, scope, user_id) DO UPDATE SET
          calls = ai_usage.calls + 1,
          updated_at = unixepoch(),
          reservation_token = excluded.reservation_token
        WHERE ai_usage.calls < ?
        RETURNING calls`,
      args: [
        day,
        userScope,
        Number(userId),
        reservationToken,
        day,
        globalScope,
        day,
        globalScope,
        globalLimit,
        userLimit,
      ],
    },
    {
      sql: `
        INSERT INTO ai_usage (usage_date, scope, user_id, calls, updated_at, reservation_token)
        SELECT ?, ?, ?, 1, unixepoch(), ?
        WHERE EXISTS (
          SELECT 1 FROM ai_usage
          WHERE usage_date = ? AND scope = ? AND user_id = ? AND reservation_token = ?
        )
        AND (
          NOT EXISTS (
            SELECT 1 FROM ai_usage
            WHERE usage_date = ? AND scope = ? AND user_id = 0
          )
          OR EXISTS (
            SELECT 1 FROM ai_usage
            WHERE usage_date = ? AND scope = ? AND user_id = 0 AND calls < ?
          )
        )
        ON CONFLICT(usage_date, scope, user_id) DO UPDATE SET
          calls = ai_usage.calls + 1,
          updated_at = unixepoch(),
          reservation_token = excluded.reservation_token
        WHERE ai_usage.calls < ?
          AND EXISTS (
            SELECT 1 FROM ai_usage
            WHERE usage_date = ? AND scope = ? AND user_id = ? AND reservation_token = ?
          )
        RETURNING calls`,
      args: [
        day,
        globalScope,
        0,
        reservationToken,
        day,
        userScope,
        Number(userId),
        reservationToken,
        day,
        globalScope,
        day,
        globalScope,
        globalLimit,
        globalLimit,
        day,
        userScope,
        Number(userId),
        reservationToken,
      ],
    },
  ]);

  // If the user reservation did not happen, the global statement is guarded
  // by the token and therefore did not happen either.
  if (!hasReturnedRow(results[0])) return false;
  return hasReturnedRow(results[1]);
}

/**
 * Reserve one AI call under both a global provider budget and, when supplied,
 * a per-user budget. Both reservations are made in one write transaction, and
 * a request is accepted only when both budgets have capacity.
 */
async function reserveAiCall(scope, userId, { globalLimit, userLimit = null }) {
  const day = utcDay();
  if (userId != null && userLimit != null) {
    return reserveUserAndGlobal(day, scope, Number(userId), globalLimit, userLimit);
  }
  return reserveRow(day, scope + ':global', 0, globalLimit);
}

async function pruneAiUsage(days = 90) {
  const safeDays = Math.max(7, Math.min(365, Number(days) || 90));
  return db.prepare("DELETE FROM ai_usage WHERE usage_date < date('now', ?)").run('-' + safeDays + ' days');
}

module.exports = { reserveAiCall, pruneAiUsage };
