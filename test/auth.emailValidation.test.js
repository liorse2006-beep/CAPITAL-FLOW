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
