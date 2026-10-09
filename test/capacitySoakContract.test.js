const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { assertSuccessfulSoak, matchesOwner } = require('../scripts/capacity-audit-soak.cjs');
function fixture() {
  return {
    productionCapacity: 'UNKNOWN',
    virtualUsers: 100,
    providerOperations: 0,
    durationMs: 300000,
    rounds: 150,
    requests: 60000,
    statuses: { 200: 60000 },
    failures: 0,
    identityOrDataMismatches: 0,
    latencyMs: { p95: 100 },
    samples: [
      { rssMiB: 150, activeRequests: 0, listenerErrors: 0 },
      { rssMiB: 160, activeRequests: 0, listenerErrors: 0 },
    ],
  };
}
test('only a completed bounded offline soak passes; it never certifies production', () => {
  assert.doesNotThrow(() => assertSuccessfulSoak(fixture()));
  for (const fields of [
    { productionCapacity: 100 },
    { durationMs: 299999 },
    { durationMs: Infinity },
    { virtualUsers: 500 },
    { providerOperations: 1 },
    { rounds: 151 },
    { requests: 59999 },
    { failures: 1 },
    { identityOrDataMismatches: 1 },
    { statuses: { 200: 59999, 503: 1 } },
    { latencyMs: { p95: NaN } },
    { latencyMs: { p95: 2001 } },
  ])
    assert.throws(() => assertSuccessfulSoak({ ...fixture(), ...fields }));
  for (const fields of [{ rssMiB: 512 }, { activeRequests: 1 }, { listenerErrors: 1 }]) {
    const report = fixture();
    Object.assign(report.samples[1], fields);
    assert.throws(() => assertSuccessfulSoak(report));
  }
});
test('soak validates every owner route and is fixed, offline and secret-free in CI', () => {
  const user = { id: 42, index: 1 };
  assert.ok(matchesOwner('/api/account/summary', { user: { id: 42 } }, user));
  assert.ok(!matchesOwner('/api/account/summary', { user: { id: 43 } }, user));
  assert.ok(matchesOwner('/api/watchlist', ['T1'], user));
  assert.ok(!matchesOwner('/api/watchlist', ['T2'], user));
  assert.ok(matchesOwner('/api/notifications', { notifications: [{ title: 'Fixture-1' }] }, user));
  assert.ok(!matchesOwner('/api/notifications', { notifications: [{ title: 'Fixture-2' }] }, user));
  assert.ok(
    matchesOwner(
      '/api/scan',
      { results: [{ symbol: 'A' }, { symbol: 'B' }, { symbol: 'C' }], dataStatus: 'complete' },
      user
    )
  );
  assert.ok(
    !matchesOwner(
      '/api/scan',
      { results: [{ symbol: 'A' }, { symbol: 'A' }, { symbol: 'C' }], dataStatus: 'complete' },
      user
    )
  );
  const source = readFileSync(require.resolve('../scripts/capacity-audit-soak.cjs'), 'utf8');
  assert.match(source, /const DURATION_MS = 300000/);
  assert.match(source, /const PERIOD_MS = 2000/);
  assert.doesNotMatch(source, /process\.env|capitalflow\.vip|console\.log[^\n]*(token|Authorization|users)/);
  const workflow = readFileSync(require.resolve('../.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /scripts\/capacity-audit-soak\.cjs/);
});
