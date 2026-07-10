const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { JWT_SECRET } = require('../config');

function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Pilot accounts get full (Elite) access for as long as they're tagged.
 * Call this on any user row read directly from the DB (outside
 * authMiddleware.resolveToken, which already applies it) before that row's
 * tier/is_premium value is shown to the client or embedded in a token.
 */
function withEffectivePremium(user) {
  if (user.is_pilot) return { ...user, tier: 'elite', is_premium: 1 };
  return { ...user, is_premium: user.tier !== 'free' ? 1 : 0 };
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, is_premium: user.is_premium, sv: user.session_version || 0 },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Issue a login token for a user. Every login gets a single-active-session
 * guarantee: logging in bumps session_version in the DB and embeds the new
 * value in the token, so any token issued before this login is immediately
 * rejected (see authMiddleware.resolveToken) — the classic "signed in
 * elsewhere" mechanism that keeps one account to one active device at a
 * time, no matter how the password/credentials were shared.
 */
function issueToken(user) {
  const sv = (user.session_version || 0) + 1;
  db.prepare('UPDATE users SET session_version = ? WHERE id = ?').run(sv, user.id);
  return generateToken(withEffectivePremium({ ...user, session_version: sv }));
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function generateOTP() {
  return String(crypto.randomInt(100000, 1000000)); // cryptographically secure 6-digit code
}

function saveOTP(email, code, type) {
  const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60; // 15 minutes
  db.prepare(
    `
    DELETE FROM otp_codes WHERE email = ? AND type = ?
  `
  ).run(email, type);
  db.prepare(
    `
    INSERT INTO otp_codes (email, code, type, expires_at) VALUES (?, ?, ?, ?)
  `
  ).run(email, code, type, expiresAt);
}

function verifyOTP(email, code, type) {
  const row = db
    .prepare(
      `
    SELECT * FROM otp_codes
    WHERE email = ? AND type = ? AND used = 0
    ORDER BY created_at DESC LIMIT 1
  `
    )
    .get(email, type);

  if (!row) return { valid: false, reason: 'No code found' };
  if (Math.floor(Date.now() / 1000) > row.expires_at) return { valid: false, reason: 'Code expired' };
  if (row.code !== code) return { valid: false, reason: 'Invalid code' };

  db.prepare(`UPDATE otp_codes SET used = 1 WHERE id = ?`).run(row.id);
  return { valid: true };
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  issueToken,
  withEffectivePremium,
  verifyToken,
  generateOTP,
  saveOTP,
  verifyOTP,
};
