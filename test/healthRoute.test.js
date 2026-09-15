const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');

require('./helpers/testEnv');
const db = require('../server/db');
const healthRouter = require('../server/routes/health');

async function startHealthApp() {
  const app = express();
  app.use(healthRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('concurrent health checks share one database probe and keep the probe fail-closed', async () => {
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
    const responses = await Promise.all(Array.from({ length: 25 }, () => fetch(`http://127.0.0.1:${port}/health`)));
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
