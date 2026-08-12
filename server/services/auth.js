const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { JWT_SECRET, ADMIN_EMAIL } = require('../config');

// The users.email column is a plain case-sensitive TEXT UNIQUE — without
// normalizing at every entry point, "User@Gmail.com" and "user@gmail.com"
// look up as two different accounts. That's how a customer signing in with
// the same email but different capitalization on their phone vs. computer
// ends up looking like two separate users, each with its own empty Capi
// chat history, watchlist, and push subscriptions instead of one shared
// account. Every route that reads an email from the request must run it
// through this before using it in a query.
function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Pilot accounts (and the configured admin's own account) get full (Elite)
 * access for as long as that's true. Call this on any user row read directly
 * from the DB (outside authMiddleware.resolveToken, which already applies
 * it) before that row's tier/is_premium value is shown to the client or
 * embedded in a token.
 */
function withEffectivePremium(user) {
  const isAdminOwner = !!ADMIN_EMAIL && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  if (user.is_pilot || isAdminOwner) return { ...user, tier: 'elite', is_premium: 1 };
  return { ...user, is_premium: user.tier !== 'free' ? 1 : 0 };
}

// A JWT this short-lived is only ever dangerous for an hour if it leaks —
// the actual "stay logged in" promise comes from the refresh token below,
// which is httpOnly (invisible to any injected/malicious script) and can be
// revoked instantly server-side (logout, or evicting a device over the
// MAX_ACTIVE_SESSIONS cap) without needing to invalidate every other device.
const ACCESS_TOKEN_TTL = '1h';

// Caps how many devices can be logged into one account at once. Logging in
// on a (MAX_ACTIVE_SESSIONS + 1)th device evicts only the least-recently-used
// existing session — the account's other devices stay signed in, unlike the
// old session_version scheme this replaced (one login anywhere silently
// logged out every other device, site-wide).
const MAX_ACTIVE_SESSIONS = 2;

// Refresh tokens are long, random, opaque strings — never JWTs. Only their
// SHA-256 hash is stored, so a leaked DB dump alone can't be replayed as a
// live session (same principle as never storing plaintext passwords).
function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateToken(user, sessionId) {
  return jwt.sign({ id: user.id, email: user.email, is_premium: user.is_premium, sid: sessionId }, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

/**
 * Create a new session row for a login, evicting the account's oldest
 * session(s) first if it's already at the device cap. Returns the raw
 * refresh token (only ever seen here — the DB keeps just its hash) and the
 * new session's id, to embed in the paired access token.
 */
async function createSession(userId) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare('INSERT INTO user_sessions (user_id, refresh_token_hash, created_at, last_used_at) VALUES (?, ?, ?, ?)')
    .run(userId, hashRefreshToken(refreshToken), now, now);

  // Prune down to the MAX_ACTIVE_SESSIONS most-recently-used rows in one
  // self-contained statement, run AFTER inserting this new session — a
  // separate SELECT-then-DELETE-in-a-loop (the previous approach) has a gap
  // between reading "how many sessions exist" and deleting the excess, so
  // two logins arriving within that gap (two devices signing in within
  // milliseconds of each other) could both read the same under-the-cap
  // count and neither would evict, briefly leaving 3+ active sessions
  // instead of enforcing the 2-device cap. This DELETE has no such gap: it
  // always re-evaluates "which rows are outside the newest N" against the
  // database as it stands the instant it runs, and SQLite/libsql serializes
  // writes to the same table, so concurrent calls still converge on exactly
  // MAX_ACTIVE_SESSIONS surviving rows once both have run.
  await db
    .prepare(
      `DELETE FROM user_sessions
       WHERE user_id = ?
         AND id NOT IN (
           SELECT id FROM user_sessions WHERE user_id = ? ORDER BY last_used_at DESC LIMIT ?
         )`
    )
    .run(userId, userId, MAX_ACTIVE_SESSIONS);

  return { refreshToken, sessionId: result.lastInsertRowid };
}

/**
 * Issue a fresh login for a user: creates a new device session and returns
 * the paired access token (short-lived JWT) + refresh token (long-lived,
 * opaque, meant for an httpOnly cookie).
 */
async function issueToken(user) {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, user.id);
  const { refreshToken, sessionId } = await createSession(user.id);
  const accessToken = generateToken(withEffectivePremium(user), sessionId);
  return { accessToken, refreshToken };
}

/**
 * Exchange a still-valid refresh token for a new access token, without the
 * user re-entering credentials — this is what makes "closed for hours, or
 * even days, without logging out" transparently reopen already signed in.
 * Touches last_used_at so eviction always drops the truly-idlest device.
 */
async function refreshAccessToken(refreshToken) {
  if (!refreshToken) return null;
  const hash = hashRefreshToken(refreshToken);
  const session = await db.prepare('SELECT * FROM user_sessions WHERE refresh_token_hash = ?').get(hash);
  if (!session) return null;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user || user.is_blocked) return null;
  await db
    .prepare('UPDATE user_sessions SET last_used_at = ? WHERE id = ?')
    .run(Math.floor(Date.now() / 1000), session.id);
  const accessToken = generateToken(withEffectivePremium(user), session.id);
  return { accessToken, user };
}

/** Revoke one device's session (logout) — leaves every other device's session untouched. */
async function revokeSession(sessionId, userId) {
  await db.prepare('DELETE FROM user_sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);
  // Lazy require — authMiddleware already requires this module, so a
  // top-level require here would be circular. resolveToken() caches a
  // short-lived successful resolution (see authMiddleware.js); without this
  // the revoked device would keep working until that cache entry ages out.
  require('../middleware/authMiddleware').invalidateSession(userId, sessionId);
}

/**
 * Revoke EVERY session an account has — every device stops working the
 * instant it next calls the API (access tokens are checked against this
 * table on every request, not just at their own 1h expiry) and every
 * refresh cookie in the wild becomes dead weight. This is the actual "kill
 * switch" for a leaked/stolen refresh token: called on password reset (a
 * leaked-credential response should always end every existing session, not
 * just the one being reset from) and from the admin panel's "Force logout".
 */
async function revokeAllSessions(userId) {
  await db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
  require('../middleware/authMiddleware').invalidateUserSessions(userId);
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function generateOTP() {
  return String(crypto.randomInt(100000, 1000000)); // cryptographically secure 6-digit code
}

async function saveOTP(email, code, type) {
  const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60; // 15 minutes
  await db.prepare(`DELETE FROM otp_codes WHERE email = ? AND type = ?`).run(email, type);
  await db
    .prepare(`INSERT INTO otp_codes (email, code, type, expires_at) VALUES (?, ?, ?, ?)`)
    .run(email, code, type, expiresAt);
}

async function verifyOTP(email, code, type) {
  const row = await db
    .prepare(
      `SELECT * FROM otp_codes
       WHERE email = ? AND type = ? AND used = 0
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(email, type);

  if (!row) return { valid: false, reason: 'No code found' };
  if (Math.floor(Date.now() / 1000) > row.expires_at) return { valid: false, reason: 'Code expired' };
  const stored = Buffer.from(String(row.code));
  const supplied = Buffer.from(String(code || ''));
  const codeMatches = stored.length === supplied.length && crypto.timingSafeEqual(stored, supplied);
  if (!codeMatches) return { valid: false, reason: 'Invalid code' };

  await db.prepare(`UPDATE otp_codes SET used = 1 WHERE id = ?`).run(row.id);
  return { valid: true };
}

module.exports = {
  normalizeEmail,
  hashPassword,
  verifyPassword,
  generateToken,
  issueToken,
  createSession,
  refreshAccessToken,
  revokeSession,
  revokeAllSessions,
  withEffectivePremium,
  verifyToken,
  generateOTP,
  saveOTP,
  verifyOTP,
  MAX_ACTIVE_SESSIONS,
};
