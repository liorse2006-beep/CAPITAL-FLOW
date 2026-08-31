// Regression test for the brute-force vulnerability fixed on this branch:
// /login and /verify-otp had no rate limiting at all (confirmed exploitable:
// 15/15 rapid requests succeeded). Spins up a throwaway express app with the
// real limiter middleware attached, so this exercises the actual config.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { authLimiter, otpLimiter, realIp, scanLimiter, sseStreamLimiter } = require('../server/middleware/rateLimiters');
const { generateToken } = require('../server/services/auth');
const { issueSseTicket } = require('../server/middleware/authMiddleware');

function startTestApp(limiter) {
  const app = express();
  app.post('/probe', limiter, (req, res) => res.json({ ok: true }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function hit(port, n) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const res = await fetch(`http://127.0.0.1:${port}/probe`, { method: 'POST' });
    codes.push(res.status);
  }
  return codes;
}

test('authLimiter blocks after its configured max (10) requests per window', async () => {
  const server = await startTestApp(authLimiter);
  const port = server.address().port;
  try {
    const codes = await hit(port, 15);
    const blocked = codes.filter((c) => c === 429).length;
    assert.ok(blocked > 0, 'expected at least one 429 within 15 rapid requests (limit is 10)');
    assert.ok(
      codes.slice(0, 10).every((c) => c === 200),
      'the first 10 requests should succeed'
    );
  } finally {
    server.close();
  }
});

test('realIp does not trust a spoofed Cloudflare forwarding header', () => {
  assert.equal(
    realIp({
      headers: { 'cf-connecting-ip': '203.0.113.99' },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    }),
    '127.0.0.1'
  );
});

test('otpLimiter is stricter than authLimiter (max 5)', async () => {
  const server = await startTestApp(otpLimiter);
  const port = server.address().port;
  try {
    const codes = await hit(port, 8);
    const ok = codes.filter((c) => c === 200).length;
    assert.strictEqual(ok, 5, 'otpLimiter should allow exactly 5 requests before blocking');
  } finally {
    server.close();
  }
});

async function hitAs(port, n, token) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const res = await fetch(`http://127.0.0.1:${port}/probe`, {
      method: 'POST',
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    codes.push(res.status);
  }
  return codes;
}

// Regression: scanLimiter (and apiLimiter/chatLimiter, same keyGenerator)
// used to key purely by IP, so two different signed-in customers behind the
// same shared IP — an office, a campus, mobile CGNAT — drew from ONE shared
// 30/min budget and could throttle each other despite each individually
// staying well under any real limit. Every request in this test comes from
// the same test-harness IP on purpose, to prove that no longer matters once
// each request carries its own valid access token.
test('scanLimiter gives each signed-in account its own budget, even from the same IP', async () => {
  const server = await startTestApp(scanLimiter);
  const port = server.address().port;
  try {
    const tokenA = generateToken({ id: 111, email: 'a@test.local', is_premium: 0 }, 'session-a');
    const tokenB = generateToken({ id: 222, email: 'b@test.local', is_premium: 0 }, 'session-b');

    // User A alone uses their whole 30/min budget.
    const aCodes = await hitAs(port, 30, tokenA);
    assert.ok(
      aCodes.every((c) => c === 200),
      'user A should get all 30 of their own requests through'
    );

    // User B, same IP, completely untouched — a fresh 30/min budget of
    // their own, not sharing A's now-exhausted one.
    const bCodes = await hitAs(port, 30, tokenB);
    assert.ok(
      bCodes.every((c) => c === 200),
      "user B's budget must be independent of user A's, despite the same source IP"
    );
  } finally {
    server.close();
  }
});

test('scanLimiter still falls back to per-IP limiting for requests with no valid token', async () => {
  const server = await startTestApp(scanLimiter);
  const port = server.address().port;
  try {
    const codes = await hitAs(port, 35, null); // no Authorization header at all
    const blocked = codes.filter((c) => c === 429).length;
    assert.ok(blocked > 0, 'unauthenticated requests must still be throttled by IP (limit is 30)');
  } finally {
    server.close();
  }
});

function startGetTestApp(limiter) {
  const app = express();
  app.get('/probe', limiter, (req, res) => res.json({ ok: true }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function hitWithTicket(port, n, ticket) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const url = ticket
      ? `http://127.0.0.1:${port}/probe?ticket=${encodeURIComponent(ticket)}`
      : `http://127.0.0.1:${port}/probe`;
    const res = await fetch(url);
    codes.push(res.status);
  }
  return codes;
}

// Regression: EventSource (used for /api/stream) cannot send an
// Authorization header, so before this fix every SSE connection attempt
// fell through to the IP key on the shared apiLimiter floor — every
// customer behind the same office/CGNAT IP drew from ONE 120/min budget for
// opening their live-alerts connection. Confirmed for real in a load test:
// 100 simultaneous connection attempts from one IP, only ~120/min ever let
// through. sseStreamLimiter now keys by the ticket's own userId instead, so
// two different accounts sharing an IP get independent budgets, same
// principle as scanLimiter above.
test('sseStreamLimiter gives each ticket-holding account its own budget, even from the same IP', async () => {
  const server = await startGetTestApp(sseStreamLimiter);
  const port = server.address().port;
  try {
    const ticketA = issueSseTicket(333, 3331);
    const ticketB = issueSseTicket(444, 4441);

    const aCodes = await hitWithTicket(port, 60, ticketA);
    assert.ok(
      aCodes.every((c) => c === 200),
      'user A should get all 60 of their own connection attempts through'
    );

    const bCodes = await hitWithTicket(port, 60, ticketB);
    assert.ok(
      bCodes.every((c) => c === 200),
      "user B's budget must be independent of user A's, despite the same source IP"
    );
  } finally {
    server.close();
  }
});

test('sseStreamLimiter still falls back to per-IP limiting for requests with no valid ticket', async () => {
  const server = await startGetTestApp(sseStreamLimiter);
  const port = server.address().port;
  try {
    const codes = await hitWithTicket(port, 65, null); // no ticket at all
    const blocked = codes.filter((c) => c === 429).length;
    assert.ok(blocked > 0, 'ticketless requests must still be throttled by IP (limit is 60)');
  } finally {
    server.close();
  }
});
