const { verifyToken } = require('../services/auth');
const db = require('../db');
const { reserveScan, quotaFor, freeTrialActive } = require('../services/scanQuota');
const { ADMIN_EMAIL, SESSION_SECRET } = require('../config');
const crypto = require('crypto');
const { publish, subscribe } = require('../services/clusterBus');

// EventSource cannot send Authorization headers. Use short-lived, opaque
// tickets instead of putting a seven-day JWT in the stream URL. Tickets are
// deliberately reusable until expiry so a browser reconnect does not need to
// race a second ticket request, but they contain no user data or privileges
// beyond the user id itself, which is not sensitive.
//
// This used to be an in-memory Map (issue on whichever worker handles
// /stream-ticket, look up on whichever worker the /stream connection that
// redeems it a moment later happens to land on — not necessarily the same
// one). Keeping two workers' copies of that map in sync required relaying
// every issuance over clusterBus, which is asynchronous — a fast machine
// could open the /stream connection before the relay finished, and get
// rejected as unauthenticated. That's a real bug, not a theoretical one: it
// reproduced in test/cluster.integration.test.js.
//
// The actual fix is to not need shared state at all: the ticket is its own
// proof, HMAC-signed with SESSION_SECRET, carrying the userId, the active
// session id and expiry right in it. The session id is checked against
// user_sessions when the stream opens, so logout, password reset, admin
// force-logout, and device eviction revoke an already-issued ticket too.
// Any worker can verify it alone, instantly, with zero coordination — same
// principle as the session-cookie switch in server/index.js (a signed token
// beats a shared store that has to somehow stay in sync).
const SSE_TICKET_TTL_MS = 10 * 60 * 1000;

function signSseTicket(userId, sessionId, expiresAt) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`${userId}.${sessionId}.${expiresAt}`).digest('base64url');
}

function issueSseTicket(userId, sessionId) {
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) throw new Error('Invalid SSE user id');
  if (!Number.isSafeInteger(Number(sessionId)) || Number(sessionId) <= 0) throw new Error('Invalid SSE session id');
  const expiresAt = Date.now() + SSE_TICKET_TTL_MS;
  const sig = signSseTicket(Number(userId), Number(sessionId), expiresAt);
  return `${Number(userId)}.${Number(sessionId)}.${expiresAt}.${sig}`;
}

function resolveSseTicket(ticket) {
  if (!ticket || typeof ticket !== 'string') return null;
  const parts = ticket.split('.');
  if (parts.length !== 4) return null;
  const [userIdStr, sessionIdStr, expiresAtStr, sig] = parts;
  const userId = Number(userIdStr);
  const sessionId = Number(sessionIdStr);
  const expiresAt = Number(expiresAtStr);
  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !Number.isSafeInteger(sessionId) ||
    sessionId <= 0 ||
    !Number.isSafeInteger(expiresAt)
  )
    return null;
  if (expiresAt <= Date.now()) return null;

  const expected = signSseTicket(userId, sessionId, expiresAt);
  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(sig || '');
  if (expectedBuf.length !== sigBuf.length || !crypto.timingSafeEqual(expectedBuf, sigBuf)) return null;

  return { userId, sessionId };
}

// Every call to resolveToken() was two sequential round trips to the remote
// Turso DB (session lookup, then user lookup) — on every single authenticated
// request: every scan, every page load, every poll. Under concurrent load
// that's exactly the "I/O-bound, not CPU-bound" ceiling described in
// PRODUCTION_AUDIT.md — the event loop itself is free while waiting, but the
// request sits open for the full remote round trip before it can respond and
// free up. Caching a successful resolution for a short window turns N
// requests from the same logged-in user within that window into 1 DB round
// trip instead of 2N, without weakening the actual check: a revoked session,
// a block, or a tier change is still re-verified against the DB within
// RESOLVE_CACHE_TTL_MS of the change taking effect — never indefinitely
// stale, just briefly (worst case) trailing reality by a few seconds, which
// is already true of the JWT's own 1h validity window today.
const RESOLVE_CACHE_TTL_MS = 20 * 1000;
const resolveCache = new Map(); // token → { user, cachedAt, sessionKey }
// A session (device) can be revoked at any moment — logout, a password
// reset, an admin "force logout", or simply getting evicted as the
// least-recently-used device past MAX_ACTIVE_SESSIONS. That must take
// effect immediately, not up to RESOLVE_CACHE_TTL_MS later — a TTL alone
// would mean a logged-out device (or a stolen token an admin just tried to
// kill) keeps working for several more seconds. This index lets
// invalidateSession/invalidateUserSessions below find and drop exactly the
// cached token(s) tied to a session the instant it's revoked, in-process —
// the DB write in auth.js already made the revocation real; this just makes
// the in-memory cache stop lying about it.
const sessionIndex = new Map(); // "userId:sid" → Set<token>

function sessionKeyFor(userId, sid) {
  return `${userId}:${sid}`;
}

function cacheResolvedUser(token, user, sessionKey) {
  resolveCache.set(token, { user, cachedAt: Date.now(), sessionKey });
  let tokens = sessionIndex.get(sessionKey);
  if (!tokens) sessionIndex.set(sessionKey, (tokens = new Set()));
  tokens.add(token);
}

function dropCachedToken(token) {
  const entry = resolveCache.get(token);
  resolveCache.delete(token);
  if (!entry) return;
  const tokens = sessionIndex.get(entry.sessionKey);
  if (!tokens) return;
  tokens.delete(token);
  if (tokens.size === 0) sessionIndex.delete(entry.sessionKey);
}

function applyLocalInvalidateSession(userId, sessionId) {
  const key = sessionKeyFor(userId, sessionId);
  const tokens = sessionIndex.get(key);
  if (!tokens) return;
  for (const token of tokens) dropCachedToken(token);
  sessionIndex.delete(key);
}

function applyLocalInvalidateUserSessions(userId) {
  const prefix = `${userId}:`;
  for (const key of sessionIndex.keys()) {
    if (!key.startsWith(prefix)) continue;
    for (const token of sessionIndex.get(key)) dropCachedToken(token);
  }
}

// publish() always delivers to THIS process first (bus.emit, synchronous)
// before forwarding to any other worker — so subscribing to the same
// channel this module publishes on is enough to cover both the local and
// cross-worker case with one code path, not two. In a single process
// (today's actual deployment — see clusterBus.js) that local emit is the
// entire effect: zero behavior change from before this existed. Under
// CLUSTER_WORKERS > 1, resolveCache/sessionIndex are per-process — a
// session revoked (logout, force-logout, password reset, block) on the
// worker that handled the request would otherwise leave every OTHER
// worker's cache still answering for it until RESOLVE_CACHE_TTL_MS passed.
// Publishing the revocation lets every worker drop its own copy the instant
// it happens, the same way SSE broadcast and the scan-scheduler trigger
// already do.
subscribe('auth:session-revoked', ({ userId, sessionId }) => applyLocalInvalidateSession(userId, sessionId));
subscribe('auth:user-sessions-revoked', ({ userId }) => applyLocalInvalidateUserSessions(userId));

/** Called from auth.js the instant one session (device) is revoked. */
function invalidateSession(userId, sessionId) {
  publish('auth:session-revoked', { userId, sessionId });
}

/** Called from auth.js the instant every session for an account is revoked. */
function invalidateUserSessions(userId) {
  publish('auth:user-sessions-revoked', { userId });
}

/** Resolve a JWT string → verified DB user, or null on failure */
async function resolveToken(token) {
  if (!token) return null;

  const cached = resolveCache.get(token);
  if (cached && Date.now() - cached.cachedAt < RESOLVE_CACHE_TTL_MS) {
    return cached.user;
  }

  try {
    const payload = verifyToken(token);
    // The token's session (sid) must still exist — it's deleted the moment
    // that device logs out, or the instant it's evicted for being the
    // least-recently-used device once the account is already at its
    // MAX_ACTIVE_SESSIONS cap (see auth.createSession). A short-lived access
    // token that outlives its session this way is rejected immediately
    // rather than waiting out its own natural 1h expiry.
    const session = await db
      .prepare('SELECT id FROM user_sessions WHERE id = ? AND user_id = ?')
      .get(payload.sid, payload.id);
    if (!session) {
      dropCachedToken(token);
      return null;
    }
    const user = await db
      .prepare(
        `SELECT id, email, is_verified, is_premium, is_blocked, free_scan_count,
                is_pilot, pilot_terms_accepted_at, tier, created_at,
                free_scan_used_capital_flow, free_scan_used_ma_scanner, free_scan_used_sector_moving,
                premium_scan_count, premium_scan_window_start
         FROM users WHERE id = ?`
      )
      .get(payload.id);
    if (!user || user.is_blocked) {
      dropCachedToken(token);
      return null;
    }
    // Pilot accounts (and the configured admin's own account) get full
    // (Elite) access for as long as that's true — this is the ONLY place
    // that needs to know that, since every tier check (requirePremium,
    // requireElite, requireScanQuota, the frontend's `isPremium`/`tier`,
    // etc.) reads whatever resolveToken returns. The underlying
    // `tier`/`is_premium` columns are left untouched, so removing the pilot
    // tag (or changing ADMIN_EMAIL) cleanly reverts them to their real
    // subscription status.
    const isAdminOwner = !!ADMIN_EMAIL && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    if (user.is_pilot || isAdminOwner) {
      user.tier = 'elite';
      user.is_premium = 1;
    } else {
      user.is_premium = user.tier !== 'free' ? 1 : 0;
    }
    cacheResolvedUser(token, user, sessionKeyFor(payload.id, payload.sid));
    return user;
  } catch {
    dropCachedToken(token);
    return null;
  }
}

// Tokens naturally fall out of resolveCache once their 1h JWT expiry passes
// (verifyToken starts throwing, the catch above deletes the entry) — but a
// user who authenticates once and never returns would otherwise leave a
// dangling entry alive for that full hour. A periodic sweep bounds the map's
// size to genuinely active tokens instead of every token ever seen.
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of resolveCache) {
    if (now - entry.cachedAt >= RESOLVE_CACHE_TTL_MS) dropCachedToken(token);
  }
}, 60 * 1000).unref();

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
 * (charts) — see requireElite for Elite-only features.
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
 * Same as requirePremium, but a free-tier account still inside its 7-day
 * trial window is let through too — used for Fundamentals and price charts,
 * which the free trial explicitly includes at full access, not just the
 * scan-count features gated by scanQuota's own free-trial handling.
 */
async function requirePremiumOrTrial(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', code: 'NOT_AUTHENTICATED' });
  }
  const user = await resolveToken(header.slice(7));
  if (!user) return res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  const allowed = user.is_premium || (user.tier === 'free' && freeTrialActive(user));
  if (!allowed) {
    return res.status(403).json({ error: 'Premium subscription required', code: 'NOT_PREMIUM' });
  }
  req.user = user;
  next();
}

/**
 * Require Elite specifically. Use requireEliteOrTrial for features exposed
 * during the seven-day free trial.
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
 * Require Elite, OR a free-tier account still inside its 7-day trial window.
 * This is the shared gate for the complete Elite experience during Trial:
 * Capi, push, alerts, scheduled scans and their supporting endpoints.
 */
async function requireEliteOrTrial(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', code: 'NOT_AUTHENTICATED' });
  }
  const user = await resolveToken(header.slice(7));
  if (!user) return res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  const allowed = user.tier === 'elite' || (user.tier === 'free' && freeTrialActive(user));
  if (!allowed) {
    return res.status(403).json({ error: 'Elite subscription required', code: 'NOT_ELITE' });
  }
  req.user = user;
  next();
}

/**
 * Same as requireEliteOrTrial but reads the signed ticket from ?ticket=.
 * Used for SSE (EventSource cannot set Authorization headers).
 */
async function requirePremiumSSE(req, res, next) {
  const ticket = resolveSseTicket(req.query.ticket);
  const session = ticket
    ? await db.prepare('SELECT id FROM user_sessions WHERE id = ? AND user_id = ?').get(ticket.sessionId, ticket.userId)
    : null;
  const user = session
    ? await db
        .prepare(
          `SELECT id, email, is_verified, is_premium, is_blocked, free_scan_count,
                  is_pilot, pilot_terms_accepted_at, tier, created_at,
                  free_scan_used_capital_flow, free_scan_used_ma_scanner, free_scan_used_sector_moving,
                  premium_scan_count, premium_scan_window_start
           FROM users WHERE id = ?`
        )
        .get(ticket.userId)
    : null;
  function rejectSse(code, status) {
    // EventSource still exposes the HTTP status before it receives the
    // stream body. Set it explicitly; calling flushHeaders() without a
    // status would turn an invalid/revoked ticket into HTTP 200 with an
    // auth-error event, which makes clients and monitors treat the endpoint
    // as healthy and can trigger reconnect loops.
    res.status(status);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    res.write(`event: auth-error\ndata: {"code":"${code}"}\n\n`);
    return res.end();
  }
  if (!user) {
    return rejectSse('NOT_AUTHENTICATED', 401);
  }
  if (user.is_blocked) {
    return rejectSse('NOT_AUTHENTICATED', 401);
  }
  const effectiveUser =
    user.is_pilot || (!!ADMIN_EMAIL && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase())
      ? { ...user, tier: 'elite', is_premium: 1 }
      : { ...user, is_premium: user.tier !== 'free' ? 1 : 0 };
  const trialActive = effectiveUser.tier === 'free' && freeTrialActive(effectiveUser);
  if (effectiveUser.tier !== 'elite' && !trialActive) {
    return rejectSse('NOT_ELITE', 403);
  }
  req.user = effectiveUser;
  next();
}

/**
 * Require login AND remaining scan quota for `category` (one of
 * 'capitalFlow' | 'maScanner' | 'sectorMoving'). Free: unlimited across
 * every category for a 7-day trial from signup, then blocked entirely.
 * Premium: shared pool of 5 scans per rolling 24h. Elite: unlimited.
 * Returns a middleware bound to the given category — mount as
 * requireScanQuota('capitalFlow'), not requireScanQuota directly.
 *
 * reserveScan spends the slot atomically right here, before the (possibly
 * slow) scan even starts — not after it finishes. That closes a real race:
 * checking quota then spending it only on success left a window where N
 * concurrent requests could all read "under the limit" before any of them
 * had finished long enough to increment it, letting a Premium user run far
 * more than 5 scans/24h. The route handler is responsible for calling
 * refundScan(req.user) if the scan itself then fails, so a slot reserved
 * here isn't permanently lost to an upstream error.
 */
function requireScanQuota(category) {
  return async function (req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Sign in to run a scan', code: 'NOT_AUTHENTICATED' });
    }
    const user = await resolveToken(header.slice(7));
    if (!user) return res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
    if (!(await reserveScan(user, category))) {
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

module.exports = {
  requireAuth,
  requirePremium,
  requirePremiumOrTrial,
  requireElite,
  requireEliteOrTrial,
  requirePremiumSSE,
  requireScanQuota,
  resolveToken,
  invalidateSession,
  invalidateUserSessions,
  issueSseTicket,
  resolveSseTicket,
};
