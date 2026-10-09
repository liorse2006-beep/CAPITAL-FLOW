require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const db = require('../server/db');
const { dumpTables, TABLES } = require('../server/services/dbBackup');
const { restoreDump, readDumpFile } = require('../restoreDb');
const { hashPassword, verifyPassword } = require('../server/services/auth');
const notifications = require('../server/services/notifications');
const webPush = require('../server/services/webPush');
const outbox = require('../server/services/notificationOutbox');

test('real gzip backup and restore CLI preserve all allowlisted tables and operational guards in isolation', async (t) => {
  await db.ready;
  assert.equal(process.env.DATABASE_URL, '');
  assert.equal(process.env.TURSO_DB_URL, process.env.CAPITAL_FLOW_TEST_DATABASE_URL);
  const now = Math.floor(Date.now() / 1000);
  const date = new Date().toISOString();
  const password = 'Synthetic-local-recovery-password';
  const tables = {
    users: [
      {
        id: 100,
        email: 'restore-elite@test.local',
        password_hash: await hashPassword(password),
        tier: 'elite',
        is_premium: 1,
        is_verified: 1,
      },
      { id: 101, email: 'restore-free@test.local', tier: 'free', is_verified: 1 },
    ],
    watchlist: [
      { user_id: 100, symbol: 'FIX' },
      { user_id: 101, symbol: 'OTHERFIX' },
    ],
    watchlist_alerts: [{ user_id: 100, symbol: 'FIX', min_ratio: 3 }],
    pilot_allowlist: [{ email: 'restore-pilot@test.local' }],
    push_subscriptions: [
      {
        id: 150,
        user_id: 100,
        endpoint: 'https://push.test.local/synthetic',
        p256dh: 'synthetic-key',
        auth: 'synthetic-auth',
      },
    ],
    feedback: [{ id: 160, user_id: 100, message: 'Synthetic restore check' }],
    coupons: [{ id: 170, code: 'RESTOREFIX', discount_percent: 10 }],
    scheduled_scans: [{ id: 200, user_id: 100, scan_type: 'capitalFlow', scan_time: '21:30', last_run_at: now }],
    capital_flow_radars: [
      { id: 300, user_id: 100, name: 'Synthetic radar', mode: 'all', min_volume_ratio: 3, min_market_cap: 1e9 },
    ],
    radar_states: [{ radar_id: 300, symbol: 'FIX', matches: 1, last_seen_at: date }],
    radar_events: [
      {
        id: 301,
        radar_id: 300,
        user_id: 100,
        symbol: 'FIX',
        scan_time: date,
        payload_json: '{"symbol":"FIX"}',
        notified_at: now,
      },
    ],
    radar_schedule_runs: [
      {
        id: 302,
        radar_id: 300,
        run_date: date.slice(0, 10),
        scheduled_time: '21:30',
        status: 'completed',
        completed_at: now,
        result_count: 1,
      },
    ],
    radar_run_snapshots: [
      {
        scan_id: 'synthetic-restore-run',
        started_at: date,
        completed_at: date,
        data_status: 'complete',
        condition_version: 'radar-v2',
        result_count: 1,
      },
    ],
    chat_messages: [{ id: 350, user_id: 100, role: 'user', content: 'Synthetic retained history' }],
    notifications: [
      {
        id: 400,
        user_id: 100,
        title: 'Market Signal Detected',
        body: 'New market signal detected. Open Capital Flow to view it.',
        scan_type: 'capitalFlow',
        results_json: '[{"symbol":"FIX","price":12}]',
        data_status: 'partial',
        data_as_of: date,
      },
    ],
    notification_outbox: [
      {
        notification_id: 400,
        user_id: 100,
        payload_json: '{"tag":"capital-flow-notification-400"}',
        created_at: now,
        finished_at: now,
        outcome: 'accepted',
      },
    ],
    notification_push_receipts: [
      { notification_id: 400, user_id: 100, endpoint: 'https://push.test.local/synthetic', accepted_at: now },
    ],
    scheduled_scan_runs: [
      {
        run_key: 'synthetic-schedule-completed',
        schedule_id: 200,
        user_id: 100,
        completed_at: now,
        notification_id: 400,
      },
    ],
    scheduled_digest_runs: [
      { run_key: 'synthetic-digest-completed', user_id: 100, completed_at: now, notification_id: 400 },
    ],
    admin_audit_log: [
      { id: 450, actor: 'admin@test.local', action: 'synthetic-restore-verification', target_user_id: 100 },
    ],
    processed_webhook_events: [{ event_id: 'synthetic-whop-completed', processed_at: now, completed_at: now }],
    whop_payment_entitlements: [
      {
        payment_id: 'synthetic-payment',
        user_id: 100,
        tier: 'elite',
        plan_id: 'synthetic-plan',
        status: 'active',
        created_at: now,
      },
    ],
    ai_usage: [{ usage_date: date.slice(0, 10), scope: 'synthetic-provider-budget', user_id: 100, calls: 2 }],
    scan_reservations: [{ id: 500, user_id: 100, window_start: now, created_at: now }],
    site_visits: [{ day: date.slice(0, 10), count: 3 }],
    app_meta: [{ key: 'last_backup_at', value: String(now) }],
  };
  assert.deepEqual(Object.keys(tables), [...TABLES], 'every backup table needs a nonempty synthetic fixture');
  await restoreDump(db, { tables });
  const original = await dumpTables();
  for (const table of TABLES) assert.ok(original.tables[table].length > 0, table);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'capital-flow-backup-roundtrip-'));
  const filename = path.join(directory, 'synthetic-capital-flow-backup.json.gz');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(filename, zlib.gzipSync(JSON.stringify(original)));
  assert.deepEqual(readDumpFile(filename).dump, original);

  // The real command-line dry run must not load or mutate even this isolated DB.
  const dry = spawnSync(process.execPath, [require.resolve('../restoreDb'), filename], {
    env: process.env,
    timeout: 15000,
    encoding: 'utf8',
  });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /DRY RUN/);
  assert.deepEqual((await dumpTables()).tables, original.tables);

  await restoreDump(db, { tables: Object.fromEntries(TABLES.map((table) => [table, []])) });
  assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM users').get()).total, 0);
  const restored = spawnSync(process.execPath, [require.resolve('../restoreDb'), filename, '--confirm'], {
    env: process.env,
    timeout: 15000,
    encoding: 'utf8',
  });
  assert.equal(restored.status, 0, restored.stderr);
  assert.match(restored.stdout, /Restore complete/);
  assert.deepEqual(
    (await dumpTables()).tables,
    original.tables,
    'no account, result, ledger, receipt or budget row may disappear'
  );

  const elite = await db.prepare('SELECT * FROM users WHERE id = 100').get();
  assert.equal(elite.tier, 'elite');
  assert.equal(await verifyPassword(password, elite.password_hash), true);
  assert.equal((await db.prepare('SELECT tier FROM users WHERE id = 101').get()).tier, 'free');
  assert.deepEqual((await notifications.getNotificationDetail(100, 400)).results, [{ symbol: 'FIX', price: 12 }]);
  assert.equal(await notifications.getNotificationDetail(101, 400), undefined);
  const sender = t.mock.method(webPush, 'sendPushToUser', async () => {
    throw new Error('must not resend completed work');
  });
  await outbox.dispatchNotification(400);
  assert.equal(sender.mock.callCount(), 0, 'restored accepted work must not send a duplicate push');
  await assert.rejects(
    db.prepare('INSERT INTO processed_webhook_events (event_id) VALUES (?)').run('synthetic-whop-completed'),
    /unique/i
  );
  await assert.rejects(
    db
      .prepare('INSERT INTO scheduled_scan_runs (run_key, schedule_id, user_id) VALUES (?, ?, ?)')
      .run('synthetic-schedule-completed', 200, 100),
    /unique/i
  );
  const next = await db.prepare('INSERT INTO users (email, is_verified) VALUES (?, 1)').run('restore-next@test.local');
  assert.ok(Number(next.lastInsertRowid) > 101, 'the next local identity must not collide with restored IDs');
});
