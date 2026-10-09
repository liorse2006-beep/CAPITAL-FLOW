// Fixed five-minute warm-read soak. No production URL/env override, external
// provider, real identity, customer notification or billing operation is allowed.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { fixtureFetch, fixtureJson } = require('./capacity-audit-load.cjs');
const PREFIX = '/__isolated-capacity-fixture';
const DURATION_MS = 300000;
const PERIOD_MS = 2000;
const VIRTUAL_USERS = 100;
const ROUTES = ['/api/account/summary', '/api/watchlist', '/api/notifications', '/api/scan'];

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)].toFixed(2));
}

function matchesOwner(path, data, user) {
  if (path.endsWith('/summary')) return data.user?.id === user.id;
  if (path === '/api/watchlist') return data.length === 1 && data[0] === `T${user.index}`;
  if (path === '/api/notifications')
    return data.notifications?.length === 1 && data.notifications[0].title === `Fixture-${user.index}`;
  return (
    data.results?.length === 3 &&
    new Set(data.results.map((row) => row.symbol)).size === 3 &&
    data.dataStatus === 'complete'
  );
}

function assertSuccessfulSoak(report) {
  assert.equal(report.productionCapacity, 'UNKNOWN');
  assert.equal(report.virtualUsers, VIRTUAL_USERS);
  assert.equal(report.providerOperations, 0);
  assert.ok(
    Number.isFinite(report.durationMs) && report.durationMs >= DURATION_MS && report.durationMs <= DURATION_MS + 30000,
    'Five minutes must actually finish'
  );
  assert.ok(
    Number.isSafeInteger(report.rounds) && report.rounds > 0 && report.rounds <= Math.ceil(DURATION_MS / PERIOD_MS)
  );
  assert.equal(report.requests, report.rounds * VIRTUAL_USERS * ROUTES.length);
  assert.deepEqual(report.statuses, { 200: report.requests });
  assert.equal(report.failures, 0);
  assert.equal(report.identityOrDataMismatches, 0);
  assert.ok(Number.isFinite(report.latencyMs.p95) && report.latencyMs.p95 <= 2000);
  assert.ok(report.samples.length >= 2);
  for (const sample of report.samples) {
    assert.ok(Number.isFinite(sample.rssMiB) && sample.rssMiB > 0 && sample.rssMiB < 512);
    assert.equal(sample.activeRequests, 0);
    assert.equal(sample.listenerErrors, 0);
  }
}

async function main() {
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
    scope:
      'Offline synthetic warm production read routes; not real-provider, remote-DB or production capacity evidence',
    startedAt: new Date().toISOString(),
    productionCapacity: 'UNKNOWN',
    virtualUsers: VIRTUAL_USERS,
    rounds: 0,
    requests: 0,
    statuses: {},
    failures: 0,
    identityOrDataMismatches: 0,
    samples: [],
  };
  const timings = [];
  const began = performance.now();
  let nextSample = 0;
  try {
    while (performance.now() - began < DURATION_MS && report.rounds < Math.ceil(DURATION_MS / PERIOD_MS)) {
      const roundStarted = performance.now();
      await Promise.all(
        fixture.users.slice(0, VIRTUAL_USERS).map(async (user) => {
          for (const path of ROUTES) {
            const started = performance.now();
            try {
              const response = await fixtureFetch(path, {
                headers: {
                  Authorization: 'Bearer ' + user.token,
                  'X-Forwarded-For': `10.2.0.${user.index + 1}`,
                },
              });
              const data = await response.json();
              report.statuses[response.status] = (report.statuses[response.status] || 0) + 1;
              if (response.status !== 200) report.failures++;
              else if (!matchesOwner(path, data, user)) report.identityOrDataMismatches++;
            } catch (error) {
              const code = error.cause?.code || error.name || 'network_error';
              report.statuses[code] = (report.statuses[code] || 0) + 1;
              report.failures++;
            } finally {
              report.requests++;
              timings.push(performance.now() - started);
            }
          }
        })
      );
      report.rounds++;
      if (performance.now() - began >= nextSample) {
        const stats = await fixtureJson(PREFIX + '/stats');
        report.runtime = stats.runtime;
        report.providerOperations = stats.providerOperations;
        const sample = {
          elapsedMs: Number((performance.now() - began).toFixed(2)),
          requests: report.requests,
          rssMiB: stats.rssMiB,
          cpuMs: stats.cpuMs,
          eventLoopP99Ms: stats.eventLoopP99Ms,
          activeRequests: stats.requests.active,
          listenerErrors: stats.transport.listenerErrors,
        };
        report.samples.push(sample);
        console.log('SOAK_SAMPLE ' + JSON.stringify(sample));
        nextSample += 30000;
      }
      if (report.failures || report.identityOrDataMismatches) break;
      const wait = Math.min(PERIOD_MS - (performance.now() - roundStarted), DURATION_MS - (performance.now() - began));
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    // Timer rounding must not admit a 151st burst or claim five minutes
    // from a slightly early final wake-up. Failures are never padded to PASS.
    while (!report.failures && !report.identityOrDataMismatches && performance.now() - began < DURATION_MS) {
      await new Promise((resolve) => setTimeout(resolve, Math.ceil(DURATION_MS - (performance.now() - began))));
    }
    const finalStats = await fixtureJson(PREFIX + '/stats');
    report.providerOperations = finalStats.providerOperations;
    report.samples.push({
      elapsedMs: Number((performance.now() - began).toFixed(2)),
      requests: report.requests,
      rssMiB: finalStats.rssMiB,
      cpuMs: finalStats.cpuMs,
      eventLoopP99Ms: finalStats.eventLoopP99Ms,
      activeRequests: finalStats.requests.active,
      listenerErrors: finalStats.transport.listenerErrors,
    });
    report.durationMs = Number((performance.now() - began).toFixed(2));
    report.latencyMs = {
      p50: percentile(timings, 0.5),
      p95: percentile(timings, 0.95),
      p99: percentile(timings, 0.99),
      max: percentile(timings, 1),
    };
    assertSuccessfulSoak(report);
    report.fixtureVerdict = 'PASS';
  } catch (error) {
    report.fixtureVerdict = 'FAIL';
    report.failureReason = error.message;
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    console.log('SOAK_REPORT ' + JSON.stringify(report));
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error('Isolated soak failed:', error.message);
    process.exitCode = 1;
  });

module.exports = { assertSuccessfulSoak, matchesOwner };
