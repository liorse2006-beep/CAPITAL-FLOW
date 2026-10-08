// Real local HTTP + authentication + isolated SQL + production read routes.
// Provider feeds are explicitly synthetic. This is NOT Render capacity evidence.
require('../test/helpers/testEnv');
const assert = require('node:assert/strict');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const express = require('express');
const db = require('../server/db');
const { issueToken } = require('../server/services/auth');
const { apiLimiter } = require('../server/middleware/rateLimiters');
const { backgroundCache } = require('../server/services/backgroundScan');
const scanner = require('../server/services/scanner');
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(input);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:')
    throw new Error('External traffic prohibited in isolated capacity audit');
  return nativeFetch(input, { ...options, redirect: 'error' });
};
function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)].toFixed(2));
}
async function main() {
  const backlogArgument = process.argv.find((argument) => argument.startsWith('--backlog='));
  const requestedBacklog = backlogArgument ? Number(backlogArgument.slice('--backlog='.length)) : 511;
  assert.ok([511, 2048].includes(requestedBacklog), 'Only the two bounded local backlog comparisons are allowed');
  await db.ready;
  const users = [];
  for (let index = 0; index < 500; index++) {
    const inserted = await db
      .prepare("INSERT INTO users (email,is_verified,tier,is_premium) VALUES (?,1,'elite',1)")
      .run(`local-capacity-${index}@test.local`);
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(inserted.lastInsertRowid);
    await db.prepare('INSERT INTO watchlist (user_id,symbol) VALUES (?,?)').run(user.id, `T${index}`);
    await db
      .prepare('INSERT INTO notifications (user_id,title,body) VALUES (?,?,?)')
      .run(user.id, `Fixture-${index}`, 'Synthetic isolated notification');
    users.push({ id: user.id, token: (await issueToken(user)).accessToken, index });
  }
  const asOf = new Date().toISOString();
  const rows = ['FIXA', 'FIXB', 'FIXC'].map((symbol) => ({
    symbol,
    price: 100,
    volume: 2000,
    avgVolume: 1000,
    volumeRatio: 2,
    marketCap: 1e9,
    quoteDataStatus: 'complete',
    quoteAsOf: asOf,
  }));
  let providerOperations = 0;
  scanner.scanTickers = async () => {
    providerOperations++;
    return {
      results: rows,
      checkedSymbols: rows.map((row) => row.symbol),
      errors: [],
      processed: 3,
      dataStatus: 'complete',
      dataAsOf: asOf,
    };
  };
  backgroundCache.results = rows;
  backgroundCache.scanTime = asOf;
  backgroundCache.dataStatus = 'complete';
  backgroundCache.dataAsOf = asOf;
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use('/api', apiLimiter);
  for (const route of ['account', 'watchlist', 'notifications', 'scan'])
    app.use('/api', require('../server/routes/' + route));
  const server = await new Promise((resolve) => {
    const handle = app.listen({ port: 0, host: '127.0.0.1', backlog: requestedBacklog }, () => resolve(handle));
  });
  const transport = { open: 0, peakOpen: 0, accepted: 0, listenerErrors: 0 };
  server.on('connection', (socket) => {
    transport.open++;
    transport.accepted++;
    transport.peakOpen = Math.max(transport.peakOpen, transport.open);
    socket.once('close', () => transport.open--);
  });
  server.on('error', () => transport.listenerErrors++);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const report = {
    startedAt: new Date().toISOString(),
    scope:
      'Local authenticated production routes; temporary libSQL file; synthetic cached feed; no external service calls',
    productionCapacity: 'UNKNOWN',
    localListenBacklog: requestedBacklog,
    stages: [],
  };
  try {
    for (const concurrency of [1, 5, 25, 50, 100, 200, 500]) {
      const delay = monitorEventLoopDelay({ resolution: 10 });
      delay.enable();
      const cpu = process.cpuUsage();
      const started = performance.now();
      const timings = [];
      const statuses = {};
      const connectionErrors = [];
      let mismatches = 0;
      await Promise.all(
        users.slice(0, concurrency).map(async (user) => {
          for (let cycle = 0; cycle < 3; cycle++) {
            for (const path of ['/api/account/summary', '/api/watchlist', '/api/notifications', '/api/scan']) {
              const began = performance.now();
              try {
                const response = await fetch(origin + path, {
                  headers: {
                    Authorization: 'Bearer ' + user.token,
                    'X-Forwarded-For': `10.1.${Math.floor(user.index / 250)}.${(user.index % 250) + 1}`,
                  },
                  signal: AbortSignal.timeout(10000),
                });
                const data = await response.json();
                timings.push(performance.now() - began);
                statuses[response.status] = (statuses[response.status] || 0) + 1;
                if (response.ok) {
                  if (path.endsWith('/summary') && data.user.id !== user.id) mismatches++;
                  if (path === '/api/watchlist' && (data.length !== 1 || data[0] !== `T${user.index}`)) mismatches++;
                  if (
                    path === '/api/notifications' &&
                    (data.notifications.length !== 1 || data.notifications[0].title !== `Fixture-${user.index}`)
                  )
                    mismatches++;
                  if (
                    path === '/api/scan' &&
                    (data.results?.length !== 3 ||
                      new Set(data.results.map((row) => row.symbol)).size !== 3 ||
                      data.dataStatus !== 'complete')
                  )
                    mismatches++;
                }
              } catch (error) {
                const code = error.cause?.code || error.name || 'network_error';
                statuses[code] = (statuses[code] || 0) + 1;
                if (connectionErrors.length < 50)
                  connectionErrors.push({
                    code,
                    address: error.cause?.address || null,
                    port: error.cause?.port || null,
                    listenerStillOpen: server.listening,
                    acceptedOpenConnections: transport.open,
                  });
                timings.push(performance.now() - began);
              }
            }
          }
        })
      );
      const duration = performance.now() - started;
      const spent = process.cpuUsage(cpu);
      delay.disable();
      const failures = Object.entries(statuses)
        .filter(([status]) => !Number.isFinite(Number(status)) || Number(status) >= 400)
        .reduce((sum, [, count]) => sum + count, 0);
      const stage = {
        virtualUsers: concurrency,
        cyclesPerUser: 3,
        requests: timings.length,
        statuses,
        failures,
        identityOrDataMismatches: mismatches,
        connectionErrors,
        transport: { ...transport },
        durationMs: Number(duration.toFixed(2)),
        requestsPerSecond: Number(((timings.length / duration) * 1000).toFixed(2)),
        latencyMs: {
          p50: percentile(timings, 0.5),
          p95: percentile(timings, 0.95),
          p99: percentile(timings, 0.99),
          max: percentile(timings, 1),
        },
        rssMiB: Number((process.memoryUsage().rss / 1048576).toFixed(2)),
        cpuMs: Number(((spent.user + spent.system) / 1000).toFixed(2)),
        eventLoopP99Ms: Number((delay.percentile(99) / 1e6).toFixed(2)),
      };
      report.stages.push(stage);
      console.log('CAPACITY_STAGE ' + JSON.stringify(stage));
      assert.equal(mismatches, 0, 'Cross-user or scan-result mismatch');
      if (failures > 0 || stage.latencyMs.p95 > 2000) break;
    }
    report.providerOperations = providerOperations;
    report.finishedAt = new Date().toISOString();
    console.log(JSON.stringify(report, null, 2));
    assert.ok(report.stages.every((stage) => stage.failures === 0));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
}
main().catch((error) => {
  console.error('Isolated capacity audit failed:', error.message);
  process.exitCode = 1;
});
