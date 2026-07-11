// Regression test for the "single active session" mechanism: logging in
// again — on any account, not just pilots — must invalidate the previous
// token, so a shared or leaked password doesn't let two people (or two
// devices) stay logged in simultaneously.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');

before(async () => { await db.ready; });
const { issueToken, verifyToken } = require('../server/services/auth');
const { resolveToken } = require('../server/middleware/authMiddleware');

async function makeUser(email, isPilot) {
  const result = await db
    .prepare('INSERT INTO users (email, is_verified, is_premium, is_pilot) VALUES (?, 1, 1, ?)')
    .run(email, isPilot ? 1 : 0);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

test('login bumps session_version and embeds it in the new token', async () => {
  const user = await makeUser('pilot-a@test.local', true);
  const token1 = await issueToken(user);
  const sv1 = verifyToken(token1).sv;

  const freshUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  assert.strictEqual(sv1, freshUser.session_version, 'token sv must match the freshly bumped DB value');
});

test('a second login invalidates the first token (sv no longer matches DB)', async () => {
  const user = await makeUser('pilot-b@test.local', true);

  const token1 = await issueToken(user);
  const sv1 = verifyToken(token1).sv;

  // Simulate logging in again elsewhere (e.g. a friend using the shared password)
  const reloaded = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const token2 = await issueToken(reloaded);
  const sv2 = verifyToken(token2).sv;

  const finalDbState = await db.prepare('SELECT session_version FROM users WHERE id = ?').get(user.id);

  assert.notStrictEqual(sv1, sv2, 'each login must mint a new session_version');
  assert.strictEqual(sv2, finalDbState.session_version, 'the latest token must match current DB state');
  assert.notStrictEqual(
    sv1,
    finalDbState.session_version,
    'the first token must now be stale — this is what locks out the shared login'
  );
});

test('resolveToken rejects a token after a second login elsewhere (end-to-end)', async () => {
  const user = await makeUser('pilot-c@test.local', true);

  const tokenOnPhone = await issueToken(user);
  const reloaded = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const tokenOnLaptop = await issueToken(reloaded); // e.g. a friend logging in with the shared password

  assert.strictEqual((await resolveToken(tokenOnLaptop)) !== null, true, 'the newest login must resolve successfully');
  assert.strictEqual(await resolveToken(tokenOnPhone), null, 'the earlier session must now be rejected outright');
});

test('regular (non-pilot) accounts get the exact same single-session enforcement', async () => {
  const user = await makeUser('regular-b@test.local', false);
  const token1 = await issueToken(user);
  const reloaded = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const token2 = await issueToken(reloaded);

  assert.strictEqual(await resolveToken(token1), null, 'the earlier session on a regular account must be rejected too');
  assert.ok(await resolveToken(token2), 'the newest login must resolve successfully');
});

test('a single login (no re-login) still resolves normally for a regular account', async () => {
  const user = await makeUser('regular@test.local', false);
  const token = await issueToken(user);
  assert.ok(await resolveToken(token), 'a lone active session must always resolve');
});
