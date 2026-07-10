require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');
const { isAllowed, addToAllowlist, removeFromAllowlist, listAllowlist } = require('../server/services/pilotAllowlist');

test('an email must be explicitly added before it is allowed', () => {
  assert.strictEqual(isAllowed('nobody@test.local'), false);
  addToAllowlist('nobody@test.local');
  assert.strictEqual(isAllowed('nobody@test.local'), true);
});

test('lookups are case-insensitive and trim whitespace', () => {
  addToAllowlist('  Mixed.Case@Test.Local  ');
  assert.strictEqual(isAllowed('mixed.case@test.local'), true);
  assert.strictEqual(isAllowed('MIXED.CASE@TEST.LOCAL'), true);
});

test('removeFromAllowlist revokes future signups without affecting others', () => {
  addToAllowlist('keep@test.local');
  addToAllowlist('drop@test.local');
  removeFromAllowlist('drop@test.local');

  assert.strictEqual(isAllowed('keep@test.local'), true);
  assert.strictEqual(isAllowed('drop@test.local'), false);
});

test('listAllowlist reflects current state', () => {
  addToAllowlist('list-a@test.local');
  addToAllowlist('list-b@test.local');
  const emails = listAllowlist().map((r) => r.email);
  assert.ok(emails.includes('list-a@test.local'));
  assert.ok(emails.includes('list-b@test.local'));
});
