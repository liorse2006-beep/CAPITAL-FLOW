// Regression test for a stored-XSS gap found in a security audit: /signup
// accepted any string as "email" with no format check, and the admin panel
// used to render that value straight into innerHTML — so a malicious signup
// could execute script in an admin's authenticated session. The admin panel
// now also escapes output (defense in depth), but the real fix is here:
// malformed input should never be stored as an email in the first place.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../server/routes/auth'));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('signup rejects an HTML/script payload disguised as an email', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '<script>alert(1)</script>@x.com', password: 'password123' }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /valid email/i);
  } finally {
    server.close();
  }
});

test('signup rejects an email with no @ or domain', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'password123' }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    server.close();
  }
});

test('signup accepts a normal, well-formed email', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'real-user@example.com', password: 'password123' }),
    });
    assert.strictEqual(res.status, 200);
  } finally {
    server.close();
  }
});

// Regression: users.email is a plain case-sensitive TEXT UNIQUE — without
// normalizing at every entry point, signing up as "Case@Test.local" and
// later logging in as "case@test.local" (e.g. autofill on a different
// device) would silently create a second account instead of matching the
// first, splitting that person's chat history, watchlist, and push
// subscriptions across two "different" users who are really the same
// customer on two devices.
test('signup + login resolve to the same account regardless of email casing', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/auth`;
  try {
    const signupRes = await fetch(`${base}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'Case@Test.local', password: 'password123' }),
    });
    assert.strictEqual(signupRes.status, 200);

    // Signing up again with different casing must be treated as the exact
    // same (still-unverified) account, not rejected as a brand-new one nor
    // silently creating a duplicate row.
    const secondSignupRes = await fetch(`${base}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'case@test.local', password: 'password123' }),
    });
    assert.strictEqual(secondSignupRes.status, 200);

    const db = require('../server/db');
    const rows = await db.prepare('SELECT id, email FROM users WHERE email = ?').all('case@test.local');
    assert.strictEqual(rows.length, 1, 'must be exactly one account, not two');
    assert.strictEqual(rows[0].email, 'case@test.local', 'stored email is normalized to lowercase');
  } finally {
    server.close();
  }
});
