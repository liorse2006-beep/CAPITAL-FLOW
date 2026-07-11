const { verifyToken } = require('../services/auth');
const db = require('../db');
const { canScan, quotaFor } = require('../services/scanQuota');

/** Resolve a JWT string → verified DB user, or null on failure */
async function resolveToken(token) {
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    const user = await db
      .prepare(
        `SELECT id, email, is_verified, is_premium, is_blocked, free_scan_count,
                is_pilot, session_version, pilot_terms_accepted_at, tier,
                free_scan_used_capital_flow, free_scan_used_ma_scanner, free_scan_used_sector_moving,
                premium_scan_count, premium_scan_window_start
         FROM users WHERE id = ?`
      )
      .get(payload.id);
    if (!user || user.is_blocked) return null;
    // A token from a stale session_version means this account logged in
    // again elsewhere (another device, or a shared password) since this
    // token was issued — reject it. Every login bumps session_version
    // (see auth.issueToken), so only the most recently issued token for
    // an account is ever valid — one active device at a time, site-wide.
    if ((payload.sv || 0) !== user.session_version) return null;
    // Pilot accounts get full (Elite) access for as long as they're tagged —
    // this is the ONLY place that needs to know that, since every tier
    // check (requirePremium, requireElite, requireScanQuota, the frontend's
    // `isPremium`/`tier`, etc.) reads whatever resolveToken returns. The
    // underlying `tier`/`is_premium` columns are left untouched, so removing
    // the pilot tag cleanly reverts them to their real subscription status.
    if (user.is_pilot) {
      user.tier = 'elite';
      user.is_premium = 1;
    } else {
      user.is_premium = user.tier !== 'free' ? 1 : 0;
    }
    return user;
  } catch {
    return null;
  }
}

/** Require a valid JWT in Authorization: Bearer <token> */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = await resolveToken(header.slice(7));
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = user;
  next();
}

/**
 * Require a valid JWT AND a paid tier (premium or elite) — always checked
 * against the DB, never trusted from the JWT payload alone (prevents
 * stale-token bypass). Gates features available to Premium and Elite alike
 * (charts, premarket scanning) — see requireElite for Elite-only features.
 */
async function requirePremium(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', code: 'NOT_AUTHENTICATED' });
  }
  const user = await resolveToken(header.slice(7));
  if (!user) return res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  if (!user.is_premium) {
    return res.status(403).json({ error: 'Premium subscription required', code: 'NOT_PREMIUM' });
  }
  req.user = user;
  next();
}

/**
 * Require Elite specifically — everything notification-related (push,
 * scheduled digest, watchlist alert thresholds) is Elite-only; Premium gets
 * unlimited-feeling scanning but not notifications.
 */
async function requireElite(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', code: 'NOT_AUTHENTICATED' });
  }
  const user = await resolveToken(header.slice(7));
  if (!user) return res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  if (user.tier !== 'elite') {
    return res.status(403).json({ error: 'Elite subscription required', code: 'NOT_ELITE' });
  }
  req.user = user;
  next();
}

/**
 * Same as requirePremium but reads the token from ?token= query param.
 * Used for SSE (EventSource cannot set Authorization headers).
 */
async function requirePremiumSSE(req, res, next) {
  const user = await resolveToken(req.query.token);
  if (!user) {
    // SSE: respond with a plain-text error event instead of JSON
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    res.write('event: auth-error\ndata: {"code":"NOT_AUTHENTICATED"}\n\n');
    return res.end();
  }
  if (!user.is_premium) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    res.write('event: auth-error\ndata: {"code":"NOT_PREMIUM"}\n\n');
    return res.end();
  }
  req.user = user;
  next();
}

/**
 * Require login AND remaining scan quota for `category` (one of
 * 'capitalFlow' | 'maScanner' | 'sectorMoving'). Free: one lifetime trial
 * per category. Premium: shared pool of 5 scans per rolling 24h. Elite:
 * unlimited. Returns a middleware bound to the given category — mount as
 * requireScanQuota('capitalFlow'), not requireScanQuota directly.
 */
function requireScanQuota(category) {
  return async function (req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Sign in to run a scan', code: 'NOT_AUTHENTICATED' });
    }
    const user = await resolveToken(header.slice(7));
    if (!user) return res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
    if (!canScan(user, category)) {
      return res.status(403).json({
        error: 'Scan limit reached',
        code: 'SCAN_LIMIT',
        ...quotaFor(user),
      });
    }
    req.user = user;
    next();
  };
}

module.exports = { requireAuth, requirePremium, requireElite, requirePremiumSSE, requireScanQuota, resolveToken };
