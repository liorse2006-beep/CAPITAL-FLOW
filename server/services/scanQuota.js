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

/** Can this user run one more scan in `category` right now? */
function canScan(user, category) {
  if (user.tier === 'elite') return true;
  if (user.tier === 'premium') {
    if (windowExpired(user)) return true; // window will reset on spend
    return (user.premium_scan_count || 0) < PREMIUM_DAILY_LIMIT;
  }
  return freeTrialActive(user);
}

/**
 * Record that this user just spent a scan in `category`. Mutates `user` in
 * place too, matching the existing call-site pattern (routes read
 * req.user.* again right after to build the response). Free tier needs no
 * bookkeeping at all now — it's gated purely by account age.
 */
async function spendScan(user, category) {
  if (user.tier === 'elite' || user.tier === 'free') return;

  const nowSec = Math.floor(Date.now() / 1000);
  if (windowExpired(user)) {
    await db.prepare('UPDATE users SET premium_scan_count = 1, premium_scan_window_start = ? WHERE id = ?').run(
      nowSec,
      user.id
    );
    user.premium_scan_count = 1;
    user.premium_scan_window_start = nowSec;
  } else {
    await db.prepare('UPDATE users SET premium_scan_count = premium_scan_count + 1 WHERE id = ?').run(user.id);
    user.premium_scan_count = (user.premium_scan_count || 0) + 1;
  }
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
  spendScan,
  quotaFor,
  freeTrialActive,
};
