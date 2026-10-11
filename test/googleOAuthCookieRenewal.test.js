require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieSession = require('cookie-session');
const { createGoogleOAuthStateStore } = require('../server/services/googleOAuthState');

test('a new OAuth start renews the cookie without invalidating an outstanding tab', async (t) => {
  let clock = Date.now();
  const realNow = Date.now;
  t.mock.method(Date, 'now', () => clock);
  const store = createGoogleOAuthStateStore({ now: () => clock });
  const metadata = { clientID: 'synthetic' };
  const app = express();
  app.use(cookieSession({ name: 'vs.sess', keys: ['synthetic-test-key'], maxAge: 600000 }));
  app.get('/start', (req, res) =>
    store.store(req, 'v'.repeat(43), null, metadata, (error, state) => {
      if (error) return res.status(503).end();
      res.json({ state, binding: req.session.googleOAuthBrowserBinding });
    })
  );
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => server.close());
  const url = 'http://127.0.0.1:' + server.address().port + '/start';
  const first = await fetch(url);
  const firstPayload = await first.json();
  const cookies = first.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
  clock += 9 * 60000;
  const second = await fetch(url, { headers: { Cookie: cookies } });
  const secondPayload = await second.json();
  assert.equal(secondPayload.binding, firstPayload.binding);
  const refreshed = second.headers.getSetCookie();
  assert.equal(refreshed.length, 2);
  const expires = refreshed[0].match(/expires=([^;]+)/i)[1];
  assert.ok(new Date(expires).getTime() >= clock + 599000, 'the refreshed browser cookie lasts the new flow window');
  clock += 2 * 60000;
  await new Promise((resolve) =>
    store.verify(
      { session: { googleOAuthBrowserBinding: firstPayload.binding } },
      secondPayload.state,
      metadata,
      (_error, verifier) => {
        assert.equal(verifier, 'v'.repeat(43));
        resolve();
      }
    )
  );
  assert.ok(realNow() > 0);
});
