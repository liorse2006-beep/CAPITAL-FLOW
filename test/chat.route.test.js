// GET/POST/DELETE /api/chat/* — Capi is an Elite feature, opened up in full
// during the 7-day free trial (requireEliteOrTrial): Elite and in-trial free
// accounts get in, premium and past-trial free accounts are rejected. The
// message round-trip actually persists both sides of the conversation.
require('./helpers/testEnv');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');

process.env.GOOGLE_AI_STUDIO_KEY = 'test-gemini-key';
delete require.cache[require.resolve('../server/config')];
delete require.cache[require.resolve('../server/services/chatbot')];

const db = require('../server/db');
before(async () => { await db.ready; });

const { issueToken } = require('../server/services/auth');
const chatRouter = require('../server/routes/chat');

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', chatRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function makeUser(email, tier = 'elite') {
  const result = await db
    .prepare('INSERT INTO users (email, is_verified, tier, is_premium) VALUES (?, 1, ?, ?)')
    .run(email, tier, tier !== 'free' ? 1 : 0);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

// A free account created 8 days ago — its 7-day trial has elapsed, so it no
// longer has Elite access.
async function makePastTrialFreeUser(email) {
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  const result = await db
    .prepare("INSERT INTO users (email, is_verified, tier, is_premium, created_at) VALUES (?, 1, 'free', 0, ?)")
    .run(email, eightDaysAgo);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

const originalFetch = global.fetch;
after(() => {
  global.fetch = originalFetch;
});

test('all three chat routes require auth', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const get = await fetch(`http://127.0.0.1:${port}/api/chat/history`);
    assert.strictEqual(get.status, 401);
    const post = await fetch(`http://127.0.0.1:${port}/api/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });
    assert.strictEqual(post.status, 401);
    const del = await fetch(`http://127.0.0.1:${port}/api/chat/history`, { method: 'DELETE' });
    assert.strictEqual(del.status, 401);
  } finally {
    server.close();
  }
});

test('premium and past-trial free are rejected with NOT_ELITE on every chat route', async () => {
  const premium = await makeUser('chat-premium@test.local', 'premium');
  const pastTrial = await makePastTrialFreeUser('chat-free-expired@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  try {
    for (const user of [premium, pastTrial]) {
      const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await issueToken(user)) };
      const get = await fetch(`http://127.0.0.1:${port}/api/chat/history`, { headers });
      assert.strictEqual(get.status, 403);
      assert.strictEqual((await get.json()).code, 'NOT_ELITE');

      const post = await fetch(`http://127.0.0.1:${port}/api/chat/message`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: 'hi' }),
      });
      assert.strictEqual(post.status, 403);

      const del = await fetch(`http://127.0.0.1:${port}/api/chat/history`, { method: 'DELETE', headers });
      assert.strictEqual(del.status, 403);
    }
  } finally {
    server.close();
  }
});

test('a free account still inside its 7-day trial gets full Capi access', async () => {
  const freshFree = await makeUser('chat-free-trial@test.local', 'free');
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await issueToken(freshFree)) };
    // GET history doesn't call Gemini — a clean 200 proves the gate let them in.
    const get = await fetch(`http://127.0.0.1:${port}/api/chat/history`, { headers });
    assert.strictEqual(get.status, 200);
    assert.ok(Array.isArray(await get.json()));
  } finally {
    server.close();
  }
});

function mockGemini(replyText, interactionId) {
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('generativelanguage.googleapis.com')) {
      return { ok: true, json: async () => ({ id: interactionId || 'v1_x', output_text: replyText }) };
    }
    return originalFetch(url, opts);
  };
}

test('POST /api/chat/message persists both the user message and the reply, GET returns them in order', async () => {
  mockGemini('Capital Flow scans for unusual volume.');

  const user = await makeUser('chat-route@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await issueToken(user)) };
  try {
    const postRes = await fetch(`http://127.0.0.1:${port}/api/chat/message`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'What does Capital Flow do?' }),
    });
    assert.strictEqual(postRes.status, 200);
    const postBody = await postRes.json();
    assert.strictEqual(postBody.reply, 'Capital Flow scans for unusual volume.');

    const getRes = await fetch(`http://127.0.0.1:${port}/api/chat/history`, { headers });
    const history = await getRes.json();
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].role, 'user');
    assert.strictEqual(history[0].content, 'What does Capital Flow do?');
    assert.strictEqual(history[1].role, 'assistant');
    assert.strictEqual(history[1].content, 'Capital Flow scans for unusual volume.');
  } finally {
    server.close();
  }
});

test('POST /api/chat/message rejects an empty message', async () => {
  const user = await makeUser('chat-empty@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await issueToken(user)) };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/chat/message`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: '   ' }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    server.close();
  }
});

test('DELETE /api/chat/history clears only the requesting user\'s messages', async () => {
  mockGemini('ok', 'v1_y');

  const alice = await makeUser('chat-alice@test.local');
  const bob = await makeUser('chat-bob@test.local');
  const server = await startTestApp();
  const port = server.address().port;
  const aliceHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await issueToken(alice)) };
  const bobHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await issueToken(bob)) };
  try {
    await fetch(`http://127.0.0.1:${port}/api/chat/message`, { method: 'POST', headers: aliceHeaders, body: JSON.stringify({ message: 'hi' }) });
    await fetch(`http://127.0.0.1:${port}/api/chat/message`, { method: 'POST', headers: bobHeaders, body: JSON.stringify({ message: 'hi' }) });

    const delRes = await fetch(`http://127.0.0.1:${port}/api/chat/history`, { method: 'DELETE', headers: aliceHeaders });
    assert.strictEqual(delRes.status, 200);

    const aliceHistory = await (await fetch(`http://127.0.0.1:${port}/api/chat/history`, { headers: aliceHeaders })).json();
    const bobHistory = await (await fetch(`http://127.0.0.1:${port}/api/chat/history`, { headers: bobHeaders })).json();
    assert.strictEqual(aliceHistory.length, 0);
    assert.strictEqual(bobHistory.length, 2, "bob's history must survive alice clearing hers");
  } finally {
    server.close();
  }
});
