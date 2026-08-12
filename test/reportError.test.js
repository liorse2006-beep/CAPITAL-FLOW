// server/utils/reportError.js — the shared helper that makes ordinary
// caught application errors actually reach Sentry, not just literal
// uncaught process crashes (see server/sentry.js's attachErrorHandler,
// which only ever saw the latter before this existed).
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');

const { reportError } = require('../server/utils/reportError');
const { Sentry } = require('../server/sentry');

test('reportError logs to the console AND forwards the error to Sentry.captureException', (t) => {
  const consoleSpy = t.mock.method(console, 'error', () => {});
  const captureSpy = t.mock.method(Sentry, 'captureException', () => {});

  const err = new Error('boom');
  reportError(err, '[some-route]');

  assert.strictEqual(consoleSpy.mock.callCount(), 1);
  assert.strictEqual(captureSpy.mock.callCount(), 1);
  assert.strictEqual(captureSpy.mock.calls[0].arguments[0], err);
});

test('reportError never throws even if Sentry.captureException itself throws', (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(Sentry, 'captureException', () => {
    throw new Error('sentry is down');
  });

  assert.doesNotThrow(() => reportError(new Error('boom'), '[whatever]'));
});
