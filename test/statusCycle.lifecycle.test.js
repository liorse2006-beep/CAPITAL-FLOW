require('./helpers/testEnv');
process.env.ADMIN_EMAIL = 'not-a-recipient';
process.env.RESEND_API_KEY = '';
process.env.STATUS_MONITOR_ENABLED = 'false';
process.env.SENTRY_DSN = '';
const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const db = require('../server/db');
const { runStatusCycle } = require('../server/services/statusMonitor');
const { runBackgroundTask, stopBackgroundTasks } = require('../server/services/backgroundRuntime');
const originalFetch = global.fetch;
const prepare = db.prepare.bind(db);

after(async () => {
  global.fetch = originalFetch;
  db.prepare = prepare;
  await db.close();
});

test('a failed cycle-start metadata write also releases the acquired lease', async () => {
  await db.ready;
  global.fetch = async () => {
    throw new Error('no network is allowed in this fixture');
  };
  db.prepare = (sql) => {
    const statement = prepare(sql);
    if (sql.includes('INSERT INTO status_meta')) {
      return {
        ...statement,
        run: async (...args) => {
          if (args[0] === 'cycle_started_at') throw new Error('synthetic cycle-start write failure');
          return statement.run(...args);
        },
      };
    }
    return statement;
  };
  try {
    await assert.rejects(runStatusCycle(), /synthetic cycle-start write failure/);
    const lease = await prepare("SELECT owner_id FROM status_worker_leases WHERE lock_key = 'status-cycle'").get();
    assert.equal(lease, undefined);
  } finally {
    db.prepare = prepare;
    global.fetch = originalFetch;
  }
});

test('a failed component keeps the cycle lease and shutdown waits for its slow sibling', async () => {
  await db.ready;
  await prepare(
    "UPDATE status_components SET enabled = CASE WHEN component_key IN ('website','backend') THEN 1 ELSE 0 END"
  ).run();
  let releaseSlow;
  let observeFailure;
  const slow = new Promise((resolve) => {
    releaseSlow = resolve;
  });
  const failureObserved = new Promise((resolve) => {
    observeFailure = resolve;
  });
  global.fetch = async (input) => {
    if (String(input).endsWith('/health')) return new Response('{"status":"ok"}');
    await slow;
    return new Response('<html>Capital Flow</html>');
  };
  db.prepare = (sql) => {
    const statement = prepare(sql);
    if (sql.includes('INSERT INTO status_checks')) {
      return {
        ...statement,
        run: async (...args) => {
          if (args[1] === 'backend') {
            observeFailure();
            throw new Error('synthetic status storage failure');
          }
          return statement.run(...args);
        },
      };
    }
    return statement;
  };
  let settled = false;
  const cycle = runBackgroundTask(runStatusCycle);
  const expectedFailure = assert.rejects(cycle, /synthetic status storage failure/).then(() => {
    settled = true;
  });
  try {
    await failureObserved;
    const sameCycle = runStatusCycle();
    const sameFailure = assert.rejects(sameCycle, /synthetic status storage failure/);
    let drained = false;
    const drain = stopBackgroundTasks().then(() => {
      drained = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(settled, false, 'the cycle must not finish before its sibling check');
    assert.equal(drained, false, 'the database must not close while a sibling can still write');
    const lease = await prepare("SELECT owner_id FROM status_worker_leases WHERE lock_key = 'status-cycle'").get();
    assert.ok(lease, 'a new worker must not acquire the cycle prematurely');
    releaseSlow();
    await Promise.all([expectedFailure, sameFailure, drain]);
    assert.equal(drained, true);
    const remaining = await prepare("SELECT owner_id FROM status_worker_leases WHERE lock_key = 'status-cycle'").get();
    assert.equal(remaining, undefined);
    const slowCheck = await prepare(
      "SELECT COUNT(*) AS count FROM status_checks WHERE component_key = 'website'"
    ).get();
    assert.equal(Number(slowCheck.count), 1, 'the admitted sibling commits exactly one outcome');
    const meta = await prepare("SELECT value FROM status_meta WHERE key = 'last_cycle_status'").get();
    assert.equal(meta.value, 'error', 'storage failure must not be recorded as a healthy cycle');
  } finally {
    releaseSlow();
    await expectedFailure;
    global.fetch = originalFetch;
    db.prepare = prepare;
  }
});
