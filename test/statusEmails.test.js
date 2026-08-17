const assert = require('node:assert/strict');
const { test } = require('node:test');

require('./helpers/testEnv');

const { statusIncidentText } = require('../server/services/email');

const incident = {
  public_id: 'INC-TEST-123',
  title: 'Backend API unavailable',
  severity: 'SEV-2 / Major',
  started_at: 1700000000,
  resolved_at: 1700000600,
  outage_seconds: 600,
  failure_count: 3,
  recovery_count: 2,
  public_summary: 'Core API requests are currently failing.',
};

const component = {
  name: 'Backend API',
  path: '/health',
  type: 'health-json',
};

test('status outage email is structured and explains evidence without inventing a cause', () => {
  const text = statusIncidentText({
    incident,
    component,
    checks: { endpoint: '/health', statusCode: 503, responseMs: 8120, errorMessage: 'HTTP 503' },
    relatedComponents: 'Main website: Operational · Backend API: Partial Outage',
    recovery: false,
  });

  assert.match(text, /SITE FUNCTIONALITY ALERT/);
  assert.match(text, /User-facing impact:/);
  assert.match(text, /DIAGNOSTIC EVIDENCE/);
  assert.match(text, /Root cause: Not determined automatically/);
  assert.match(text, /Endpoint: \/health/);
  assert.match(text, /HTTP status: 503/);
  assert.match(text, /STATUS PAGE/);
});

test('status recovery email is structured and includes downtime and recovery evidence', () => {
  const text = statusIncidentText({
    incident,
    component,
    checks: { endpoint: '/health', statusCode: 200, responseMs: 120 },
    recovery: true,
  });

  assert.match(text, /INCIDENT RESOLVED/);
  assert.match(text, /Total downtime: 600 seconds/);
  assert.match(text, /Successful recovery checks: 2/);
  assert.match(text, /STATUS PAGE/);
});
