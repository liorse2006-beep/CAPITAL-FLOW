require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db');

before(async () => {
  await db.ready;
});

test('overlapping asynchronous SQLite transactions keep independent commits', async () => {
  await db.exec('CREATE TABLE test_transaction_rows (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)');
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      db.transaction(async (tx) => {
        await tx.prepare('INSERT INTO test_transaction_rows (id, amount) VALUES (?, ?)').run(index, 1);
        await new Promise((resolve) => setTimeout(resolve, 2));
        await tx.prepare('UPDATE test_transaction_rows SET amount = amount + 1 WHERE id = ?').run(index);
      })
    )
  );
  const rows = await db.prepare('SELECT amount FROM test_transaction_rows ORDER BY id').all();
  assert.equal(rows.length, 12);
  assert.ok(rows.every((row) => row.amount === 2));
});

test('rollback never rolls back a sibling queued commit or leaves partial data', async () => {
  const failed = db.transaction(async (tx) => {
    await tx.prepare('INSERT INTO test_transaction_rows (id, amount) VALUES (?, ?)').run(100, 1);
    await new Promise((resolve) => setTimeout(resolve, 2));
    throw new Error('Synthetic interrupted transaction');
  });
  const succeeded = db.transaction(async (tx) => {
    await tx.prepare('INSERT INTO test_transaction_rows (id, amount) VALUES (?, ?)').run(101, 2);
  });
  const results = await Promise.allSettled([failed, succeeded]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(await db.prepare('SELECT * FROM test_transaction_rows WHERE id = ?').get(100), undefined);
  assert.equal((await db.prepare('SELECT amount FROM test_transaction_rows WHERE id = ?').get(101)).amount, 2);
});

test('ordinary local reads wait for an in-flight transaction and see only committed rows', async () => {
  const writing = db.transaction(async (tx) => {
    await tx.prepare('INSERT INTO test_transaction_rows (id, amount) VALUES (?, ?)').run(102, 1);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await tx.prepare('UPDATE test_transaction_rows SET amount = 2 WHERE id = ?').run(102);
  });
  const reading = db.prepare('SELECT amount FROM test_transaction_rows WHERE id = ?').get(102);
  await writing;
  assert.equal((await reading).amount, 2);
});
