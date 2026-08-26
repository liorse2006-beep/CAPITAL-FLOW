require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../server/db');

before(async () => {
  await db.ready;
});

const radarService = require('../server/services/radar');

async function makeEliteUser(email) {
  const result = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
    .run(email);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

function scanRow(overrides = {}) {
  return {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    price: 190,
    change: 1.2,
    volume: 4_000_000,
    avgVolume: 2_000_000,
    volumeRatio: 2,
    rvol: 1.8,
    marketCap: 2_000_000_000_000,
    sector: 'Technology',
    exchange: 'NMS',
    maValue: 185,
    maDistance: 2,
    maPeriod: 20,
    maInterval: '1d',
    maDirection: 'above',
    ...overrides,
  };
}

function futureIsraelDate(days = 7) {
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

function scheduleFields() {
  return { scheduleTime1: '11:00', scheduleTime2: '14:00', expiresOn: futureIsraelDate() };
}

test('Capital Flow Radar persists a new entry once and preserves it during an ongoing match', async () => {
  const user = await makeEliteUser('radar-persistence@test.local');
  const radar = await radarService.createRadar(user.id, {
    name: 'Test Radar',
    mode: 'all',
    selectedSectors: [],
    minVolumeRatio: 1.5,
    minMarketCap: 500_000_000,
    ...scheduleFields(),
  });

  await radarService.processRadarScan([scanRow()], '2026-08-25T12:00:00.000Z', { errors: [], radarIds: [radar.id] });
  await radarService.processRadarScan([scanRow()], '2026-08-25T12:15:00.000Z', { errors: [], radarIds: [radar.id] });

  const bundle = await radarService.getRadarBundle(user.id);
  assert.equal(bundle.length, 1);
  assert.equal(bundle[0].dataStatus, 'ready');
  assert.equal(bundle[0].events.length, 1);
  assert.equal(bundle[0].events[0].symbol, 'AAPL');

  const notificationCount = await db
    .prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND scan_type = 'capitalFlowRadar'")
    .get(user.id);
  assert.equal(Number(notificationCount.count), 1);
});

test('Capital Flow Radar does not invent a result while the scan is unavailable', async () => {
  const user = await makeEliteUser('radar-unavailable@test.local');
  const radar = await radarService.createRadar(user.id, {
    name: 'Unavailable Radar',
    mode: 'all',
    selectedSectors: [],
    minVolumeRatio: 1.5,
    minMarketCap: 500_000_000,
    ...scheduleFields(),
  });

  await radarService.processRadarScan(null, null, { errors: [], radarIds: [radar.id] });
  const bundle = await radarService.getRadarBundle(user.id);
  assert.equal(bundle[0].dataStatus, 'unavailable');
  assert.match(bundle[0].statusMessage, /not available right now/i);
  assert.equal(bundle[0].events.length, 0);
});

test('Capital Flow Radar persists Either mode and emits from one matching layer', async () => {
  const user = await makeEliteUser('radar-either@test.local');
  const radar = await radarService.createRadar(user.id, {
    name: 'Either Layer Radar',
    mode: 'all',
    selectedSectors: [],
    minVolumeRatio: 1.5,
    minMarketCap: 500_000_000,
    conditionMode: 'either',
    ...scheduleFields(),
  });

  assert.equal(radar.condition_mode, 'either');
  await radarService.processRadarScan(
    [scanRow({ maValue: null, maDistance: null, maPeriod: null, maInterval: null })],
    '2026-08-25T12:00:00.000Z',
    { errors: [], radarIds: [radar.id] }
  );

  const bundle = await radarService.getRadarBundle(user.id);
  assert.equal(bundle[0].conditionMode, 'either');
  assert.equal(bundle[0].events.length, 1);
  assert.deepEqual(bundle[0].events[0].data.matchedConditions, ['Capital Flow']);
});
