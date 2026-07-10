// Regression test: pilot accounts must get full premium access for as long
// as they're tagged is_pilot, without ever mutating their real is_premium
// column — so removing the pilot tag cleanly reverts them to their actual
// subscription status.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');
const { issueToken, verifyToken, withEffectivePremium } = require('../server/services/auth');
const { resolveToken } = require('../server/middleware/authMiddleware');

function makeUser(email, { isPilot = false, isPremium = false } = {}) {
  const id = db
    .prepare('INSERT INTO users (email, is_verified, is_premium, is_pilot, tier) VALUES (?, 1, ?, ?, ?)')
    .run(email, isPremium ? 1 : 0, isPilot ? 1 : 0, isPremium ? 'premium' : 'free').lastInsertRowid;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

test('a free pilot user resolves as premium through the app', () => {
  const user = makeUser('free-pilot@test.local', { isPilot: true, isPremium: false });
  const token = issueToken(user);
  const resolved = resolveToken(token);

  assert.strictEqual(resolved.is_premium, 1, 'pilot tag must grant premium at resolve time');
  const dbRow = db.prepare('SELECT is_premium FROM users WHERE id = ?').get(user.id);
  assert.strictEqual(dbRow.is_premium, 0, 'the real is_premium column must stay untouched in the DB');
});

test('removing the pilot tag reverts a non-paying user to free', () => {
  const user = makeUser('ex-pilot@test.local', { isPilot: true, isPremium: false });
  db.prepare('UPDATE users SET is_pilot = 0 WHERE id = ?').run(user.id);
  const reloaded = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

  const token = issueToken(reloaded);
  const resolved = resolveToken(token);

  assert.strictEqual(resolved.is_premium, 0, 'without the pilot tag, a non-paying user must be free again');
});

test('a genuinely paying user keeps premium after their pilot tag is removed', () => {
  const user = makeUser('paying-ex-pilot@test.local', { isPilot: true, isPremium: true });
  db.prepare('UPDATE users SET is_pilot = 0 WHERE id = ?').run(user.id);
  const reloaded = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

  const token = issueToken(reloaded);
  const resolved = resolveToken(token);

  assert.strictEqual(resolved.is_premium, 1, 'a real paying subscriber must stay premium regardless of pilot status');
});

test('withEffectivePremium never mutates the original object', () => {
  const user = makeUser('immutable-check@test.local', { isPilot: true, isPremium: false });
  const derived = withEffectivePremium(user);
  assert.strictEqual(derived.is_premium, 1);
  assert.strictEqual(user.is_premium, 0, 'the source object passed in must not be mutated');
});

test('the JWT issued for a free pilot embeds is_premium=1', () => {
  const user = makeUser('token-check@test.local', { isPilot: true, isPremium: false });
  const token = issueToken(user);
  const payload = verifyToken(token);
  assert.strictEqual(payload.is_premium, 1);
});
