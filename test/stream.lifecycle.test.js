require('./helpers/testEnv');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const db = require('../server/db');
const auth = require('../server/services/auth');
const { issueSseTicket } = require('../server/middleware/authMiddleware');
const stream = require('../server/routes/stream');
let server;
let base;

before(async () => {
  await db.ready;
  const app = express();
  app.use('/api', stream.router);
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

async function owner(name) {
  const inserted = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, 'elite', 1)")
    .run(`${name}@test.local`);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(inserted.lastInsertRowid);
  return { user, ...(await auth.issueToken(user)) };
}

async function open(account) {
  const controller = new AbortController();
  const response = await fetch(
    `${base}/stream?ticket=${encodeURIComponent(issueSseTicket(account.user.id, account.sessionId))}`,
    { signal: controller.signal }
  );
  const reader = response.body.getReader();
  const first = await read(reader);
  assert.match(Buffer.from(first.value).toString(), /event: connected/);
  return { reader, controller };
}

async function read(reader) {
  let timer;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Stream did not deliver or close')), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function expectClosed(reader) {
  try {
    assert.equal((await read(reader)).done, true);
  } catch (error) {
    assert.equal(error.message, 'terminated', 'only transport termination is an expected alternative to EOF');
  }
}

test('live stream closes on logout and leaves another device connected', async () => {
  const a = await owner('stream-logout');
  const second = { ...a, ...(await auth.issueToken(a.user)) };
  const left = await open(a);
  const right = await open(second);
  try {
    await auth.revokeSession(a.sessionId, a.user.id);
    await expectClosed(left.reader);
    stream.broadcastToUser(a.user.id, 'alert', { symbol: 'AAPL' });
    assert.match(Buffer.from((await read(right.reader)).value).toString(), /AAPL/);
  } finally {
    left.controller.abort();
    right.controller.abort();
  }
});

for (const [name, statement] of [
  ['downgrade', "UPDATE users SET tier = 'premium' WHERE id = ?"],
  ['block', 'UPDATE users SET is_blocked = 1 WHERE id = ?'],
  ['trial-expiry', "UPDATE users SET tier = 'free', created_at = '2020-01-01 00:00:00' WHERE id = ?"],
  ['session deletion on another replica', 'DELETE FROM user_sessions WHERE user_id = ?'],
]) {
  test(`protected delivery rechecks ${name} without an invalidation event`, async () => {
    const a = await owner(`stream-${name.replaceAll(' ', '-')}`);
    const connection = await open(a);
    try {
      await db.prepare(statement).run(a.user.id);
      stream.broadcastToUser(a.user.id, 'alert', { sensitive: 'must-not-arrive' });
      await expectClosed(connection.reader);
    } finally {
      connection.controller.abort();
    }
  });
}

test('stream admission bounds simultaneous connections per session', async () => {
  const a = await owner('stream-cap');
  const one = await open(a);
  const two = await open(a);
  try {
    const response = await fetch(`${base}/stream?ticket=${encodeURIComponent(issueSseTicket(a.user.id, a.sessionId))}`);
    assert.equal(response.status, 429);
    await response.json();
  } finally {
    one.controller.abort();
    two.controller.abort();
  }
});

test('oversized delivery closes the connection and frees its capacity', async () => {
  const a = await owner('stream-backpressure');
  const connection = await open(a);
  try {
    stream.broadcastToUser(a.user.id, 'alert', { value: 'x'.repeat(600000) });
    await expectClosed(connection.reader);
    const replacement = await open(a);
    replacement.controller.abort();
  } finally {
    connection.controller.abort();
  }
});

test('restart ends active event streams, refuses late admissions, and lets HTTP close cleanly', async () => {
  const a = await owner('stream-shutdown');
  const one = await open(a);
  const two = await open(a);
  try {
    stream.closeAllStreams();
    stream.closeAllStreams(); // Repeated shutdown signals must be harmless.
    assert.equal(stream.clientCount(), 0);
    assert.equal((await read(one.reader)).done, true, 'restart must end the stream, not destroy its transport');
    assert.equal((await read(two.reader)).done, true);
    const late = await fetch(`${base}/stream?ticket=${encodeURIComponent(issueSseTicket(a.user.id, a.sessionId))}`);
    assert.equal(late.status, 503);
    assert.equal(late.headers.get('Retry-After'), '5');
    assert.match((await late.json()).error, /restarting/);
    let timer;
    try {
      await Promise.race([
        new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('HTTP close waited for an event stream')), 1000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    one.controller.abort();
    two.controller.abort();
  }
});
