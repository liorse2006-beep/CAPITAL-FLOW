require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db');
const { restoreDump, validateDump } = require('../restoreDb');

before(async () => {
  await db.ready;
});

test('restore rejects table-name injection before touching the database', () => {
  assert.throws(() => validateDump({ tables: { 'users; DROP TABLE users;--': [] } }), /allowlist/i);
});

test('restore rejects unknown columns before opening a write transaction', async () => {
  const dump = { tables: { users: [{ email: 'restore-column@test.local', definitely_not_a_column: 1 }] } };
  await assert.rejects(restoreDump(db, dump), /unknown column/i);
  const row = await db.prepare('SELECT email FROM users WHERE email = ?').get('restore-column@test.local');
  assert.equal(row, undefined);
});

test('restore is atomic when an insert fails after the delete', async () => {
  const sentinel = 'restore-atomic-sentinel@test.local';
  await db.prepare('INSERT INTO users (email, is_verified) VALUES (?, 1)').run(sentinel);

  const dump = {
    tables: {
      users: [{ email: 'restore-duplicate@test.local' }, { email: 'restore-duplicate@test.local' }],
    },
  };

  await assert.rejects(restoreDump(db, dump), /unique/i);
  const preserved = await db.prepare('SELECT email FROM users WHERE email = ?').get(sentinel);
  assert.equal(preserved.email, sentinel, 'failed restore must roll back the preceding DELETE');
});

test('restore commits a valid table in one transaction', async () => {
  const email = 'restore-success@test.local';
  const result = await restoreDump(db, { tables: { users: [{ email, is_verified: 1 }] } });
  assert.deepEqual(result.tables, ['users']);
  const row = await db.prepare('SELECT email, is_verified FROM users WHERE email = ?').get(email);
  assert.deepEqual(row, { email, is_verified: 1 });
});
