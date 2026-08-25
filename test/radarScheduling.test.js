require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../server/db');
const radar = require('../server/services/radar');
const scanner = require('../server/services/scanner');
const webPush = require('../server/services/webPush');
const { israelNowMinutes, runRadarScheduledScans } = require('../server/services/scheduledScanRunner');

before(async () => {
  await db.ready;
});

function futureIsraelDate(days = 3) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = {};
  parts.forEach((part) => {
    map[part.type] = part.value;
  });
  const date = new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day)));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function hhmm(minutes) {
  const normalized = (minutes + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function scanRow() {
  return {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    price: 190,
    change: 1.2,
    volume: 4_000_000,
    avgVolume: 2_000_000,
    volumeRatio: 2,
    marketCap: 2_000_000_000_000,
    sector: 'Technology',
  };
}

test('Radar runs at at most two selected slots, claims each slot once, and does not use the 15-minute loop', async (t) => {
  const user = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
    .run('radar-schedule-limit@test.local');
  const userId = user.lastInsertRowid;
  const now = new Date();
  const minute = israelNowMinutes(now);
  const radarRow = await radar.createRadar(userId, {
    name: 'Two Windows',
    mode: 'all',
    selectedSectors: [],
    minVolumeRatio: 1.5,
    minMarketCap: 500_000_000,
    scheduleTime1: hhmm(minute),
    scheduleTime2: hhmm(minute - 1),
    expiresOn: futureIsraelDate(),
  });

  const scanMock = t.mock.method(scanner, 'scanTickers', async () => ({ results: [scanRow()], errors: [] }));
  t.mock.method(webPush, 'sendPushToUser', async () => {});

  await runRadarScheduledScans(now, { ignoreMarketHours: true });
  await runRadarScheduledScans(now, { ignoreMarketHours: true });

  assert.equal(scanMock.mock.callCount(), 1, 'both selected windows due in the same tick share one scan');
  const runs = await db
    .prepare('SELECT status FROM radar_schedule_runs WHERE radar_id = ? ORDER BY scheduled_time')
    .all(radarRow.id);
  assert.equal(runs.length, 2);
  assert.deepEqual(
    runs.map((run) => run.status),
    ['completed', 'completed']
  );

  const events = await db.prepare('SELECT COUNT(*) AS count FROM radar_events WHERE radar_id = ?').get(radarRow.id);
  assert.equal(Number(events.count), 1, 'an ongoing match is not duplicated for the second daily slot');
});

test('Radar rejects duplicate times and an expired schedule', async () => {
  const user = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
    .run('radar-schedule-validation@test.local');

  await assert.rejects(
    radar.createRadar(user.lastInsertRowid, {
      name: 'Duplicate Times',
      mode: 'all',
      scheduleTime1: '10:00',
      scheduleTime2: '10:00',
      expiresOn: futureIsraelDate(),
    }),
    /different Radar times/
  );

  await assert.rejects(
    radar.createRadar(user.lastInsertRowid, {
      name: 'Expired',
      mode: 'all',
      scheduleTime1: '10:00',
      expiresOn: '2020-01-01',
    }),
    /cannot be in the past/
  );
});
