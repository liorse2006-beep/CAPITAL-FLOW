const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { CAPACITY_STAGES, assertSuccessfulAudit } = require('../scripts/capacity-audit-contract.cjs');
const { assertFixture, fixtureFetch, failureSample } = require('../scripts/capacity-audit-load.cjs');

function fixture() {
  return {
    productionCapacity: 'UNKNOWN',
    providerOperations: 0,
    stages: CAPACITY_STAGES.map((virtualUsers) => ({
      virtualUsers,
      requests: virtualUsers * 12,
      failures: 0,
      statuses: { 200: virtualUsers * 12 },
      identityOrDataMismatches: 0,
      latencyMs: { p95: 100 },
    })),
  };
}

test('only a full isolated warm-fixture audit can pass, never certify production', () => {
  assert.doesNotThrow(() => assertSuccessfulAudit(fixture()));
  const report = fixture();
  report.productionCapacity = 500;
  assert.throws(() => assertSuccessfulAudit(report), /cannot certify production/);
});

test('early stop, failed requests and mismatched identity cannot become a passing report', () => {
  const incomplete = fixture();
  incomplete.stages.pop();
  assert.throws(() => assertSuccessfulAudit(incomplete), /Every bounded stage/);
  const failed = fixture();
  failed.stages[6].failures = 1;
  assert.throws(() => assertSuccessfulAudit(failed), /Every request/);
  const mismatch = fixture();
  mismatch.stages[6].identityOrDataMismatches = 1;
  assert.throws(() => assertSuccessfulAudit(mismatch), /No identity/);
});

test('slow, non-finite, incomplete or non-200 stages and provider calls are failures', () => {
  for (const p95 of [2000.01, NaN, Infinity]) {
    const report = fixture();
    report.stages[6].latencyMs.p95 = p95;
    assert.throws(() => assertSuccessfulAudit(report), /p95 exceeds/);
  }
  const incomplete = fixture();
  incomplete.stages[6].requests--;
  assert.throws(() => assertSuccessfulAudit(incomplete), /Three cycles/);
  const non200 = fixture();
  non200.stages[6].statuses = { 200: 5999, 503: 1 };
  assert.throws(() => assertSuccessfulAudit(non200), /Only successful HTTP/);
  const provider = fixture();
  provider.providerOperations = 1;
  assert.throws(() => assertSuccessfulAudit(provider), /must not contact/);
});

test('Linux capacity job is public-runner-only, offline and within the existing resource envelope', () => {
  const workflow = readFileSync(require.resolve('../.github/workflows/ci.yml'), 'utf8');
  const boundary = workflow.indexOf('  isolated-capacity:');
  assert.ok(boundary > 0);
  const originalJob = workflow.slice(0, boundary);
  assert.match(originalJob, /Run backend test suite/);
  assert.match(originalJob, /Run frontend test suite/);
  assert.match(originalJob, /Audit production dependencies/);
  const job = workflow.slice(boundary).replace(/^\s*#.*$/gm, '');
  assert.match(job, /github\.event\.repository\.private == false/);
  assert.match(job, /runs-on: ubuntu-latest/);
  assert.match(job, /timeout-minutes: 15/);
  assert.match(job, /persist-credentials: false/);
  assert.match(job, /--network none/);
  assert.match(job, /--cpus 0\.5/);
  assert.match(job, /--memory 512m --memory-swap 512m/);
  assert.match(job, /--read-only/);
  assert.match(job, /node:22-bookworm-slim/);
  assert.match(job, /--serve-fixture/);
  assert.match(job, /--network "container:\$fixture"/);
  assert.match(job, /--cpus 1/);
  assert.match(job, /scripts\/capacity-audit-load\.cjs/);
  assert.doesNotMatch(job, /secrets\.|continue-on-error|issues: write|schedule:|upload-artifact/);
});

test('separate generator rejects arbitrary URLs and refuses non-synthetic or duplicate user fixtures', async () => {
  for (const path of ['https://capitalflow.vip/api/scan', '//example.com', '/api/scan?external=1', '/api/auth/signup'])
    await assert.rejects(fixtureFetch(path));
  assert.throws(() => assertFixture({ fixture: 'production' }), /Not the isolated/);
  const payload = {
    fixture: 'synthetic-local-only-v1',
    productionCapacity: 'UNKNOWN',
    users: Array.from({ length: 500 }, (_, index) => ({ index, id: index + 1, token: 'synthetic-token' })),
  };
  assert.doesNotThrow(() => assertFixture(payload, true));
  payload.users[499].id = 1;
  assert.throws(() => assertFixture(payload, true), /distinct identities/);
});

test('fixture-only credentials endpoints cannot be included in the production Docker runtime', () => {
  const docker = readFileSync(require.resolve('../Dockerfile'), 'utf8');
  const runtime = docker.slice(docker.indexOf('FROM node:22-bookworm-slim AS runtime'));
  assert.doesNotMatch(runtime, /COPY[^\n]*(scripts|test|\/app \.|\. \.)/);
  const fixtureScript = readFileSync(require.resolve('../scripts/isolated-capacity-audit.cjs'), 'utf8');
  assert.match(fixtureScript, /host: '127\.0\.0\.1'/);
  assert.match(fixtureScript, /process\.once\('SIGTERM', resolve\)/);
});

test('capacity diagnostics distinguish header deadlines from body failures without recording credentials', () => {
  const error = Object.assign(new Error('sensitive text must not be included'), { name: 'TimeoutError' });
  const context = { path: '/api/scan', cycle: 0, began: 1, headersAt: null, responseStatus: null, ended: 10001 };
  assert.deepEqual(failureSample(error, context), {
    path: '/api/scan',
    cycle: 1,
    phase: 'awaiting_headers',
    code: 'TimeoutError',
    responseStatus: null,
    elapsedMs: 10000,
    headersMs: null,
  });
  const body = failureSample(error, { ...context, headersAt: 12, responseStatus: 200 });
  assert.equal(body.phase, 'reading_body');
  assert.equal(body.headersMs, 11);
  assert.equal(body.responseStatus, 200);
  assert.doesNotMatch(JSON.stringify(body), /sensitive|token|Bearer/);
  assert.throws(() => failureSample(error, { ...context, path: 'https://capitalflow.vip' }));
});
