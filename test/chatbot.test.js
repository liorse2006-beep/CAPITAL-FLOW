// Capi (server/services/chatbot.js): never throws, always returns a
// user-facing string, chains multi-turn conversations via
// previous_interaction_id, and recovers gracefully if that id has expired.
require('./helpers/testEnv');
const { test, before, after } = require('node:test');
const assert = require('node:assert');

process.env.GOOGLE_AI_STUDIO_KEY = 'test-gemini-key';
delete require.cache[require.resolve('../server/config')];
delete require.cache[require.resolve('../server/services/chatbot')];

const db = require('../server/db');
before(async () => { await db.ready; });

const { askCapi } = require('../server/services/chatbot');

async function makeUser(email) {
  const result = await db.prepare('INSERT INTO users (email, is_verified) VALUES (?, 1)').run(email);
  return result.lastInsertRowid;
}

const originalFetch = global.fetch;
after(() => {
  global.fetch = originalFetch;
});

test('a fresh conversation sends a system_instruction and stores the returned interaction id', async () => {
  const userId = await makeUser('capi-fresh@test.local');
  let sentBody = null;
  global.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ id: 'v1_first', output_text: 'Hi, how can I help?' }) };
  };

  const reply = await askCapi(userId, 'What is Capital Flow?');
  assert.strictEqual(reply, 'Hi, how can I help?');
  assert.ok(sentBody.system_instruction, 'first turn must include the system prompt');
  assert.strictEqual(sentBody.previous_interaction_id, undefined);

  const row = await db.prepare('SELECT gemini_interaction_id FROM users WHERE id = ?').get(userId);
  assert.strictEqual(row.gemini_interaction_id, 'v1_first');
});

test('a follow-up message chains via the stored previous_interaction_id, not a fresh system prompt', async () => {
  const userId = await makeUser('capi-followup@test.local');
  await db.prepare('UPDATE users SET gemini_interaction_id = ? WHERE id = ?').run('v1_prior', userId);

  let sentBody = null;
  global.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ id: 'v1_next', output_text: 'Sure, here is more detail.' }) };
  };

  const reply = await askCapi(userId, 'Tell me more');
  assert.strictEqual(reply, 'Sure, here is more detail.');
  assert.strictEqual(sentBody.previous_interaction_id, 'v1_prior');
  assert.strictEqual(sentBody.system_instruction, undefined, 'a chained turn must not resend the system prompt');
});

test('extracts text from the steps[] shape when output_text is absent', async () => {
  const userId = await makeUser('capi-steps@test.local');
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      id: 'v1_steps',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: 'From steps' }] }],
    }),
  });

  const reply = await askCapi(userId, 'hi');
  assert.strictEqual(reply, 'From steps');
});

test('a stale previous_interaction_id is retried as a fresh conversation instead of failing', async () => {
  const userId = await makeUser('capi-stale@test.local');
  await db.prepare('UPDATE users SET gemini_interaction_id = ? WHERE id = ?').run('v1_expired', userId);

  let attempt = 0;
  global.fetch = async (url, opts) => {
    attempt++;
    const body = JSON.parse(opts.body);
    if (attempt === 1) {
      assert.strictEqual(body.previous_interaction_id, 'v1_expired');
      return { ok: false, json: async () => ({ error: 'not found' }) };
    }
    assert.strictEqual(body.previous_interaction_id, undefined, 'retry must start a fresh conversation');
    return { ok: true, json: async () => ({ id: 'v1_recovered', output_text: 'Starting over, happy to help.' }) };
  };

  const reply = await askCapi(userId, 'still there?');
  assert.strictEqual(reply, 'Starting over, happy to help.');
  assert.strictEqual(attempt, 2);
});

test('never throws — a total network failure returns a friendly fallback string', async () => {
  const userId = await makeUser('capi-down@test.local');
  global.fetch = async () => {
    throw new Error('network down');
  };

  const reply = await askCapi(userId, 'hello?');
  assert.strictEqual(typeof reply, 'string');
  assert.match(reply, /couldn't reach/i);
});
