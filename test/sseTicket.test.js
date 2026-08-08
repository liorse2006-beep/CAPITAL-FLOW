// SSE tickets (middleware/authMiddleware.js) used to be looked up in an
// in-memory Map, requiring cross-worker relay to work under cluster mode —
// and that relay being asynchronous meant a fast client could open /stream
// before the relay finished, getting rejected even though the ticket was
// genuinely valid (reproduced in test/cluster.integration.test.js). They're
// now self-verifying HMAC-signed tokens instead: any worker can validate
// one alone, with no shared state and no race window at all.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');
const { issueSseTicket, resolveSseTicket } = require('../server/middleware/authMiddleware');

test('a freshly issued ticket resolves back to the same userId', () => {
  const ticket = issueSseTicket(42);
  assert.strictEqual(resolveSseTicket(ticket), 42);
});

test('a ticket is reusable — resolving it twice both succeed (no delete-on-first-use)', () => {
  const ticket = issueSseTicket(7);
  assert.strictEqual(resolveSseTicket(ticket), 7);
  assert.strictEqual(resolveSseTicket(ticket), 7, 'a second reconnect with the same ticket must not be rejected');
});

test('tickets for different users never collide', () => {
  const a = issueSseTicket(1);
  const b = issueSseTicket(2);
  assert.strictEqual(resolveSseTicket(a), 1);
  assert.strictEqual(resolveSseTicket(b), 2);
});

test('an expired ticket is rejected', () => {
  // Forge a ticket with an expiry already in the past, signed the same way
  // issueSseTicket would — this is what a real ticket looks like 10+
  // minutes after issuance, without needing to actually wait.
  const crypto = require('crypto');
  const { SESSION_SECRET } = require('../server/config');
  const userId = 99;
  const expiresAt = Date.now() - 1000;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(`${userId}.${expiresAt}`).digest('base64url');
  const expiredTicket = `${userId}.${expiresAt}.${sig}`;
  assert.strictEqual(resolveSseTicket(expiredTicket), null);
});

test('a tampered ticket (different userId, same signature) is rejected', () => {
  const ticket = issueSseTicket(5);
  const [, expiresAt, sig] = ticket.split('.');
  const tampered = `999.${expiresAt}.${sig}`;
  assert.strictEqual(resolveSseTicket(tampered), null);
});

test('a tampered ticket (different expiry, same signature) is rejected', () => {
  const ticket = issueSseTicket(5);
  const [userId, expiresAt, sig] = ticket.split('.');
  const tampered = `${userId}.${Number(expiresAt) + 100000}.${sig}`;
  assert.strictEqual(resolveSseTicket(tampered), null);
});

test('garbage input never resolves to a user', () => {
  assert.strictEqual(resolveSseTicket(null), null);
  assert.strictEqual(resolveSseTicket(''), null);
  assert.strictEqual(resolveSseTicket('not-a-ticket'), null);
  assert.strictEqual(resolveSseTicket('a.b.c.d'), null);
  assert.strictEqual(resolveSseTicket('1.2'), null);
});
