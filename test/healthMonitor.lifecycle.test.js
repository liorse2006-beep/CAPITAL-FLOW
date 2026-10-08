process.env.GMAIL_USER = 'monitor-fixture@test.local';
process.env.GMAIL_APP_PASSWORD = 'synthetic-placeholder';
process.env.ADMIN_EMAIL = 'admin-fixture@test.local';
require('./helpers/testEnv');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const nodemailer = require('nodemailer');

test('scheduled health checks share work and shutdown drains the pending probe and alert', async (t) => {
  const runtime = require('../server/services/backgroundRuntime');
  const startup = runtime.backgroundTimeout;
  const periodic = runtime.backgroundInterval;
  const timeouts = [];
  const intervals = [];
  t.mock.method(runtime, 'backgroundTimeout', (work, ms) => {
    timeouts.push(ms);
    return startup(work, 1);
  });
  t.mock.method(runtime, 'backgroundInterval', (work, ms) => {
    intervals.push(ms);
    return periodic(work, ms);
  });
  let requestCount = 0;
  let completeProbe;
  let probeStarted;
  const probeStart = new Promise((resolve) => {
    probeStarted = resolve;
  });
  t.mock.method(http, 'get', (_url, _options, callback) => {
    requestCount++;
    const request = new EventEmitter();
    request.destroy = () => request.emit('error', new Error('synthetic close'));
    const complete = () => {
      const response = new EventEmitter();
      response.statusCode = 503;
      response.resume = () => process.nextTick(() => response.emit('end'));
      callback(response);
    };
    if (requestCount < 3) process.nextTick(complete);
    else {
      completeProbe = complete;
      probeStarted();
    }
    return request;
  });
  let releaseMail;
  const mailGate = new Promise((resolve) => {
    releaseMail = resolve;
  });
  let mailStarted;
  const mailStart = new Promise((resolve) => {
    mailStarted = resolve;
  });
  t.mock.method(nodemailer, 'createTransport', () => ({
    sendMail: async () => {
      mailStarted();
      await mailGate;
    },
  }));
  const { checkHealth, startHealthMonitor } = require('../server/services/healthMonitor');
  await checkHealth();
  await checkHealth();
  startHealthMonitor();
  startHealthMonitor();
  // The production timer is intentionally unref'd. Keep this synthetic
  // process alive long enough to admit it before awaiting its mock request.
  await new Promise((resolve) => setTimeout(resolve, 10));
  await probeStart;
  assert.deepEqual(timeouts, [30000]);
  assert.deepEqual(intervals, [300000]);
  const first = checkHealth();
  assert.equal(first, checkHealth());
  assert.equal(requestCount, 3, 'overlapping calls share the admitted probe');
  let drained = false;
  const drain = runtime.stopBackgroundTasks().then(() => {
    drained = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(drained, false, 'pending HTTP work is part of shutdown');
  completeProbe();
  await mailStart;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(drained, false, 'pending delivery is also part of shutdown');
  releaseMail();
  await first;
  await drain;
  assert.equal(drained, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(requestCount, 3, 'cancelled timers must not admit another check');
});
