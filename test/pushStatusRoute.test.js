require('./helpers/testEnv');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const crypto = require('node:crypto');
const webpushLib = require('web-push');
const vapid = webpushLib.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.VAPID_SUBJECT = 'mailto:synthetic@test.local';
const db = require('../server/db');
const { issueToken } = require('../server/services/auth');
const webPush = require('../server/services/webPush');
let configured = true;
webPush.isPushConfigured = () => configured;
const router = require('../server/routes/push');
const keys = { p256dh: webpushLib.generateVAPIDKeys().publicKey, auth: Buffer.alloc(16, 9).toString('base64url') };
const device = { endpoint: 'https://push.example/status-device', keys };
before(async () => db.ready);
beforeEach(() => {
  configured = true;
});

async function requestStatus(t, body = device, { tier = 'elite', token: overrideToken } = {}) {
  const result = await db
    .prepare("INSERT INTO users (email, is_verified, tier, created_at) VALUES (?, 1, ?, '2000-01-01 00:00:00')")
    .run(`status-${crypto.randomUUID()}@test.local`, tier);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = overrideToken === undefined ? (await issueToken(user)).accessToken : overrideToken;
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      })
  );
  return {
    user,
    async send() {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/push/subscription-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      return { response, data: await response.json() };
    },
  };
}

test('exact owner/device registration reports enabled without exposing keys or identifiers', async (t) => {
  const fixture = await requestStatus(t);
  await webPush.saveSubscription(fixture.user.id, device);
  const { response, data } = await fixture.send();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(data, { enabled: true });
  await webPush.removeSubscription(device.endpoint, fixture.user.id);
});

test('a missing registration is false and never silently creates one', async (t) => {
  const fixture = await requestStatus(t);
  const { data } = await fixture.send();
  assert.deepEqual(data, { enabled: false });
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?').get(fixture.user.id)).count,
    0
  );
});

test('another owner cannot observe or transfer a registered device through status checks', async (t) => {
  const owner = await requestStatus(t);
  await webPush.saveSubscription(owner.user.id, device);
  const other = await requestStatus(t);
  const { data } = await other.send();
  assert.deepEqual(data, { enabled: false });
  assert.equal(
    (await db.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint = ?').get(device.endpoint)).user_id,
    owner.user.id
  );
  await webPush.removeSubscription(device.endpoint, owner.user.id);
});

test('an outdated key on the same owner does not imply a working registration', async (t) => {
  const fixture = await requestStatus(t, {
    ...device,
    keys: { ...keys, auth: Buffer.alloc(16, 8).toString('base64url') },
  });
  await webPush.saveSubscription(fixture.user.id, device);
  assert.deepEqual((await fixture.send()).data, { enabled: false });
  await webPush.removeSubscription(device.endpoint, fixture.user.id);
});

test('unconfigured push cannot be reported enabled', async (t) => {
  const fixture = await requestStatus(t);
  configured = false;
  assert.equal((await fixture.send()).response.status, 503);
});

test('invalid and private device destinations are rejected without any outbound request', async (t) => {
  const fixture = await requestStatus(t, { ...device, endpoint: 'https://127.0.0.1/private' });
  assert.equal((await fixture.send()).response.status, 400);
});

test('logged-out callers cannot inspect a device registration', async (t) => {
  const fixture = await requestStatus(t, device, { token: null });
  assert.equal((await fixture.send()).response.status, 401);
});

test('an expired-trial free account cannot use the push status endpoint', async (t) => {
  const fixture = await requestStatus(t, device, { tier: 'free' });
  assert.equal((await fixture.send()).response.status, 403);
});
