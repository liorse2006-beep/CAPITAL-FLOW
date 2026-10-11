const crypto = require('crypto');
const { ADMIN_TOKEN, ADMIN_EMAIL, STATUS_ADMIN_TOKEN } = require('../config');
const INDEPENDENT_STATUS_SERVICE = process.env.INDEPENDENT_STATUS_SERVICE === 'true';

function timingSafeStringEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function checkAdminToken(req, res) {
  const statusToken = STATUS_ADMIN_TOKEN || ADMIN_TOKEN;
  if (INDEPENDENT_STATUS_SERVICE ? !statusToken : !ADMIN_EMAIL) {
    res.status(503).json({ error: 'Admin access is not configured.' });
    return false;
  }
  const staticToken = req.headers['x-admin-token'];
  // Operator credentials belong only to the independently deployed status
  // service. They can never bypass the application's live account/session role.
  if (INDEPENDENT_STATUS_SERVICE && staticToken && statusToken && timingSafeStringEqual(staticToken, statusToken))
    return 'static-token';
  const authorization = req.headers.authorization || '';
  if (!INDEPENDENT_STATUS_SERVICE && ADMIN_EMAIL && authorization.startsWith('Bearer ')) {
    // Lazy-load the application's JWT/session stack only on the main app.
    // The independent status host intentionally has no user-auth database.
    const { resolveRequestToken } = require('../middleware/authMiddleware');
    const user = await resolveRequestToken(authorization.slice(7), res, req);
    if (res.headersSent) return false;
    if (user && user.is_verified && String(user.email).toLowerCase() === ADMIN_EMAIL.toLowerCase()) return user.email;
  }
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

function hasStatusOperatorHeader(req) {
  const token = req.headers['x-admin-token'];
  const configured = STATUS_ADMIN_TOKEN || ADMIN_TOKEN;
  return INDEPENDENT_STATUS_SERVICE && !!token && !!configured && timingSafeStringEqual(token, configured);
}

async function checkAdminPageSession(req, res) {
  const token = req.cookies?.vs_refresh;
  if (INDEPENDENT_STATUS_SERVICE || !ADMIN_EMAIL || typeof token !== 'string' || !/^[A-Za-z0-9_-]{64}$/.test(token))
    return false;
  try {
    const db = require('../db');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await db
      .prepare(
        'SELECT u.email, u.is_verified, u.is_blocked FROM users u JOIN user_sessions s ON s.user_id = u.id WHERE s.refresh_token_hash = ?'
      )
      .get(hash);
    return user &&
      user.is_verified &&
      !user.is_blocked &&
      String(user.email).toLowerCase() === ADMIN_EMAIL.toLowerCase()
      ? user.email
      : false;
  } catch {
    res.setHeader('Retry-After', '5');
    res
      .status(503)
      .json({ error: 'Authentication is temporarily unavailable. Please try again.', code: 'AUTH_UNAVAILABLE' });
    return false;
  }
}

module.exports = { checkAdminToken, checkAdminPageSession, hasStatusOperatorHeader, INDEPENDENT_STATUS_SERVICE };
