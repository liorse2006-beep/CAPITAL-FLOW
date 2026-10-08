require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const webpush = require('web-push');

// Real independent processes share only a synthetic local DB. DNS and HTTPS
// are replaced before the sender loads; no real notification can be sent.
const child = String.raw`
  const step = process.env.OUTBOX_RESTART_STEP;
  const dns = require('node:dns').promises;
  dns.lookup = async () => [{ address: '8.8.8.8', family: 4 }];
  const db = require('./server/db');
  const transport = require('./server/services/pushTransport');
  const sender = require('./server/services/webPush');
  const outbox = require('./server/services/notificationOutbox');
  const notifications = require('./server/services/notifications');
  (async () => {
    await db.ready;
    if (step === 'persist') {
      const created = await db.prepare("INSERT INTO users(email, tier, is_verified) VALUES ('restart-fixture@test.local', 'elite', 1)").run();
      const owner = created.lastInsertRowid;
      const keys = { p256dh: process.env.OUTBOX_FIXTURE_PUBLIC_KEY, auth: Buffer.alloc(16, 4).toString('base64url') };
      await sender.saveSubscription(owner, { endpoint: 'https://push.example/first', keys });
      await sender.saveSubscription(owner, { endpoint: 'https://push.example/second', keys });
      const id = await notifications.addNotification(owner, {
        title: 'Market Signal Detected', body: 'New market signal detected. Open Capital Flow to view it.',
        scanType: 'capitalFlow', results: [{ symbol: 'TEST', price: 1 }], pushPayload: { data: { url: '/scanner' } }
      });
      console.log(JSON.stringify({ stage: step, notificationId: id }));
    } else {
      const row = await db.prepare('SELECT notification_id, user_id FROM notification_outbox ORDER BY notification_id LIMIT 1').get();
      let sends = [];
      transport.sendNotification = async (subscription) => {
        sends.push(subscription.endpoint.endsWith('/first') ? 'first' : 'second');
        if (step === 'interrupt' && subscription.endpoint.endsWith('/second')) {
          // Kill this process after the first device's acknowledgement was
          // durably recorded, but before the outbox occurrence completes.
          for (let attempt = 0; attempt < 100; attempt++) {
            const receipt = await db.prepare('SELECT endpoint FROM notification_push_receipts WHERE notification_id = ?').get(row.notification_id);
            if (receipt) {
              console.log(JSON.stringify({ stage: step, checkpoint: 'receipt-committed-before-crash' }));
              process.kill(process.pid, 'SIGKILL');
            }
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          throw new Error('Synthetic crash checkpoint was not reached');
        }
        return { statusCode: 201 };
      };
      if (step === 'recover') {
        // Simulate elapsed lease time; do not pretend the 120-second lease
        // was measured in real time or shorten it in the application.
        await db.prepare('UPDATE notification_outbox SET lease_until = 1 WHERE notification_id = ?').run(row.notification_id);
      }
      await outbox.runNotificationOutboxCycle();
      const state = await db.prepare('SELECT outcome, attempts, finished_at FROM notification_outbox WHERE notification_id = ?').get(row.notification_id);
      const count = await db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?').get(row.user_id);
      console.log(JSON.stringify({ stage: step, sends, state, notificationCount: count.total }));
    }
    await db.close();
  })().catch(error => { console.error(error.name); process.exitCode = 1; });
`;

test('a killed delivery worker recovers only unacknowledged devices after process restart', () => {
  const keys = webpush.generateVAPIDKeys();
  const env = {
    ...process.env,
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: 'mailto:test@test.local',
    OUTBOX_FIXTURE_PUBLIC_KEY: webpush.generateVAPIDKeys().publicKey,
  };
  const run = (step) =>
    spawnSync(process.execPath, ['-e', child], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...env, OUTBOX_RESTART_STEP: step },
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
    });
  const result = (execution) =>
    JSON.parse(
      execution.stdout
        .trim()
        .split(/\r?\n/)
        .filter((line) => line.startsWith('{'))
        .at(-1)
    );
  const persisted = run('persist');
  assert.equal(persisted.status, 0, persisted.stderr);
  assert.ok(result(persisted).notificationId);
  const interrupted = run('interrupt');
  assert.notEqual(interrupted.status, 0);
  assert.equal(result(interrupted).checkpoint, 'receipt-committed-before-crash');
  const recovered = run('recover');
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.deepEqual(result(recovered).sends, ['second']);
  assert.equal(result(recovered).state.outcome, 'accepted');
  assert.equal(result(recovered).state.attempts, 2);
  assert.equal(result(recovered).notificationCount, 1);
  const replay = run('replay');
  assert.equal(replay.status, 0, replay.stderr);
  assert.deepEqual(result(replay).sends, []);
  assert.equal(result(replay).notificationCount, 1);
});
