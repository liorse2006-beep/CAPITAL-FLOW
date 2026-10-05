require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db');
before(async () => {
  await db.ready;
  await db.exec('CREATE TABLE transaction_probe (id INTEGER PRIMARY KEY, value TEXT)');
});
function barrier() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
test('an ordinary write waits for an open local transaction instead of aborting it', async () => {
  const entered = barrier();
  const resume = barrier();
  const transactional = db.transaction(async (tx) => {
    await tx.prepare('INSERT INTO transaction_probe (id, value) VALUES (1, ?)').run('committed');
    entered.release();
    await resume.promise;
    return (await tx.prepare('SELECT value FROM transaction_probe WHERE id = 1').get()).value;
  });
  await entered.promise;
  let rootFinished = false;
  const rootWrite = db
    .prepare('INSERT INTO transaction_probe (id, value) VALUES (2, ?)')
    .run('outside')
    .then(() => {
      rootFinished = true;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rootFinished, false);
  resume.release();
  assert.equal(await transactional, 'committed');
  await rootWrite;
  assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM transaction_probe').get()).total, 2);
});
test('a queued ordinary read sees rollback, never the uncommitted value', async () => {
  const entered = barrier();
  const resume = barrier();
  const transactional = db.transaction(async (tx) => {
    await tx.prepare('INSERT INTO transaction_probe (id, value) VALUES (3, ?)').run('secret-before-rollback');
    entered.release();
    await resume.promise;
    throw new Error('Synthetic rollback');
  });
  const rejected = assert.rejects(transactional, /Synthetic rollback/);
  await entered.promise;
  const read = db.prepare('SELECT value FROM transaction_probe WHERE id = 3').get();
  resume.release();
  await rejected;
  assert.equal(await read, undefined);
});
test('an exception during a callback rolls back every earlier write and releases the queue', async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.prepare('INSERT INTO transaction_probe (id, value) VALUES (4, ?)').run('temporary');
      throw new Error('Synthetic failure');
    }),
    /Synthetic failure/
  );
  await db.prepare('INSERT INTO transaction_probe (id, value) VALUES (5, ?)').run('next-operation');
  assert.equal(await db.prepare('SELECT value FROM transaction_probe WHERE id = 4').get(), undefined);
  assert.equal((await db.prepare('SELECT value FROM transaction_probe WHERE id = 5').get()).value, 'next-operation');
});
