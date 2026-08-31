// 3-tier scan quota:
//  - free:    unlimited scans across every category for FREE_TRIAL_DAYS from
//             account creation (users.created_at), then blocked entirely
//             until upgrade. Purely time-gated — no per-scan bookkeeping.
//  - premium: a shared pool of PREMIUM_DAILY_LIMIT scans across every
//             category, on a rolling 24h window from premium_scan_window_start.
//  - elite:   unlimited, no bookkeeping needed.
const db = require('../db');

const PREMIUM_DAILY_LIMIT = 5;
const PREMIUM_WINDOW_MS = 24 * 60 * 60 * 1000;
const FREE_TRIAL_DAYS = 7;
const FREE_TRIAL_MS = FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000;

const CATEGORY_COLUMN = {
  capitalFlow: 'free_scan_used_capital_flow',
  maScanner: 'free_scan_used_ma_scanner',
  sectorMoving: 'free_scan_used_sector_moving',
};

/** True if the premium window has never started or is more than 24h old. */
function windowExpired(user) {
  if (!user.premium_scan_window_start) return true;
  return Date.now() - user.premium_scan_window_start * 1000 >= PREMIUM_WINDOW_MS;
}

/**
 * Milliseconds-since-epoch this account was created. SQLite's datetime('now')
 * default stores UTC as "YYYY-MM-DD HH:MM:SS" with no timezone marker —
 * new Date() would otherwise parse that as local time, silently skewing
 * the trial window on any host not running in UTC.
 */
function createdAtMs(user) {
  const raw = user.created_at;
  const iso = typeof raw === 'string' && !raw.includes('T') ? raw.replace(' ', 'T') + 'Z' : raw;
  return new Date(iso).getTime();
}

/** True while this free account is still inside its 7-day trial window. */
function freeTrialActive(user) {
  return Date.now() - createdAtMs(user) < FREE_TRIAL_MS;
}

/**
 * True if this user has access to the full Elite feature set right now —
 * either they're actually Elite (or a pilot/admin resolved to Elite), OR
 * they're a free account still inside the 7-day trial. This is the single
 * source of truth for "can use Capi / push / alerts / scheduled scans",
 * surfaced to the client as user.elite_access on /me and enforced on the
 * server by requireEliteOrTrial.
 */
function eliteAccess(user) {
  return user.tier === 'elite' || (user.tier === 'free' && freeTrialActive(user));
}

/** Can this user run one more scan in `category` right now? Read-only check
 * — used for the frontend's up-front UI state, NOT for enforcement (see
 * reserveScan for the atomic version that actually gates a request). */
function canScan(user, _category) {
  if (user.tier === 'elite') return true;
  if (user.tier === 'premium') {
    if (windowExpired(user)) return true; // window will reset on spend
    return (user.premium_scan_count || 0) < PREMIUM_DAILY_LIMIT;
  }
  return freeTrialActive(user);
}

const PREMIUM_WINDOW_SEC = PREMIUM_WINDOW_MS / 1000;

/**
 * Atomically checks AND spends one scan slot in a single SQL statement, so
 * two concurrent requests from the same Premium user (two tabs, a
 * double-click, a retried request) can never both pass a stale in-memory
 * count — the WHERE guard and the increment happen as one indivisible
 * write, evaluated fresh against the row at write time, not against
 * whatever `user.premium_scan_count` this request happened to read minutes
 * or seconds earlier while a previous scan was still running.
 *
 * reserveScanWithToken returns the admission decision plus a durable
 * reservation id for Premium. The id is what lets a later cache-hit/error
 * refund exactly this request's slot rather than decrementing whichever
 * request happened to arrive next.
 */
async function reserveScanWithToken(user, _category) {
  if (user.tier === 'elite') return { reserved: true, reservation: null };
  if (user.tier === 'free') return { reserved: freeTrialActive(user), reservation: null };

  const nowSec = Math.floor(Date.now() / 1000);
  // The UPDATE and its reservation ledger insert are one write transaction.
  // `changes()` in the immediately following INSERT ... SELECT is the
  // atomic admission decision: if the quota WHERE clause rejected the update,
  // no reservation row is created. A caller can therefore refund by id, not
  // by blindly decrementing whatever count happens to exist later.
  const results = await db.transaction([
    {
      sql: 'DELETE FROM scan_reservations WHERE created_at < ?',
      args: [nowSec - 3 * 24 * 60 * 60],
    },
    {
      sql: `UPDATE users SET
             premium_scan_count = CASE
               WHEN premium_scan_window_start IS NULL OR ? - premium_scan_window_start >= ? THEN 1
               ELSE premium_scan_count + 1
             END,
             premium_scan_window_start = CASE
               WHEN premium_scan_window_start IS NULL OR ? - premium_scan_window_start >= ? THEN ?
               ELSE premium_scan_window_start
             END
           WHERE id = ?
             AND (
               premium_scan_window_start IS NULL
               OR ? - premium_scan_window_start >= ?
               OR premium_scan_count < ?
             )`,
      args: [
        nowSec,
        PREMIUM_WINDOW_SEC,
        nowSec,
        PREMIUM_WINDOW_SEC,
        nowSec,
        user.id,
        nowSec,
        PREMIUM_WINDOW_SEC,
        PREMIUM_DAILY_LIMIT,
      ],
    },
    {
      sql: `INSERT INTO scan_reservations (user_id, window_start, created_at)
            SELECT ?, premium_scan_window_start, ?
              FROM users
             WHERE id = ? AND changes() = 1`,
      args: [user.id, nowSec, user.id],
    },
  ]);

  const reservationInsert = results[2];
  const reservationId = Number(reservationInsert && reservationInsert.lastInsertRowid);
  if (!reservationInsert || Number(reservationInsert.rowsAffected || 0) !== 1 || !Number.isSafeInteger(reservationId)) {
    return { reserved: false, reservation: null };
  }

  // Re-read so the response (quotaFor) reflects exactly what the atomic
  // write actually did, not a client-side guess at which CASE branch fired.
  const fresh = await db
    .prepare('SELECT premium_scan_count, premium_scan_window_start FROM users WHERE id = ?')
    .get(user.id);
  if (fresh) {
    user.premium_scan_count = fresh.premium_scan_count;
    user.premium_scan_window_start = fresh.premium_scan_window_start;
  }
  return {
    reserved: true,
    reservation: {
      id: reservationId,
      windowStart: Number(fresh && fresh.premium_scan_window_start),
    },
  };
}

async function reserveScan(user, category) {
  return (await reserveScanWithToken(user, category)).reserved;
}

/**
 * Compensates a reservation when the scan that consumed it failed to
 * produce a result (upstream error, timeout) — the user shouldn't lose a
 * slot for a scan that never actually ran. Floors at 0 and never touches
 * premium_scan_window_start, so a refund can't resurrect an already-expired
 * window. No-op for Elite/Free, which never reserved anything.
 */
async function refundScan(user, reservation) {
  if (user.tier === 'elite' || user.tier === 'free' || !reservation || !reservation.id) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  const results = await db.transaction([
    {
      sql: `UPDATE scan_reservations
               SET refunded_at = ?
             WHERE id = ? AND user_id = ? AND refunded_at IS NULL`,
      args: [nowSec, reservation.id, user.id],
    },
    {
      // A reservation from an expired window must never decrement the new
      // window's count. The row is still marked refunded so a repeated error
      // path cannot consume the same reservation twice.
      sql: `UPDATE users
               SET premium_scan_count = MAX(0, premium_scan_count - 1)
             WHERE id = ? AND premium_scan_window_start = ? AND changes() = 1`,
      args: [user.id, reservation.windowStart],
    },
  ]);

  if (!results[0] || Number(results[0].rowsAffected || 0) !== 1) return false;
  const fresh = await db
    .prepare('SELECT premium_scan_count, premium_scan_window_start FROM users WHERE id = ?')
    .get(user.id);
  if (fresh) {
    user.premium_scan_count = fresh.premium_scan_count;
    user.premium_scan_window_start = fresh.premium_scan_window_start;
  }
  return true;
}

/** Full quota picture for the frontend, keyed by tier. */
function quotaFor(user) {
  const tier = user.tier || 'free';
  const base = { tier, isPremium: tier !== 'free' };

  if (tier === 'elite') {
    return { ...base, premium: null, free: null };
  }

  if (tier === 'premium') {
    const expired = windowExpired(user);
    const used = expired ? 0 : user.premium_scan_count || 0;
    const resetsAt = expired ? null : new Date(user.premium_scan_window_start * 1000 + PREMIUM_WINDOW_MS).toISOString();
    return {
      ...base,
      premium: { used, left: Math.max(0, PREMIUM_DAILY_LIMIT - used), limit: PREMIUM_DAILY_LIMIT, resetsAt },
      free: null,
    };
  }

  return {
    ...base,
    premium: null,
    free: {
      trialActive: freeTrialActive(user),
      trialEndsAt: new Date(createdAtMs(user) + FREE_TRIAL_MS).toISOString(),
    },
  };
}

module.exports = {
  PREMIUM_DAILY_LIMIT,
  FREE_TRIAL_DAYS,
  CATEGORY_COLUMN,
  canScan,
  reserveScan,
  reserveScanWithToken,
  refundScan,
  quotaFor,
  freeTrialActive,
  eliteAccess,
};
