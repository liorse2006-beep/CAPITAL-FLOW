const assert = require('node:assert/strict');

const CAPACITY_STAGES = Object.freeze([1, 5, 25, 50, 100, 200, 500]);
const MAX_P95_MS = 2000;

function assertSuccessfulAudit(report) {
  assert.equal(report.productionCapacity, 'UNKNOWN', 'A synthetic audit cannot certify production capacity');
  assert.equal(report.providerOperations, 0, 'The warm fixture must not contact a market provider');
  assert.deepEqual(
    report.stages.map((stage) => stage.virtualUsers),
    CAPACITY_STAGES,
    'Every bounded stage must finish; an early latency stop is not a passing audit'
  );
  for (const stage of report.stages) {
    assert.equal(stage.requests, stage.virtualUsers * 12, 'Three cycles of four requests must finish');
    assert.equal(stage.failures, 0, 'Every request must succeed');
    assert.deepEqual(stage.statuses, { 200: stage.requests }, 'Only successful HTTP 200 responses are accepted');
    assert.equal(stage.identityOrDataMismatches, 0, 'No identity or scan-result mismatch is allowed');
    assert.ok(Number.isFinite(stage.latencyMs.p95) && stage.latencyMs.p95 <= MAX_P95_MS, 'p95 exceeds fixture limit');
  }
}

module.exports = { CAPACITY_STAGES, MAX_P95_MS, assertSuccessfulAudit };
