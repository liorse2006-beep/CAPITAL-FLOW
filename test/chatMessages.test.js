// server/services/chatMessages.js — per-user chat history storage. The
// recency test guards a real bug: getHistory used to LIMIT on an
// oldest-first order, so a conversation past the cap silently lost its most
// recent turns (exactly the ones Capi's memory needs) and kept replaying
// the very first messages forever.
require('./helpers/testEnv');
const { test, before } = require('node:test');
const assert = require('node:assert');

const db = require('../server/db');
before(async () => {
  await db.ready;
});

const { getHistory, addMessage, clearHistory } = require('../server/services/chatMessages');

async function makeUser(email) {
  const result = await db.prepare('INSERT INTO users (email, is_verified) VALUES (?, 1)').run(email);
  return result.lastInsertRowid;
}

test('getHistory returns messages in chronological order', async () => {
  const userId = await makeUser('history-order@test.local');
  await addMessage(userId, 'user', 'first');
  await addMessage(userId, 'assistant', 'second');
  await addMessage(userId, 'user', 'third');

  const history = await getHistory(userId);
  assert.deepStrictEqual(
    history.map((m) => m.content),
    ['first', 'second', 'third']
  );
});

test('a conversation longer than the history cap keeps the most recent messages, not the oldest', async () => {
  const userId = await makeUser('history-overflow@test.local');
  for (let i = 0; i < 205; i++) {
    await addMessage(userId, i % 2 === 0 ? 'user' : 'assistant', 'msg-' + i);
  }

  const history = await getHistory(userId);
  assert.ok(history.length <= 200);
  const last = history[history.length - 1];
  assert.strictEqual(last.content, 'msg-204', 'the newest message must survive the cap');
  assert.notStrictEqual(history[0].content, 'msg-0', 'the oldest messages must be the ones dropped, not the newest');
});

test("clearHistory only removes the specified user's messages", async () => {
  const alice = await makeUser('history-clear-alice@test.local');
  const bob = await makeUser('history-clear-bob@test.local');
  await addMessage(alice, 'user', 'hi');
  await addMessage(bob, 'user', 'hi');

  await clearHistory(alice);

  assert.strictEqual((await getHistory(alice)).length, 0);
  assert.strictEqual((await getHistory(bob)).length, 1);
});
