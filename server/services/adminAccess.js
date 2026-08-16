const crypto = require('crypto');
const { ADMIN_TOKEN, ADMIN_EMAIL, STATUS_ADMIN_TOKEN } = require('../config');
const { resolveToken } = require('../middleware/authMiddleware');

function timingSafeStringEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function checkAdminToken(req, res) {
  const statusToken = STATUS_ADMIN_TOKEN || ADMIN_TOKEN;
  if (!statusToken && !ADMIN_EMAIL) {
    res.status(503).json({ error: 'Admin access is not configured.' });
    return false;
  }
  const staticToken = req.headers['x-admin-token'];
  if (staticToken && statusToken && timingSafeStringEqual(staticToken, statusToken)) return 'static-token';
  const authorization = req.headers.authorization || '';
  if (ADMIN_EMAIL && authorization.startsWith('Bearer ')) {
    const user = await resolveToken(authorization.slice(7));
    if (user && String(user.email).toLowerCase() === ADMIN_EMAIL.toLowerCase()) return user.email;
  }
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

module.exports = { checkAdminToken };
