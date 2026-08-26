require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../server/db');
const radar = require('../server/services/radar');
const scanner = require('../server/services/scanner');
const maScanner = require('../server/services/maScanner');
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
    maValue: 185,
    maDistance: 2,
    maPeriod: 20,
    maInterval: '1d',
    maDirection: 'above',
  };
}

test('Radar runs at at most two selected slots, claims each slot once, and does not use the 15-minute loop', async (t) => {
  const user = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
    .run('radar-schedule-limit@test.local');
  const userId = user.lastInsertRowid;
  const current = new Date();
  const minute = israelNowMinutes(current);
  const toFirstSlot = (11 * 60 - minute + 1440) % 1440;
  const firstRunNow = new Date(current.getTime() + toFirstSlot * 60 * 1000);
  const secondRunNow = new Date(firstRunNow.getTime() + 30 * 60 * 1000);
  const firstSlot = 11 * 60;
  const secondSlot = 11 * 60 + 30;
  const radarRow = await radar.createRadar(userId, {
    name: 'Two Windows',
    mode: 'all',
    selectedSectors: [],
    minVolumeRatio: 1.5,
    minMarketCap: 500_000_000,
    scheduleTime1: hhmm(firstSlot),
    scheduleTime2: hhmm(secondSlot),
    expiresOn: futureIsraelDate(),
  });

  const scanMock = t.mock.method(scanner, 'scanTickers', async () => ({ results: [scanRow()], errors: [] }));
  const maMock = t.mock.method(maScanner, 'scanMA', async () => ({
    results: [
      {
        symbol: 'AAPL',
        maValue: 185,
        maDistance: 2,
        maDirection: 'above',
        maPeriod: 20,
        maInterval: '1d',
        dataQuality: 'complete',
      },
    ],
    errors: [],
    checkedSymbols: ['AAPL'],
    dataStatus: 'complete',
    dataAsOf: '2026-08-25T12:00:00.000Z',
  }));
  t.mock.method(webPush, 'sendPushToUser', async () => {});

  await runRadarScheduledScans(firstRunNow, { ignoreMarketHours: true });
  await runRadarScheduledScans(firstRunNow, { ignoreMarketHours: true });
  await runRadarScheduledScans(secondRunNow, { ignoreMarketHours: true });
  await runRadarScheduledScans(secondRunNow, { ignoreMarketHours: true });

  assert.equal(scanMock.mock.callCount(), 2, 'each of the two selected windows runs once');
  assert.equal(maMock.mock.callCount(), 2, 'the combined condition scan runs once per scheduled window');
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
      scheduleTime1: '11:00',
      scheduleTime2: '11:00',
      expiresOn: futureIsraelDate(),
    }),
    /different Radar times/
  );

  await assert.rejects(
    radar.createRadar(user.lastInsertRowid, {
      name: 'Expired',
      mode: 'all',
      scheduleTime1: '11:00',
      expiresOn: '2020-01-01',
    }),
    /cannot be in the past/
  );
});

test('Radar retries one failed slot inside its recovery window without creating a duplicate slot', async (t) => {
  const user = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
    .run('radar-schedule-retry@test.local');
  const current = new Date();
  const minute = israelNowMinutes(current);
  const toFirstSlot = (11 * 60 - minute + 1440) % 1440;
  const firstRunNow = new Date(current.getTime() + toFirstSlot * 60 * 1000);
  // Deliberately retry after the three-minute due window. A transient worker
  // failure still gets one bounded recovery attempt, but the same slot is
  // never inserted twice.
  const retryNow = new Date(firstRunNow.getTime() + 4 * 60 * 1000);
  const radarRow = await radar.createRadar(user.lastInsertRowid, {
    name: 'Retry Window',
    mode: 'all',
    scheduleTime1: '11:00',
    expiresOn: futureIsraelDate(),
  });

  let scanCalls = 0;
  t.mock.method(scanner, 'scanTickers', async () => {
    scanCalls += 1;
    if (scanCalls === 1) {
      const error = new Error('temporary provider failure');
      error.code = 'TEMPORARY_PROVIDER_FAILURE';
      throw error;
    }
    return { results: [scanRow()], errors: [], checkedSymbols: ['AAPL'], dataStatus: 'complete' };
  });
  t.mock.method(maScanner, 'scanMA', async () => ({
    results: [
      {
        symbol: 'AAPL',
        maValue: 185,
        maDistance: 2,
        maDirection: 'above',
        maPeriod: 20,
        maInterval: '1d',
        dataQuality: 'complete',
      },
    ],
    errors: [],
    checkedSymbols: ['AAPL'],
    dataStatus: 'complete',
    dataAsOf: '2026-08-25T12:00:00.000Z',
  }));
  t.mock.method(webPush, 'sendPushToUser', async () => {});

  await runRadarScheduledScans(firstRunNow, { ignoreMarketHours: true });
  await runRadarScheduledScans(retryNow, { ignoreMarketHours: true });

  assert.equal(scanCalls, 2);
  const run = await db
    .prepare('SELECT status, attempts FROM radar_schedule_runs WHERE radar_id = ? AND scheduled_time = ?')
    .get(radarRow.id, '11:00');
  assert.equal(run.status, 'completed');
  assert.equal(Number(run.attempts), 2);
  const events = await db.prepare('SELECT COUNT(*) AS count FROM radar_events WHERE radar_id = ?').get(radarRow.id);
  assert.equal(Number(events.count), 1);
});

test('Radar runs at the selectable 11:00 Jerusalem pre-market slot', async (t) => {
  const user = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
    .run('radar-premarket-slot@test.local');
  const radarRow = await radar.createRadar(user.lastInsertRowid, {
    name: 'Pre-market Window',
    mode: 'all',
    minVolumeRatio: 1.5,
    minMarketCap: 500_000_000,
    scheduleTime1: '11:00',
    expiresOn: '2099-12-31',
  });

  t.mock.method(scanner, 'scanTickers', async () => ({
    results: [scanRow()],
    errors: [],
    checkedSymbols: ['AAPL'],
    dataStatus: 'complete',
    dataAsOf: '2026-07-15T08:00:00.000Z',
  }));
  t.mock.method(maScanner, 'scanMA', async () => ({
    results: [
      {
        symbol: 'AAPL',
        maValue: 185,
        maDistance: 2,
        maDirection: 'above',
        maPeriod: 20,
        maInterval: '1d',
        dataQuality: 'complete',
      },
    ],
    errors: [],
    checkedSymbols: ['AAPL'],
    dataStatus: 'complete',
    dataAsOf: '2026-07-15T08:00:00.000Z',
  }));
  t.mock.method(webPush, 'sendPushToUser', async () => {});

  await runRadarScheduledScans(new Date('2026-07-15T08:00:00.000Z'));

  const run = await db
    .prepare('SELECT status FROM radar_schedule_runs WHERE radar_id = ? AND scheduled_time = ?')
    .get(radarRow.id, '11:00');
  assert.equal(run.status, 'completed');
});

test('Radar runs at the selectable 23:00 Jerusalem close-minute slot', async (t) => {
  const user = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
    .run('radar-close-slot@test.local');
  const radarRow = await radar.createRadar(user.lastInsertRowid, {
    name: 'Close Window',
    mode: 'all',
    minVolumeRatio: 1.5,
    minMarketCap: 500_000_000,
    scheduleTime1: '23:00',
    expiresOn: '2099-12-31',
  });

  t.mock.method(scanner, 'scanTickers', async () => ({
    results: [scanRow()],
    errors: [],
    checkedSymbols: ['AAPL'],
    dataStatus: 'complete',
    dataAsOf: '2026-07-15T20:00:00.000Z',
  }));
  t.mock.method(maScanner, 'scanMA', async () => ({
    results: [
      {
        symbol: 'AAPL',
        maValue: 185,
        maDistance: 2,
        maDirection: 'above',
        maPeriod: 20,
        maInterval: '1d',
        dataQuality: 'complete',
      },
    ],
    errors: [],
    checkedSymbols: ['AAPL'],
    dataStatus: 'complete',
    dataAsOf: '2026-07-15T20:00:00.000Z',
  }));
  t.mock.method(webPush, 'sendPushToUser', async () => {});

  // 20:00 UTC is 16:00 EDT / 23:00 Israel on this date: the exact close
  // minute, which must remain schedulable using the final available quote.
  await runRadarScheduledScans(new Date('2026-07-15T20:00:00.000Z'));

  const run = await db
    .prepare('SELECT status FROM radar_schedule_runs WHERE radar_id = ? AND scheduled_time = ?')
    .get(radarRow.id, '23:00');
  assert.equal(run.status, 'completed');
});
