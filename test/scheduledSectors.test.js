require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const db = require('../server/db');
const sectorFlow = require('../server/services/sectorFlow');
const scanner = require('../server/services/scanner');
const webPush = require('../server/services/webPush');
const { runScheduledScans } = require('../server/services/scheduledScanRunner');
const { issueToken } = require('../server/services/auth');
const notificationsRouter = require('../server/routes/notifications');

before(async () => {
  await db.ready;
});

async function scheduleUser(email) {
  const inserted = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
    .run(email);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(inserted.lastInsertRowid);
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  await db
    .prepare("INSERT INTO scheduled_scans (user_id, scan_type, scan_time, active) VALUES (?, 'sectorMoving', ?, 1)")
    .run(user.id, hhmm);
  return user;
}

const sector = {
  symbol: 'XLK',
  price: 42,
  change: 1.25,
  volume: 1800000,
  avgVolume: 1000000,
  volRatio: 1.8,
  flow: 'inflow',
  dataStatus: 'partial',
  dataAsOf: '2026-10-16T20:00:00.000Z',
  lastSession: true,
};
const missing = {
  symbol: 'XLE',
  price: null,
  volRatio: null,
  flow: 'unavailable',
  dataStatus: 'unavailable',
  dataAsOf: null,
};

test('scheduled Hot Sectors shares the sector engine, saves the exact run and deep-links to its owner-scoped snapshot', async (t) => {
  const first = await scheduleUser('sector-scheduled-first@test.local');
  const second = await scheduleUser('sector-scheduled-second@test.local');
  let payload = { results: [sector, missing], dataStatus: 'partial', dataAsOf: sector.dataAsOf };
  const sectorMock = t.mock.method(sectorFlow, 'getSectorFlow', async () => ({ payload, shared: false }));
  const stockMock = t.mock.method(scanner, 'scanTickers', async () => {
    throw new Error('Hot Sectors must not scan individual stocks');
  });
  const pushMock = t.mock.method(webPush, 'sendPushToUser', async () => ({
    configured: false,
    devices: 0,
    delivered: 0,
  }));
  await runScheduledScans();
  assert.equal(sectorMock.mock.callCount(), 1, 'one sector snapshot is shared by schedules in the same window');
  assert.equal(stockMock.mock.callCount(), 0);
  assert.equal(pushMock.mock.callCount(), 2);
  const stored = await db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .get(first.id);
  assert.equal(stored.scan_type, 'sectorMoving');
  assert.equal(stored.body, 'New market signal detected. Open Capital Flow to view it.');
  assert.equal(stored.data_status, 'partial');
  assert.equal(stored.data_as_of, sector.dataAsOf);
  assert.deepEqual(JSON.parse(stored.results_json), [sector]);
  const push = pushMock.mock.calls.find((call) => call.arguments[0] === first.id).arguments[1];
  assert.equal(push.data.url, '/flow?notif=srv-' + stored.id);
  assert.equal(push.data.resultCount, 1);

  // A later run changes market values. Opening the earlier alert must not
  // run providers again or replace the original saved sector observations.
  payload = { results: [{ ...sector, price: 51, flow: 'outflow' }], dataStatus: 'partial', dataAsOf: sector.dataAsOf };
  const later = await scheduleUser('sector-scheduled-later@test.local');
  await runScheduledScans();
  const laterNotification = await db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .get(later.id);
  assert.equal(JSON.parse(laterNotification.results_json)[0].price, 51);
  const callsBeforeOpening = sectorMock.mock.callCount();
  const app = express();
  app.use('/api', notificationsRouter);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/notifications/${stored.id}`, {
      headers: { Authorization: 'Bearer ' + (await issueToken(first)).accessToken },
    });
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.deepEqual(detail.results, [sector]);
    assert.equal(detail.dataAsOf, sector.dataAsOf);
    assert.equal(detail.scanType, 'sectorMoving');
    const otherUser = await fetch(`http://127.0.0.1:${server.address().port}/api/notifications/${stored.id}`, {
      headers: { Authorization: 'Bearer ' + (await issueToken(second)).accessToken },
    });
    assert.equal(otherUser.status, 404);
    assert.equal(sectorMock.mock.callCount(), callsBeforeOpening, 'opening a saved alert never calls market providers');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('unavailable sector placeholders do not create a false signal and still produce an empty-run notification', async (t) => {
  const user = await scheduleUser('sector-scheduled-empty@test.local');
  t.mock.method(sectorFlow, 'getSectorFlow', async () => ({
    payload: { results: [missing], dataStatus: 'unavailable', dataAsOf: null },
    shared: false,
  }));
  t.mock.method(webPush, 'sendPushToUser', async () => ({ configured: false, devices: 0, delivered: 0 }));
  await runScheduledScans();
  const stored = await db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .get(user.id);
  assert.equal(stored.body, "We couldn't verify a market signal this time.");
  assert.equal(stored.results_json, null);
  assert.equal(stored.data_status, 'unavailable');
  const schedule = await db.prepare('SELECT last_result_count FROM scheduled_scans WHERE user_id = ?').get(user.id);
  assert.equal(schedule.last_result_count, 0);
});
