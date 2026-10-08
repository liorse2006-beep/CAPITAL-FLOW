require('./helpers/testEnv');
process.env.ADMIN_EMAIL = 'not-a-recipient';
process.env.RESEND_API_KEY = '';
process.env.STATUS_MONITOR_ENABLED = 'true';
process.env.STATUS_BACKUP_ENABLED = 'true';
process.env.SENTRY_DSN = '';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../server/db');
const runtime = require('../server/services/backgroundRuntime');
const originalFetch = global.fetch;

test('watchdog and scheduled status backup register cancellable timers and drain admitted work', async (context) => {
  await db.ready;
  const prepare = db.prepare.bind(db);
  await prepare("INSERT INTO status_meta (key, value, updated_at) VALUES ('status_backup_last_success_at', ?, ?)").run(
    String(Math.floor(Date.now() / 1000)),
    Math.floor(Date.now() / 1000)
  );
  const timeouts = [];
  const intervals = [];
  const backgroundTimeout = runtime.backgroundTimeout;
  const backgroundInterval = runtime.backgroundInterval;
  context.mock.method(runtime, 'backgroundTimeout', (work, milliseconds) => {
    timeouts.push(milliseconds);
    return backgroundTimeout(work, 1);
  });
  context.mock.method(runtime, 'backgroundInterval', (work, milliseconds) => {
    intervals.push(milliseconds);
    return backgroundInterval(work, milliseconds);
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let watchdogStarted;
  let backupStarted;
  const starts = [
    new Promise((resolve) => {
      watchdogStarted = resolve;
    }),
    new Promise((resolve) => {
      backupStarted = resolve;
    }),
  ];
  db.prepare = (sql) => {
    const statement = prepare(sql);
    if (sql === 'SELECT key, value, updated_at FROM status_meta') {
      return {
        ...statement,
        all: async (...args) => {
          watchdogStarted();
          await gate;
          return statement.all(...args);
        },
      };
    }
    if (sql === "SELECT value FROM status_meta WHERE key = 'status_backup_last_success_at'") {
      return {
        ...statement,
        get: async (...args) => {
          backupStarted();
          await gate;
          return statement.get(...args);
        },
      };
    }
    return statement;
  };
  global.fetch = async () => {
    throw new Error('no network is allowed in lifecycle fixtures');
  };
  const { startStatusWatchdog } = require('../server/services/statusMonitor');
  const { startScheduledStatusBackup } = require('../server/services/statusDbBackup');
  let drain;
  try {
    startStatusWatchdog();
    startScheduledStatusBackup();
    await Promise.all(starts);
    assert.equal(timeouts.length, 2, 'both startup callbacks use the shared runtime');
    assert.equal(intervals.length, 2, 'both periodic callbacks use the shared runtime');
    let drained = false;
    drain = runtime.stopBackgroundTasks().then(() => {
      drained = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(drained, false, 'shutdown must wait for both pending database users');
    release();
    await drain;
    assert.equal(drained, true);
    const lease = await prepare("SELECT owner_id FROM status_worker_leases WHERE lock_key = 'status-watchdog'").get();
    assert.equal(lease, undefined);
  } finally {
    release();
    await drain;
    global.fetch = originalFetch;
    db.prepare = prepare;
    await db.close();
  }
});
