require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const db = require('../server/db');
const { issueToken } = require('../server/services/auth');
const radarRouter = require('../server/routes/radar');

before(async () => {
  await db.ready;
});

async function makeEliteUser(email) {
  const result = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
    .run(email);
  return result.lastInsertRowid;
}

async function authHeaders(userId) {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return {
    Authorization: 'Bearer ' + (await issueToken(user)).accessToken,
    'Content-Type': 'application/json',
  };
}

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', radarRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function radarPayload() {
  return {
    name: 'Route Radar',
    mode: 'all',
    selectedSectors: [],
    minVolumeRatio: 1.5,
    minMarketCap: 500_000_000,
    scheduleTime1: '11:00',
    scheduleTime2: '14:00',
    expiresOn: '2099-12-31',
  };
}

test('Radar API rejects a second saved scan and a second active scan', async () => {
  const userId = await makeEliteUser('radar-single-route@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  const headers = await authHeaders(userId);

  try {
    const first = await fetch(`http://127.0.0.1:${port}/api/radars`, {
      method: 'POST',
      headers,
      body: JSON.stringify(radarPayload()),
    });
    assert.equal(first.status, 201);
    const firstBody = await first.json();

    const second = await fetch(`http://127.0.0.1:${port}/api/radars`, {
      method: 'POST',
      headers,
      body: JSON.stringify(radarPayload()),
    });
    assert.equal(second.status, 409);
    const secondBody = await second.json();
    assert.equal(secondBody.code, 'RADAR_LIMIT_REACHED');
    assert.match(secondBody.error, /only one radar scan can be saved/i);

    const legacyInactive = await db
      .prepare(
        `INSERT INTO capital_flow_radars
          (user_id, name, mode, min_volume_ratio, min_market_cap, schedule_time_1, expires_on, active)
         VALUES (?, 'Legacy paused Radar', 'all', 1.5, 500000000, '11:00', '2099-12-31', 0)`
      )
      .run(userId);

    const reactivate = await fetch(`http://127.0.0.1:${port}/api/radars/${legacyInactive.lastInsertRowid}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ active: true }),
    });
    assert.equal(reactivate.status, 409);
    const reactivateBody = await reactivate.json();
    assert.equal(reactivateBody.code, 'RADAR_ACTIVE_LIMIT_REACHED');
    assert.match(reactivateBody.error, /only one radar scan can be active/i);

    assert.ok(firstBody.radar.id);
  } finally {
    server.close();
  }
});

test("Radar delete cannot remove another user's state or schedule history", async () => {
  const ownerId = await makeEliteUser('radar-delete-owner@test.local');
  const attackerId = await makeEliteUser('radar-delete-attacker@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  const ownerHeaders = await authHeaders(ownerId);
  const attackerHeaders = await authHeaders(attackerId);

  try {
    const create = await fetch(`http://127.0.0.1:${port}/api/radars`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify(radarPayload()),
    });
    assert.equal(create.status, 201);
    const { radar } = await create.json();
    const radarId = Number(radar.id);

    await db
      .prepare(
        `INSERT INTO radar_states
          (radar_id, symbol, matches, entered_at, last_seen_at, missed_checks)
         VALUES (?, 'AAPL', 1, '2026-09-02T10:00:00.000Z', '2026-09-02T10:00:00.000Z', 0)`
      )
      .run(radarId);
    await db
      .prepare(
        `INSERT INTO radar_schedule_runs
          (radar_id, run_date, scheduled_time, status)
         VALUES (?, '2099-12-31', '11:00', 'pending')`
      )
      .run(radarId);

    const forgedDelete = await fetch(`http://127.0.0.1:${port}/api/radars/${radarId}`, {
      method: 'DELETE',
      headers: attackerHeaders,
    });
    assert.equal(forgedDelete.status, 404);

    const parent = await db
      .prepare('SELECT id FROM capital_flow_radars WHERE id = ? AND user_id = ?')
      .get(radarId, ownerId);
    const state = await db
      .prepare('SELECT radar_id FROM radar_states WHERE radar_id = ? AND symbol = ?')
      .get(radarId, 'AAPL');
    const run = await db
      .prepare('SELECT radar_id FROM radar_schedule_runs WHERE radar_id = ? AND run_date = ? AND scheduled_time = ?')
      .get(radarId, '2099-12-31', '11:00');

    assert.equal(Number(parent.id), radarId);
    assert.equal(Number(state.radar_id), radarId);
    assert.equal(Number(run.radar_id), radarId);
  } finally {
    server.close();
  }
});
