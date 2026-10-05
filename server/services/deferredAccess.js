const db = require('../db');
const { withEffectivePremium } = require('./auth');
const { eliteAccess } = require('./scanQuota');

async function hasDeferredAccess(userId, target = db) {
  const lock = target !== db && db.dialect === 'postgres' ? ' FOR UPDATE' : '';
  const user = await target.prepare('SELECT * FROM users WHERE id = ?' + lock).get(userId);
  return !!user && !user.is_blocked && eliteAccess(withEffectivePremium(user));
}

module.exports = { hasDeferredAccess };
