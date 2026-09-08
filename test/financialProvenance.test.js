const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFinancialProvenance, CAPITAL_FLOW_SOURCES } = require('../server/services/financialProvenance');

test('financial provenance preserves source timestamps and explicitly marks missing provider timestamps', () => {
  const provenance = buildFinancialProvenance({
    dataAsOf: '2026-09-08T10:15:00.000Z',
    capturedAt: '2026-09-08T10:15:03.000Z',
    status: 'partial',
    quoteStatus: 'stale',
    sources: CAPITAL_FLOW_SOURCES.map((source, index) => ({
      ...source,
      asOf: index === 0 ? '2026-09-08T10:15:00.000Z' : null,
      status: index === 0 ? 'stale' : 'unknown',
    })),
  });

  assert.equal(provenance.status, 'partial');
  assert.equal(provenance.quoteStatus, 'stale');
  assert.equal(provenance.asOf, '2026-09-08T10:15:00.000Z');
  assert.equal(provenance.capturedAt, '2026-09-08T10:15:03.000Z');
  assert.equal(provenance.timezone, 'UTC');
  assert.equal(provenance.sources[0].timestampAvailable, true);
  assert.equal(provenance.sources[1].timestampAvailable, false);
  assert.match(provenance.limitations[1], /null source timestamp/);
});

test('invalid timestamps are returned as null instead of being replaced with request time', () => {
  const provenance = buildFinancialProvenance({
    dataAsOf: 'not-a-date',
    capturedAt: 'also-not-a-date',
    status: 'complete',
    sources: [{ provider: 'Example', role: 'quote', asOf: 'not-a-date', status: 'complete' }],
  });

  assert.equal(provenance.asOf, null);
  assert.equal(provenance.capturedAt, null);
  assert.equal(provenance.sources[0].asOf, null);
  assert.equal(provenance.sources[0].timestampAvailable, false);
});
