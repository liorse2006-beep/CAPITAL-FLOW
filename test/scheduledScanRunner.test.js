// Scheduled-scan reliability (server/services/scheduledScanRunner.js):
// the fire window and the one-scan-per-type sharing.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');

before(async () => {
  await db.ready;
});

const { isDue, FIRE_WINDOW_MIN, runScheduledScans } = require('../server/services/scheduledScanRunner');
const scanner = require('../server/services/scanner');
const webPush = require('../server/services/webPush');

// ── isDue window math ───────────────────────────────────────────────────────

test('isDue accepts the exact minute and up to FIRE_WINDOW_MIN minutes late', () => {
  const t = 10 * 60 + 30; // 10:30
  assert.strictEqual(isDue('10:30', t), true, 'exact minute');
  assert.strictEqual(isDue('10:30', t + FIRE_WINDOW_MIN), true, 'late but inside the window');
  assert.strictEqual(isDue('10:30', t + FIRE_WINDOW_MIN + 1), false, 'past the window');
  assert.strictEqual(isDue('10:30', t - 1), false, 'never fires early');
});

test('isDue handles the midnight wrap', () => {
  assert.strictEqual(isDue('23:59', 0), true, '00:00 is one minute after 23:59');
  assert.strictEqual(isDue('00:01', 23 * 60 + 59), false, '23:59 is before 00:01, not after');
});

test('isDue rejects malformed times', () => {
  assert.strictEqual(isDue('', 600), false);
  assert.strictEqual(isDue(null, 600), false);
  assert.strictEqual(isDue('banana', 600), false);
});

// ── one shared scan per type ────────────────────────────────────────────────

test('two users scheduled for the same window share ONE scan and both get pushed', async (t) => {
  const u1 = await db.prepare('INSERT INTO users (email, is_verified) VALUES (?, 1)').run('sched-a@test.local');
  const u2 = await db.prepare('INSERT INTO users (email, is_verified) VALUES (?, 1)').run('sched-b@test.local');

  // Schedule both for "now" in Israel local time so isDue passes for real.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const map = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });
  const hhmm = map.hour + ':' + map.minute;

  await db
    .prepare("INSERT INTO scheduled_scans (user_id, scan_type, scan_time, active) VALUES (?, 'capitalFlow', ?, 1)")
    .run(u1.lastInsertRowid, hhmm);
  await db
    .prepare("INSERT INTO scheduled_scans (user_id, scan_type, scan_time, active) VALUES (?, 'capitalFlow', ?, 1)")
    .run(u2.lastInsertRowid, hhmm);

  const scanMock = t.mock.method(scanner, 'scanTickers', async () => ({
    results: [{ symbol: 'AAPL', volumeRatio: 3.2 }],
    errors: [],
    processed: 500,
  }));
  const pushMock = t.mock.method(webPush, 'sendPushToUser', async () => {});

  await runScheduledScans();

  assert.strictEqual(scanMock.mock.callCount(), 1, 'both schedules must share one market scan');
  assert.strictEqual(pushMock.mock.callCount(), 2, 'each subscriber still gets their own push');

  const pushedTo = pushMock.mock.calls.map((c) => c.arguments[0]).sort();
  assert.deepStrictEqual(pushedTo, [u1.lastInsertRowid, u2.lastInsertRowid].sort());

  const rows = await db
    .prepare('SELECT last_run_at, last_result_count FROM scheduled_scans WHERE user_id IN (?, ?)')
    .all(u1.lastInsertRowid, u2.lastInsertRowid);
  rows.forEach((r) => {
    assert.ok(r.last_run_at > 0, 'last_run_at must be stamped');
    assert.strictEqual(r.last_result_count, 1);
  });
});

test('a scheduled scan persists an in-app notification, so it is visible even with no push subscription', async (t) => {
  const u = await db.prepare('INSERT INTO users (email, is_verified) VALUES (?, 1)').run('sched-notif@test.local');
  const userId = u.lastInsertRowid;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const map = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });
  const hhmm = map.hour + ':' + map.minute;

  await db
    .prepare("INSERT INTO scheduled_scans (user_id, scan_type, scan_time, active) VALUES (?, 'capitalFlow', ?, 1)")
    .run(userId, hhmm);

  t.mock.method(scanner, 'scanTickers', async () => ({
    results: [{ symbol: 'NVDA', volumeRatio: 4.1 }],
    errors: [],
    processed: 500,
  }));
  // No push subscription exists for this user — the ONLY thing they should
  // still see is the persisted in-app notification.
  const pushMock = t.mock.method(webPush, 'sendPushToUser', async () => {});

  await runScheduledScans();

  const notif = await db
    .prepare('SELECT id, symbol, title, body, scan_type, results_json FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .get(userId);
  assert.ok(notif, 'a scheduled scan must leave a notification in the in-app bell');
  assert.strictEqual(notif.symbol, 'NVDA');
  assert.match(notif.title, /NVDA/);

  // The notification must carry the scan's own results and type, so tapping
  // it can show exactly what that run found — not just "something happened".
  assert.strictEqual(notif.scan_type, 'capitalFlow');
  const storedResults = JSON.parse(notif.results_json);
  assert.deepStrictEqual(storedResults, [{ symbol: 'NVDA', volumeRatio: 4.1 }]);

  // The push payload's deep link must point at this exact notification.
  assert.strictEqual(pushMock.mock.callCount(), 1);
  const pushPayload = pushMock.mock.calls[0].arguments[1];
  assert.strictEqual(pushPayload.data.url, '/scanner?notif=' + notif.id);
});
