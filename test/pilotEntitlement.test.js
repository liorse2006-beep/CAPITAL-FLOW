require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db');
const { withEffectivePremium, issueToken } = require('../server/services/auth');
const { resolveToken } = require('../server/middleware/authMiddleware');
test('pilot membership is not a paid entitlement but stored purchases remain intact', async () => {
  await db.ready;
  const result = await db
    .prepare(
      "INSERT INTO users (email, tier, is_pilot, is_verified, created_at) VALUES ('pilot-unpaid@test.local', 'free', 1, 1, '2020-01-01 00:00:00')"
    )
    .run();
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  assert.equal(withEffectivePremium(user).tier, 'free');
  assert.equal((await resolveToken((await issueToken(user)).accessToken)).tier, 'free');
  assert.equal(withEffectivePremium({ ...user, tier: 'premium' }).tier, 'premium');
  assert.equal(withEffectivePremium({ ...user, tier: 'elite' }).tier, 'elite');
});
