// Regression test: pilot accounts must get full premium access for as long
// as they're tagged is_pilot, without ever mutating their real is_premium
// column — so removing the pilot tag cleanly reverts them to their actual
// subscription status.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');

before(async () => { await db.ready; });
const { issueToken, verifyToken, withEffectivePremium } = require('../server/services/auth');
const { resolveToken } = require('../server/middleware/authMiddleware');

async function makeUser(email, { isPilot = false, isPremium = false } = {}) {
  const result = await db
    .prepare('INSERT INTO users (email, is_verified, is_premium, is_pilot, tier) VALUES (?, 1, ?, ?, ?)')
    .run(email, isPremium ? 1 : 0, isPilot ? 1 : 0, isPremium ? 'premium' : 'free');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

test('a free pilot user resolves as premium through the app', async () => {
  const user = await makeUser('free-pilot@test.local', { isPilot: true, isPremium: false });
  const token = await issueToken(user);
  const resolved = await resolveToken(token);

  assert.strictEqual(resolved.is_premium, 1, 'pilot tag must grant premium at resolve time');
  const dbRow = await db.prepare('SELECT is_premium FROM users WHERE id = ?').get(user.id);
  assert.strictEqual(dbRow.is_premium, 0, 'the real is_premium column must stay untouched in the DB');
});

test('removing the pilot tag reverts a non-paying user to free', async () => {
  const user = await makeUser('ex-pilot@test.local', { isPilot: true, isPremium: false });
  await db.prepare('UPDATE users SET is_pilot = 0 WHERE id = ?').run(user.id);
  const reloaded = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

  const token = await issueToken(reloaded);
  const resolved = await resolveToken(token);

  assert.strictEqual(resolved.is_premium, 0, 'without the pilot tag, a non-paying user must be free again');
});

test('a genuinely paying user keeps premium after their pilot tag is removed', async () => {
  const user = await makeUser('paying-ex-pilot@test.local', { isPilot: true, isPremium: true });
  await db.prepare('UPDATE users SET is_pilot = 0 WHERE id = ?').run(user.id);
  const reloaded = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

  const token = await issueToken(reloaded);
  const resolved = await resolveToken(token);

  assert.strictEqual(resolved.is_premium, 1, 'a real paying subscriber must stay premium regardless of pilot status');
});

test('withEffectivePremium never mutates the original object', async () => {
  const user = await makeUser('immutable-check@test.local', { isPilot: true, isPremium: false });
  const derived = withEffectivePremium(user);
  assert.strictEqual(derived.is_premium, 1);
  assert.strictEqual(user.is_premium, 0, 'the source object passed in must not be mutated');
});

test('the JWT issued for a free pilot embeds is_premium=1', async () => {
  const user = await makeUser('token-check@test.local', { isPilot: true, isPremium: false });
  const token = await issueToken(user);
  const payload = verifyToken(token);
  assert.strictEqual(payload.is_premium, 1);
});
