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
  return makeTierUser(email, 'elite');
}

async function makeTierUser(email, tier, { createdAt } = {}) {
  const result = await db
    .prepare('INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, ?, ?)')
    .run(email, tier, tier === 'free' ? 0 : 1);
  if (createdAt)
    await db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(createdAt, result.lastInsertRowid);
  return result.lastInsertRowid;
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
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

test('Radar API applies the Elite-or-trial gate instead of trusting the client tier', async () => {
  const premiumId = await makeTierUser('radar-gate-premium@test.local', 'premium');
  const expiredTrialId = await makeTierUser('radar-gate-expired@test.local', 'free', {
    createdAt: isoDaysAgo(8),
  });
  const activeTrialId = await makeTierUser('radar-gate-active-trial@test.local', 'free');
  const server = await startTestApp();
  const port = server.address().port;

  try {
    const premium = await fetch(`http://127.0.0.1:${port}/api/radars`, {
      headers: await authHeaders(premiumId),
    });
    assert.equal(premium.status, 403);
    assert.equal((await premium.json()).code, 'NOT_ELITE');

    const expiredTrial = await fetch(`http://127.0.0.1:${port}/api/radars`, {
      headers: await authHeaders(expiredTrialId),
    });
    assert.equal(expiredTrial.status, 403);
    assert.equal((await expiredTrial.json()).code, 'NOT_ELITE');

    const activeTrial = await fetch(`http://127.0.0.1:${port}/api/radars`, {
      headers: await authHeaders(activeTrialId),
    });
    assert.equal(activeTrial.status, 200);
    assert.deepEqual((await activeTrial.json()).radars, []);
  } finally {
    server.close();
  }
});

test('Radar API keeps the one-active invariant under concurrent HTTP creation', async () => {
  const userId = await makeEliteUser('radar-route-race@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  const headers = await authHeaders(userId);

  try {
    const responses = await Promise.all(
      [1, 2].map(() =>
        fetch(`http://127.0.0.1:${port}/api/radars`, {
          method: 'POST',
          headers,
          body: JSON.stringify(radarPayload()),
        })
      )
    );
    const statuses = responses.map((response) => response.status).sort((a, b) => a - b);
    assert.deepEqual(statuses, [201, 409]);

    const count = await db
      .prepare(
        'SELECT COUNT(*) AS count, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active FROM capital_flow_radars WHERE user_id = ?'
      )
      .get(userId);
    assert.equal(Number(count.count), 1);
    assert.equal(Number(count.active), 1);
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
