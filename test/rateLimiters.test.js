// Regression test for the brute-force vulnerability fixed on this branch:
// /login and /verify-otp had no rate limiting at all (confirmed exploitable:
// 15/15 rapid requests succeeded). Spins up a throwaway express app with the
// real limiter middleware attached, so this exercises the actual config.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { authLimiter, otpLimiter } = require('../server/middleware/rateLimiters');

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
    assert.ok(codes.slice(0, 10).every((c) => c === 200), 'the first 10 requests should succeed');
  } finally {
    server.close();
  }
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
