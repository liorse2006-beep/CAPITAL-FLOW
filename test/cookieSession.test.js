// Regression test for the express-session -> cookie-session swap in
// server/index.js (session data now lives in a signed cookie, not
// server-memory) — this is what makes the OAuth handshake safe to run
// behind multiple worker processes: whichever process handles the /google
// redirect and whichever handles /callback a few seconds later don't need
// to be the same one, or share any server-side store, because the session
// travels with the browser's cookie instead of living in one process's RAM.
//
// This exercises the exact mechanism Passport's serializeUser/
// deserializeUser relies on (req.session.passport.user persisting across
// two separate requests) using the same cookie-session config as
// server/index.js, without booting the full app or mocking Google.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieSession = require('cookie-session');

function startTestApp() {
  const app = express();
  app.use(
    cookieSession({
      name: 'vs.sess',
      keys: ['test-session-secret-'.padEnd(32, 'x')],
      sameSite: 'lax',
      maxAge: 1000 * 60 * 10,
    })
  );
  app.get('/set', (req, res) => {
    req.session.passport = { user: 42 };
    res.json({ ok: true });
  });
  app.get('/read', (req, res) => {
    res.json({ passportUser: (req.session && req.session.passport && req.session.passport.user) || null });
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function getSetCookie(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

test('session data set on one request is readable on a later request carrying the same cookie', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const setRes = await fetch(`http://127.0.0.1:${port}/set`);
    assert.strictEqual(setRes.status, 200);
    const cookie = getSetCookie(setRes);
    assert.ok(cookie, 'a session cookie must be issued');

    const readRes = await fetch(`http://127.0.0.1:${port}/read`, { headers: { Cookie: cookie } });
    const body = await readRes.json();
    assert.strictEqual(
      body.passportUser,
      42,
      'session value must survive across separate requests via the cookie alone'
    );
  } finally {
    server.close();
  }
});

test('no server-side session store is involved — a request with no cookie sees no session data', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    await fetch(`http://127.0.0.1:${port}/set`); // establishes a session for "someone"
    const readRes = await fetch(`http://127.0.0.1:${port}/read`); // no cookie sent
    const body = await readRes.json();
    assert.strictEqual(
      body.passportUser,
      null,
      'without the cookie, nothing server-side remembers the session — proves there is no shared/in-memory store to go stale across processes'
    );
  } finally {
    server.close();
  }
});

test('the session cookie is tamper-evident (signed) — a modified cookie value is rejected, not silently trusted', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const setRes = await fetch(`http://127.0.0.1:${port}/set`);
    const cookie = getSetCookie(setRes);
    const tampered = cookie.replace('vs.sess=', 'vs.sess=tampered');

    const readRes = await fetch(`http://127.0.0.1:${port}/read`, { headers: { Cookie: tampered } });
    const body = await readRes.json();
    assert.strictEqual(body.passportUser, null, 'a tampered cookie must not be trusted as a valid session');
  } finally {
    server.close();
  }
});
