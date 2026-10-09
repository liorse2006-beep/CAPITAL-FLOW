require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db');
const { issueToken } = require('../server/services/auth');
const { resolveToken } = require('../server/middleware/authMiddleware');
before(async () => {
  await db.ready;
});
async function account(email) {
  const inserted = await db
    .prepare("INSERT INTO users (email,is_verified,tier,is_premium) VALUES (?,1,'elite',1)")
    .run(email);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(inserted.lastInsertRowid);
  return { user, token: (await issueToken(user)).accessToken };
}
test('paid authentication checks the current session and user in one database snapshot', async (t) => {
  const { user, token } = await account('auth-roundtrip@test.local');
  const prepare = db.prepare;
  const spy = t.mock.method(db, 'prepare', (...args) => prepare(...args));
  const resolved = await resolveToken(token);
  assert.equal(resolved.id, user.id);
  assert.equal(resolved.tier, 'elite');
  assert.ok(!('password_hash' in resolved));
  assert.equal(spy.mock.calls.filter((call) => /user_sessions|FROM users/i.test(call.arguments[0])).length, 1);
});
test('one-snapshot authentication rechecks paid tier and immediately rejects blocks and revoked sessions', async () => {
  const first = await account('auth-live-tier@test.local');
  assert.equal((await resolveToken(first.token)).tier, 'elite');
  await db.prepare("UPDATE users SET tier = 'premium' WHERE id = ?").run(first.user.id);
  assert.equal((await resolveToken(first.token)).tier, 'premium');
  await db.prepare('UPDATE users SET is_blocked = 1 WHERE id = ?').run(first.user.id);
  assert.equal(await resolveToken(first.token), null);
  const second = await account('auth-live-revocation@test.local');
  assert.ok(await resolveToken(second.token));
  await db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(second.user.id);
  assert.equal(await resolveToken(second.token), null);
});
