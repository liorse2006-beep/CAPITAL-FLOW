// Scheduled-scan CRUD routes (server/routes/scheduledScans.js) — specifically
// the scan_date addition: a schedule is either recurring (scan_date null, the
// original behavior) or one-time (a real date, validated against Israel
// local "now" so a customer can't schedule something already in the past).
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');

before(async () => { await db.ready; });

const { issueToken } = require('../server/services/auth');
const scheduledScansRouter = require('../server/routes/scheduledScans');

async function makeEliteUser(email) {
  const result = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
    .run(email);
  return result.lastInsertRowid;
}

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', scheduledScansRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function authHeaders(userId) {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return { Authorization: 'Bearer ' + (await issueToken(user)).accessToken, 'Content-Type': 'application/json' };
}

function israelToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  return `${map.year}-${map.month}-${map.day}`;
}

test('POST /api/scheduled-scans with no scan_date creates a recurring (daily) schedule', async () => {
  const userId = await makeEliteUser('sched-route-recurring@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/scheduled-scans`, {
      method: 'POST',
      headers: await authHeaders(userId),
      body: JSON.stringify({ scan_type: 'capitalFlow', scan_time: '09:30' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.scan_date, null, 'omitted scan_date must store as null (recurring)');
  } finally {
    server.close();
  }
});

test('POST /api/scheduled-scans with a future scan_date creates a one-time schedule', async () => {
  const userId = await makeEliteUser('sched-route-onetime@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/scheduled-scans`, {
      method: 'POST',
      headers: await authHeaders(userId),
      body: JSON.stringify({ scan_type: 'capitalFlow', scan_time: '14:00', scan_date: futureDate }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.scan_date, futureDate);
  } finally {
    server.close();
  }
});

test('POST /api/scheduled-scans rejects a scan_date that has already passed', async () => {
  const userId = await makeEliteUser('sched-route-past@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/scheduled-scans`, {
      method: 'POST',
      headers: await authHeaders(userId),
      body: JSON.stringify({ scan_type: 'capitalFlow', scan_time: '09:00', scan_date: '2020-01-01' }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /already passed/i);
  } finally {
    server.close();
  }
});

test('POST /api/scheduled-scans rejects today at a time that has already passed', async () => {
  const userId = await makeEliteUser('sched-route-todaypast@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/scheduled-scans`, {
      method: 'POST',
      headers: await authHeaders(userId),
      // 00:00 today is only ever "in the future" for a few seconds after
      // midnight Israel time — safe to assert it's rejected as already past.
      body: JSON.stringify({ scan_type: 'capitalFlow', scan_time: '00:00', scan_date: israelToday() }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    server.close();
  }
});

test('POST /api/scheduled-scans rejects a malformed scan_date', async () => {
  const userId = await makeEliteUser('sched-route-badformat@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/scheduled-scans`, {
      method: 'POST',
      headers: await authHeaders(userId),
      body: JSON.stringify({ scan_type: 'capitalFlow', scan_time: '09:00', scan_date: '08/05/2026' }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /YYYY-MM-DD/);
  } finally {
    server.close();
  }
});
