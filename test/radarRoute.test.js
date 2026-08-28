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
