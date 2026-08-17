require('./helpers/testEnv');

const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const db = require('../server/db');
const {
  dumpStatusTables,
  encodeStatusBackup,
  restoreStatusTables,
  runStatusBackup,
} = require('../server/services/statusDbBackup');

before(async () => {
  await db.ready;
});

test('status backup contains only allowlisted operational tables and can be encoded', async () => {
  const dump = await dumpStatusTables();
  assert.ok(dump.createdAt);
  assert.ok(Array.isArray(dump.tables.status_components));
  assert.ok(Array.isArray(dump.tables.status_checks));
  assert.equal(Object.prototype.hasOwnProperty.call(dump.tables, 'users'), false);
  const compressed = encodeStatusBackup(dump);
  assert.ok(Buffer.isBuffer(compressed));
  assert.ok(compressed.length > 20);
});

test('status backup restore is dry-run by default and restores a verified snapshot', async () => {
  const marker = 'status-restore-test';
  await db
    .prepare(
      'INSERT INTO status_meta (key, value, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(marker, 'original');
  const dump = await dumpStatusTables();

  const dryRun = await restoreStatusTables(dump);
  assert.equal(dryRun.dryRun, true);
  assert.ok(dryRun.tables.some((table) => table.table === 'status_meta'));

  await db.prepare('UPDATE status_meta SET value = ? WHERE key = ?').run('mutated', marker);
  const restored = await restoreStatusTables(dump, { confirm: true });
  assert.equal(restored.dryRun, false);
  const row = await db.prepare('SELECT value FROM status_meta WHERE key = ?').get(marker);
  assert.equal(row.value, 'original');
});

test('status backup sends one independent database attachment and records success', async () => {
  await db
    .prepare(
      "INSERT INTO status_alert_recipients (email, active, source, updated_at) VALUES (?, 1, 'test', unixepoch()) ON CONFLICT(email) DO UPDATE SET active = 1"
    )
    .run('ops@test.local');
  const deliveries = [];
  const result = await runStatusBackup({
    send: async (payload) => deliveries.push(payload),
  });
  assert.equal(result.status, 'success');
  assert.equal(deliveries.length, 2);
  assert.deepEqual(deliveries.map((delivery) => delivery.recipient).sort(), ['admin@test.local', 'ops@test.local']);
  assert.match(deliveries[0].filename, /capital-flow-status-backup-\d{4}-\d{2}-\d{2}\.json\.gz/);
  assert.ok(Buffer.isBuffer(deliveries[0].content));
  const status = await db.prepare("SELECT value FROM status_meta WHERE key = 'status_backup_status'").get();
  assert.equal(status.value, 'success');
});

test('status backup records partial delivery failure without losing the backup state', async () => {
  const attemptedRecipients = [];
  await assert.rejects(
    () =>
      runStatusBackup({
        send: async ({ recipient }) => {
          attemptedRecipients.push(recipient);
          if (recipient === 'admin@test.local') throw new Error('simulated mailbox outage');
        },
      }),
    /delivery failed/i
  );
  assert.deepEqual(attemptedRecipients.sort(), ['admin@test.local', 'ops@test.local']);
  const status = await db.prepare("SELECT value FROM status_meta WHERE key = 'status_backup_status'").get();
  assert.equal(status.value, 'failed');
});
