const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');

require('./helpers/testEnv');
process.env.STATUS_INTERNAL_TOKEN = 'status-probe-test-token-which-is-long-enough';
const db = require('../server/db');
const healthRouter = require('../server/routes/health');

async function startHealthApp() {
  const app = express();
  app.use(healthRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('concurrent protected database checks share one probe and keep readiness fail-closed', async () => {
  await db.ready;
  const originalPrepare = db.prepare;
  let probeCount = 0;

  db.prepare = (sql) => {
    if (sql !== 'SELECT 1') return originalPrepare(sql);
    probeCount += 1;
    return {
      get: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: 1 };
      },
    };
  };

  const server = await startHealthApp();
  const port = server.address().port;

  try {
    const responses = await Promise.all(
      Array.from({ length: 25 }, () =>
        fetch(`http://127.0.0.1:${port}/status/internal/database`, {
          headers: { 'x-status-check-token': process.env.STATUS_INTERNAL_TOKEN },
        })
      )
    );
    assert.deepEqual(
      responses.map((response) => response.status),
      Array.from({ length: 25 }, () => 200)
    );
    assert.equal(probeCount, 1);
  } finally {
    db.prepare = originalPrepare;
    server.close();
  }
});

test('public health and process liveness stay healthy while database initialization is unavailable', async () => {
  const originalReady = db.ready;
  const originalPrepare = db.prepare;
  db.ready = new Promise(() => {});
  db.prepare = () => {
    throw new Error('Liveness must not query the database');
  };

  const server = await startHealthApp();
  try {
    for (const path of ['/health', '/health/live']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.status, 'ok');
      assert.equal(typeof body.releaseCommit, 'string');
    }
  } finally {
    db.ready = originalReady;
    db.prepare = originalPrepare;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('protected database readiness fails closed within its probe timeout', async () => {
  // Let the previous test's deliberately short successful-probe cache expire.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const originalReady = db.ready;
  db.ready = new Promise(() => {});
  const server = await startHealthApp();
  const startedAt = Date.now();

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/status/internal/database`, {
      headers: { 'x-status-check-token': process.env.STATUS_INTERNAL_TOKEN },
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).status, 'error');
    assert.ok(Date.now() - startedAt < 4500, 'probe should complete before Render’s five-second limit');
  } finally {
    db.ready = originalReady;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('database readiness details stay hidden from callers without the status token', async () => {
  const server = await startHealthApp();
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/status/internal/database`);
    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
