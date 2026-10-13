require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db');
const { dumpTables } = require('../server/services/dbBackup');

test('a backup cannot split an atomic entitlement change across user and payment tables', async () => {
  await db.ready;
  const inserted = await db
    .prepare("INSERT INTO users (email,is_verified,tier,is_premium) VALUES ('snapshot@test.local',1,'premium',1)")
    .run();
  const userId = inserted.lastInsertRowid;
  await db
    .prepare(
      "INSERT INTO whop_payment_entitlements (payment_id,user_id,tier,plan_id,status,created_at) VALUES ('snapshot-fixture-payment',?,'premium','synthetic-plan','active',1)"
    )
    .run(userId);
  // The writer is admitted immediately after the backup's first read.
  // Separate per-table reads deterministically capture premium + elite.
  // One snapshot must instead capture either complete transaction state.
  const [dump] = await Promise.all([
    dumpTables(),
    db.transaction([
      { sql: "UPDATE users SET tier='elite' WHERE id=?", args: [userId] },
      { sql: "UPDATE whop_payment_entitlements SET tier='elite' WHERE user_id=?", args: [userId] },
    ]),
  ]);
  const user = dump.tables.users.find((row) => row.id === userId);
  const payment = dump.tables.whop_payment_entitlements.find((row) => row.user_id === userId);
  assert.equal(user.tier, payment.tier, 'backup must not mix states from either side of an entitlement commit');
  const after = await dumpTables();
  assert.equal(after.tables.users.find((row) => row.id === userId).tier, 'elite');
  assert.equal(after.tables.whop_payment_entitlements.find((row) => row.user_id === userId).tier, 'elite');
});

test('read snapshots are bounded SELECT-only operations and preserve parameterized result shape', async () => {
  await db.ready;
  for (const statements of [
    [],
    Array(65).fill({ sql: 'SELECT 1' }),
    [{ sql: 'DELETE FROM users' }],
    [{ sql: 'SELECT 1; DELETE FROM users' }],
    [{ sql: 'SELECT 1 -- comment' }],
    [{ sql: 42 }],
  ]) {
    await assert.rejects(db.readSnapshot(statements), /bounded list/);
  }
  const before = await db.prepare('SELECT COUNT(*) AS count FROM users').get();
  const rows = await db.readSnapshot([
    { sql: 'SELECT email,tier FROM users WHERE email=?', args: ['snapshot@test.local'] },
  ]);
  assert.deepEqual(rows, [[{ email: 'snapshot@test.local', tier: 'elite' }]]);
  assert.deepEqual(await db.prepare('SELECT COUNT(*) AS count FROM users').get(), before);
  assert.throws(() => db.transaction(() => {}, { readOnly: true }), /statement list/);
});
