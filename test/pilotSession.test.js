// Regression test for the multi-device session cap: an account can have up
// to MAX_ACTIVE_SESSIONS (2) devices logged in at once. A 3rd login evicts
// only the least-recently-used existing session — unlike the old
// session_version scheme this replaced, where any login anywhere
// immediately logged out every other device, site-wide.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');

before(async () => {
  await db.ready;
});
const { issueToken, MAX_ACTIVE_SESSIONS } = require('../server/services/auth');
const { resolveToken } = require('../server/middleware/authMiddleware');

async function makeUser(email, isPilot) {
  const result = await db
    .prepare('INSERT INTO users (email, is_verified, is_premium, is_pilot) VALUES (?, 1, 1, ?)')
    .run(email, isPilot ? 1 : 0);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

test('MAX_ACTIVE_SESSIONS is 2 devices', () => {
  assert.strictEqual(MAX_ACTIVE_SESSIONS, 2);
});

test('two logins on the same account both stay valid at once', async () => {
  const user = await makeUser('pilot-a@test.local', true);
  const { accessToken: tokenOnPhone } = await issueToken(user);
  const reloaded = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const { accessToken: tokenOnLaptop } = await issueToken(reloaded);

  assert.ok(await resolveToken(tokenOnPhone), 'the first device must still be signed in');
  assert.ok(await resolveToken(tokenOnLaptop), 'the second device must also be signed in');
});

test('a 3rd login evicts only the least-recently-used session, not every other device', async () => {
  const user = await makeUser('pilot-b@test.local', true);
  const { accessToken: token1 } = await issueToken(await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
  const { accessToken: token2 } = await issueToken(await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
  const { accessToken: token3 } = await issueToken(await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));

  assert.strictEqual(await resolveToken(token1), null, 'the oldest (least-recently-used) session must be evicted');
  assert.ok(await resolveToken(token2), 'the 2nd device must remain signed in');
  assert.ok(await resolveToken(token3), 'the newest (3rd) login must resolve successfully');
});

test('regular (non-pilot) accounts get the exact same 2-device cap', async () => {
  const user = await makeUser('regular-b@test.local', false);
  const { accessToken: token1 } = await issueToken(await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
  const { accessToken: token2 } = await issueToken(await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
  const { accessToken: token3 } = await issueToken(await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));

  assert.strictEqual(await resolveToken(token1), null, 'the oldest session on a regular account must be evicted too');
  assert.ok(await resolveToken(token2), 'the 2nd login must still resolve');
  assert.ok(await resolveToken(token3), 'the newest login must resolve successfully');
});

test('a single login (no re-login) still resolves normally for a regular account', async () => {
  const user = await makeUser('regular@test.local', false);
  const { accessToken: token } = await issueToken(user);
  assert.ok(await resolveToken(token), 'a lone active session must always resolve');
});
