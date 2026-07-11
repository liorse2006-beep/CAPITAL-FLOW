require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const db = require('../server/db');
const { isAllowed, addToAllowlist, removeFromAllowlist, listAllowlist } = require('../server/services/pilotAllowlist');

before(async () => { await db.ready; });

test('an email must be explicitly added before it is allowed', async () => {
  assert.strictEqual(await isAllowed('nobody@test.local'), false);
  await addToAllowlist('nobody@test.local');
  assert.strictEqual(await isAllowed('nobody@test.local'), true);
});

test('lookups are case-insensitive and trim whitespace', async () => {
  await addToAllowlist('  Mixed.Case@Test.Local  ');
  assert.strictEqual(await isAllowed('mixed.case@test.local'), true);
  assert.strictEqual(await isAllowed('MIXED.CASE@TEST.LOCAL'), true);
});

test('removeFromAllowlist revokes future signups without affecting others', async () => {
  await addToAllowlist('keep@test.local');
  await addToAllowlist('drop@test.local');
  await removeFromAllowlist('drop@test.local');

  assert.strictEqual(await isAllowed('keep@test.local'), true);
  assert.strictEqual(await isAllowed('drop@test.local'), false);
});

test('listAllowlist reflects current state', async () => {
  await addToAllowlist('list-a@test.local');
  await addToAllowlist('list-b@test.local');
  const emails = (await listAllowlist()).map((r) => r.email);
  assert.ok(emails.includes('list-a@test.local'));
  assert.ok(emails.includes('list-b@test.local'));
});
