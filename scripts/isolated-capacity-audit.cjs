// Real local HTTP + authentication + isolated SQL + production read routes.
// Provider feeds are explicitly synthetic. This is NOT Render capacity evidence.
require('../test/helpers/testEnv');
const assert = require('node:assert/strict');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { readFileSync } = require('node:fs');
const { CAPACITY_STAGES, MAX_P95_MS, assertSuccessfulAudit } = require('./capacity-audit-contract.cjs');
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
function cgroupValue(path) {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return 'unavailable';
  }
}
async function main() {
  const serveFixture = process.argv.includes('--serve-fixture');
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
  const runtime = {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    memoryMax: cgroupValue('/sys/fs/cgroup/memory.max'),
    cpuMax: cgroupValue('/sys/fs/cgroup/cpu.max'),
  };
  const fixtureDelay = serveFixture ? monitorEventLoopDelay({ resolution: 10 }) : null;
  const requestMetrics = {};
  const activeRequests = new Set();
  app.use('/api', (req, res, next) => {
    const route = req.path;
    const metrics = (requestMetrics[route] ||= { received: 0, finished: 0, closedBeforeFinish: 0, maxMs: 0 });
    const began = performance.now();
    const marker = {};
    metrics.received++;
    activeRequests.add(marker);
    let settled = false;
    const settle = (finished) => {
      if (settled) return;
      settled = true;
      activeRequests.delete(marker);
      metrics[finished ? 'finished' : 'closedBeforeFinish']++;
      metrics.maxMs = Math.max(metrics.maxMs, Number((performance.now() - began).toFixed(2)));
    };
    res.once('finish', () => settle(true));
    res.once('close', () => settle(res.writableFinished));
    next();
  });
  fixtureDelay?.enable();
  if (serveFixture) {
    // This fixture exists only in the offline test script, never in server/index.js.
    // Its synthetic tokens stay inside a network namespace with no external interface.
    app.get('/__isolated-capacity-fixture/users', (_req, res) => {
      res.json({ fixture: 'synthetic-local-only-v1', productionCapacity: 'UNKNOWN', users });
    });
    app.get('/__isolated-capacity-fixture/stats', (req, res) => {
      if (req.query.reset === '1') {
        assert.equal(activeRequests.size, 0, 'Cannot reset metrics during an active request');
        for (const key of Object.keys(requestMetrics)) delete requestMetrics[key];
      }
      const spent = process.cpuUsage();
      res.json({
        fixture: 'synthetic-local-only-v1',
        runtime,
        providerOperations,
        rssMiB: Number((process.memoryUsage().rss / 1048576).toFixed(2)),
        cpuMs: Number(((spent.user + spent.system) / 1000).toFixed(2)),
        eventLoopP99Ms: Number((fixtureDelay.percentile(99) / 1e6).toFixed(2)),
        transport: { ...transport },
        requests: { active: activeRequests.size, routes: requestMetrics },
      });
      if (req.query.reset === '1') fixtureDelay.reset();
    });
  }
  app.use('/api', apiLimiter);
  for (const route of ['account', 'watchlist', 'notifications', 'scan'])
    app.use('/api', require('../server/routes/' + route));
  const server = await new Promise((resolve, reject) => {
    const handle = app.listen({ port: serveFixture ? 3001 : 0, host: '127.0.0.1', backlog: requestedBacklog }, () =>
      resolve(handle)
    );
    handle.once('error', reject);
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
    runtime,
    localListenBacklog: requestedBacklog,
    stages: [],
  };
  try {
    if (serveFixture) {
      console.log('ISOLATED_CAPACITY_FIXTURE_READY ' + JSON.stringify({ runtime, productionCapacity: 'UNKNOWN' }));
      await new Promise((resolve) => {
        process.once('SIGTERM', resolve);
        process.once('SIGINT', resolve);
      });
      return;
    }
    for (const concurrency of CAPACITY_STAGES) {
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
      if (failures > 0 || stage.latencyMs.p95 > MAX_P95_MS) break;
    }
    report.providerOperations = providerOperations;
    report.finishedAt = new Date().toISOString();
    try {
      assertSuccessfulAudit(report);
      report.fixtureVerdict = 'PASS';
    } catch (error) {
      report.fixtureVerdict = 'FAIL';
      report.failureReason = error.message;
      throw error;
    } finally {
      console.log(JSON.stringify(report, null, 2));
    }
  } finally {
    fixtureDelay?.disable();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
}
main().catch((error) => {
  console.error('Isolated capacity audit failed:', error.message);
  process.exitCode = 1;
});
