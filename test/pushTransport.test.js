require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const webpush = require('web-push');
const { sendNotification } = require('../server/services/pushTransport');

function fakeTransport(t, onResponse) {
  let destroyed = 0;
  t.mock.method(webpush, 'generateRequestDetails', () => ({
    endpoint: 'https://push.example/test',
    method: 'POST',
    headers: {},
    body: Buffer.alloc(0),
  }));
  t.mock.method(https, 'request', (_url, _options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => {
      destroyed++;
    };
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = 201;
      response.complete = false;
      response.destroy = () => {
        destroyed++;
      };
      callback(response);
      onResponse(response);
    };
    return request;
  });
  return () => destroyed;
}

test('interrupted push responses settle and release their transport', async (t) => {
  const destroyed = fakeTransport(t, (response) => {
    response.emit('aborted');
    response.emit('close');
  });
  await assert.rejects(sendNotification({}, '', { deadlineMs: 50 }), /interrupted/);
  assert.ok(destroyed() >= 1);
});

test('trickling push responses have a total deadline, not just an inactivity timeout', async (t) => {
  let interval;
  const destroyed = fakeTransport(t, (response) => {
    interval = setInterval(() => response.emit('data', Buffer.from('a')), 2);
  });
  try {
    await assert.rejects(sendNotification({}, '', { deadlineMs: 25 }), /deadline/);
  } finally {
    clearInterval(interval);
  }
  assert.ok(destroyed() >= 1);
});

test('oversized push responses are stopped without retaining their raw body', async (t) => {
  const destroyed = fakeTransport(t, (response) => response.emit('data', Buffer.alloc(9)));
  await assert.rejects(sendNotification({}, '', { maxResponseBytes: 8 }), /size limit/);
  assert.ok(destroyed() >= 1);
});

test('a normal complete 201 response is still accepted', async (t) => {
  fakeTransport(t, (response) => {
    response.complete = true;
    response.emit('end');
    response.emit('close');
  });
  assert.deepEqual(await sendNotification({}, ''), { statusCode: 201 });
});
