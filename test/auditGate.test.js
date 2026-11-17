const test = require('node:test');
const assert = require('node:assert');
const { evaluate, advisoryId } = require('../scripts/audit-gate.cjs');

const report = {
  vulnerabilities: {
    zod: {
      via: [
        { severity: 'high', name: 'zod', title: 'memory', url: 'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5' },
      ],
    },
    other: {
      via: [
        { severity: 'critical', name: 'other', title: 'bad', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' },
        { severity: 'moderate', name: 'other', title: 'meh', url: 'https://github.com/advisories/GHSA-dddd-eeee-ffff' },
        'transitive-name-only',
      ],
    },
  },
};

test('advisoryId extracts and normalizes the GHSA id', () => {
  assert.strictEqual(advisoryId('https://github.com/advisories/GHSA-mrhx-c7xc-m3w5'), 'GHSA-MRHX-C7XC-M3W5');
  assert.strictEqual(advisoryId('no id here'), null);
});

test('an allowlisted advisory is ignored but any other high/critical one still blocks', () => {
  const allowlist = [{ id: 'GHSA-MRHX-C7XC-M3W5', reviewBy: '2027-01-31', reason: 'x' }];
  const result = evaluate(report, allowlist, '2026-11-17');
  assert.deepStrictEqual(
    result.ignored.map(([id]) => id),
    ['GHSA-MRHX-C7XC-M3W5']
  );
  assert.deepStrictEqual(
    result.blocking.map(([id]) => id),
    ['GHSA-AAAA-BBBB-CCCC']
  );
});

test('an expired allowlist entry blocks the release again', () => {
  const allowlist = [{ id: 'GHSA-MRHX-C7XC-M3W5', reviewBy: '2026-01-01', reason: 'x' }];
  const result = evaluate(report, allowlist, '2026-11-17');
  const zod = result.blocking.find(([id]) => id === 'GHSA-MRHX-C7XC-M3W5');
  assert.ok(zod && zod[1].expired);
});
