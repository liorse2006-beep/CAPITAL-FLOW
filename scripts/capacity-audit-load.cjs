// Separate load generator: never imports the application, its database or secrets.
// The only permitted destination is the fixed offline synthetic fixture loopback.
const assert = require('node:assert/strict');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { CAPACITY_STAGES, MAX_P95_MS, assertSuccessfulAudit } = require('./capacity-audit-contract.cjs');
const { counterDelta } = require('./capacity-audit-diagnostics.cjs');
const ORIGIN = 'http://127.0.0.1:3001';
const PREFIX = '/__isolated-capacity-fixture';
const ROUTES = Object.freeze(['/api/account/summary', '/api/watchlist', '/api/notifications', '/api/scan']);

function assertFixture(payload, includeUsers = false) {
  assert.equal(payload?.fixture, 'synthetic-local-only-v1', 'Not the isolated synthetic fixture');
  if (includeUsers) {
    assert.equal(payload.productionCapacity, 'UNKNOWN');
    assert.equal(payload.users?.length, 500, 'Only the bounded 500-user fixture is allowed');
    const ids = new Set();
    for (const [index, user] of payload.users.entries()) {
      assert.equal(user.index, index);
      assert.ok(Number.isSafeInteger(user.id) && user.id > 0);
      assert.ok(typeof user.token === 'string' && user.token.length > 0);
      ids.add(user.id);
    }
    assert.equal(ids.size, 500, 'Synthetic users must have distinct identities');
  }
}

async function fixtureFetch(path, options) {
  assert.ok(
    ROUTES.includes(path) ||
      [PREFIX + '/users', PREFIX + '/stats', PREFIX + '/stats?reset=1', PREFIX + '/requests'].includes(path)
  );
  return fetch(ORIGIN + path, { ...options, signal: AbortSignal.timeout(10000), redirect: 'error' });
}

async function fixtureJson(path, options) {
  const response = await fixtureFetch(path, options);
  assert.equal(response.status, 200, 'Fixture endpoint failed');
  const payload = await response.json();
  assertFixture(payload, path.endsWith('/users'));
  return payload;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)].toFixed(2));
}

function failureSample(error, { path, cycle, began, headersAt, responseStatus, ended }) {
  assert.ok(ROUTES.includes(path));
  return {
    path,
    cycle: cycle + 1,
    phase: headersAt === null ? 'awaiting_headers' : 'reading_body',
    code: error.cause?.code || error.name || 'network_error',
    responseStatus,
    elapsedMs: Number((ended - began).toFixed(2)),
    headersMs: headersAt === null ? null : Number((headersAt - began).toFixed(2)),
  };
}

async function main() {
  // Fixed bounded readiness wait. No URL/env override or fallback to production.
  let fixture;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      fixture = await fixtureJson(PREFIX + '/users');
      break;
    } catch (error) {
      if (attempt === 29) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const report = {
    startedAt: new Date().toISOString(),
    scope: 'Offline synthetic warm production read routes; app and generator in separate processes/CPU budgets',
    productionCapacity: 'UNKNOWN',
    loadGenerator: { node: process.version, platform: process.platform, architecture: process.arch },
    stages: [],
  };
  try {
    for (const concurrency of CAPACITY_STAGES) {
      const before = await fixtureJson(PREFIX + '/stats?reset=1');
      const generatorDelay = monitorEventLoopDelay({ resolution: 10 });
      generatorDelay.enable();
      const generatorCpu = process.cpuUsage();
      const beganStage = performance.now();
      const timings = [];
      const statuses = {};
      const failureSamples = [];
      const routeTimings = Object.fromEntries(ROUTES.map((path) => [path, { timings: [], statuses: {} }]));
      let mismatches = 0;
      let requestSequence = 0;
      await Promise.all(
        fixture.users.slice(0, concurrency).map(async (user) => {
          for (let cycle = 0; cycle < 3; cycle++) {
            for (const path of ROUTES) {
              const began = performance.now();
              const beganAt = Date.now();
              const requestId = `${concurrency}.${++requestSequence}`;
              let headersAt = null;
              let responseStatus = null;
              let outcome;
              try {
                const response = await fixtureFetch(path, {
                  headers: {
                    Authorization: 'Bearer ' + user.token,
                    'X-Forwarded-For': `10.1.${Math.floor(user.index / 250)}.${(user.index % 250) + 1}`,
                    'X-Isolated-Request-Id': requestId,
                  },
                });
                headersAt = performance.now();
                responseStatus = response.status;
                const data = await response.json();
                outcome = String(response.status);
                statuses[response.status] = (statuses[response.status] || 0) + 1;
                if (response.ok) {
                  if (path.endsWith('/summary') && data.user?.id !== user.id) mismatches++;
                  if (path === '/api/watchlist' && (data.length !== 1 || data[0] !== `T${user.index}`)) mismatches++;
                  if (
                    path === '/api/notifications' &&
                    (data.notifications?.length !== 1 || data.notifications[0].title !== `Fixture-${user.index}`)
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
                outcome = code;
                statuses[code] = (statuses[code] || 0) + 1;
                if (failureSamples.length < 50)
                  failureSamples.push({
                    ...failureSample(error, {
                      path,
                      cycle,
                      began,
                      headersAt,
                      responseStatus,
                      ended: performance.now(),
                    }),
                    requestId,
                    beganAt,
                    endedAt: Date.now(),
                  });
              } finally {
                const elapsed = performance.now() - began;
                timings.push(elapsed);
                routeTimings[path].timings.push(elapsed);
                routeTimings[path].statuses[outcome] = (routeTimings[path].statuses[outcome] || 0) + 1;
              }
            }
          }
        })
      );
      const duration = performance.now() - beganStage;
      const generatorSpent = process.cpuUsage(generatorCpu);
      generatorDelay.disable();
      const after = await fixtureJson(PREFIX + '/stats');
      if (failureSamples.length > 0) {
        const trace = await fixtureJson(PREFIX + '/requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: failureSamples.map((sample) => sample.requestId) }),
        });
        for (const sample of failureSamples) sample.serverTrace = trace.requests[sample.requestId];
      }
      report.runtime = after.runtime;
      report.providerOperations = after.providerOperations;
      const stage = {
        virtualUsers: concurrency,
        cyclesPerUser: 3,
        requests: timings.length,
        statuses,
        failures: Object.entries(statuses)
          .filter(([status]) => status !== '200')
          .reduce((sum, [, count]) => sum + count, 0),
        identityOrDataMismatches: mismatches,
        transport: after.transport,
        serverRequests: after.requests,
        tcpCounterDelta: counterDelta(before.tcpCounters, after.tcpCounters),
        generator: {
          cpuMs: Number(((generatorSpent.user + generatorSpent.system) / 1000).toFixed(2)),
          rssMiB: Number((process.memoryUsage().rss / 1048576).toFixed(2)),
          eventLoopP99Ms: Number((generatorDelay.percentile(99) / 1e6).toFixed(2)),
          eventLoopMaxMs: Number((generatorDelay.max / 1e6).toFixed(2)),
        },
        failureSamples,
        routes: Object.fromEntries(
          ROUTES.map((path) => [
            path,
            {
              requests: routeTimings[path].timings.length,
              statuses: routeTimings[path].statuses,
              p95Ms: percentile(routeTimings[path].timings, 0.95),
              maxMs: percentile(routeTimings[path].timings, 1),
            },
          ])
        ),
        durationMs: Number(duration.toFixed(2)),
        requestsPerSecond: Number(((timings.length / duration) * 1000).toFixed(2)),
        latencyMs: {
          p50: percentile(timings, 0.5),
          p95: percentile(timings, 0.95),
          p99: percentile(timings, 0.99),
          max: percentile(timings, 1),
        },
        rssMiB: after.rssMiB,
        cpuMs: Number((after.cpuMs - before.cpuMs).toFixed(2)),
        eventLoopP99Ms: after.eventLoopP99Ms,
      };
      report.stages.push(stage);
      console.log('CAPACITY_STAGE ' + JSON.stringify(stage));
      if (mismatches > 0 || stage.failures > 0 || stage.latencyMs.p95 > MAX_P95_MS) break;
    }
    assertSuccessfulAudit(report);
    report.fixtureVerdict = 'PASS';
  } catch (error) {
    report.fixtureVerdict = 'FAIL';
    report.failureReason = error.message;
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    console.log(JSON.stringify(report, null, 2));
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error('Separate isolated capacity audit failed:', error.message);
    process.exitCode = 1;
  });

module.exports = { assertFixture, fixtureFetch, failureSample, main };
