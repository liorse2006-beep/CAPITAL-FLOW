const { test } = require('node:test');
const assert = require('node:assert/strict');
const { solveChallenge } = require('altcha-lib');
const { deriveKey } = require('altcha-lib/algorithms/pbkdf2');
const { createSignupVerification, TOKEN_PREFIX, TTL_MS } = require('../server/services/signupVerification');
const cookie = 'a'.repeat(64);

async function solved(challenge) {
  const solution = await solveChallenge({ challenge, deriveKey, timeout: 10000 });
  assert.ok(solution);
  return TOKEN_PREFIX + Buffer.from(JSON.stringify({ challenge, solution })).toString('base64');
}

test('a real self-hosted proof is browser-bound, valid once, and needs no external provider', async () => {
  const verifier = createSignupVerification({ counter: () => 2 });
  const challenge = await verifier.issue(cookie);
  const token = await solved(challenge);
  assert.equal(await verifier.consume(token, 'b'.repeat(64)), false);
  assert.equal(await verifier.consume(token, cookie), true);
  assert.equal(await verifier.consume(token, cookie), false);
});

test('concurrent submissions cannot replay the same proof', async () => {
  const verifier = createSignupVerification({ counter: () => 2 });
  const token = await solved(await verifier.issue(cookie));
  const results = await Promise.all(Array.from({ length: 10 }, () => verifier.consume(token, cookie)));
  assert.equal(results.filter(Boolean).length, 1);
});

test('altered parameters and a fabricated key fail without consuming the valid proof', async () => {
  const verifier = createSignupVerification({ counter: () => 2 });
  const challenge = await verifier.issue(cookie);
  const token = await solved(challenge);
  const payload = JSON.parse(Buffer.from(token.slice(TOKEN_PREFIX.length), 'base64'));
  for (const mutate of [
    (item) => {
      item.challenge.parameters.cost = 1;
    },
    (item) => {
      item.challenge.parameters.data.purpose = 'login';
    },
    (item) => {
      item.challenge.parameters.expiresAt += 3600;
    },
    (item) => {
      item.solution.derivedKey = '0'.repeat(64);
    },
    (item) => {
      item.solution.counter = 0.5;
    },
  ]) {
    const changed = structuredClone(payload);
    mutate(changed);
    const invalid = TOKEN_PREFIX + Buffer.from(JSON.stringify(changed)).toString('base64');
    assert.equal(await verifier.consume(invalid, cookie), false);
  }
  assert.equal(await verifier.consume(token, cookie), true);
});

test('expired challenges and challenges from a previous boot are rejected', async () => {
  let time = Date.now();
  const verifier = createSignupVerification({ now: () => time, counter: () => 2 });
  const token = await solved(await verifier.issue(cookie));
  assert.equal(await createSignupVerification().consume(token, cookie), false);
  time += TTL_MS;
  assert.equal(await verifier.consume(token, cookie), false);
});

test('storage is bounded without evicting an unexpired challenge to accept a replay', async () => {
  let time = Date.now();
  const verifier = createSignupVerification({ now: () => time, maxChallenges: 2, counter: () => 2 });
  const first = await verifier.issue(cookie);
  await verifier.issue(cookie);
  assert.equal(await verifier.issue(cookie), null);
  assert.equal(await verifier.consume(await solved(first), cookie), true);
  assert.ok(await verifier.issue(cookie));
  time += TTL_MS;
  assert.ok(await verifier.issue(cookie));
});

test('concurrent generation and malformed/oversized payloads are bounded', async () => {
  const verifier = createSignupVerification({ maxInFlight: 1, counter: () => 2 });
  const first = verifier.issue(cookie);
  assert.equal(await verifier.issue(cookie), null);
  assert.ok(await first);
  for (const token of [undefined, {}, '', TOKEN_PREFIX + '!', TOKEN_PREFIX + 'e30=', TOKEN_PREFIX + 'a'.repeat(8193)])
    assert.equal(await verifier.consume(token, cookie), false);
  assert.equal(await verifier.issue('invalid-cookie'), null);
});
