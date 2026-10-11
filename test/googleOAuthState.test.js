// The Google OAuth flow must bind its callback to the signed cookie-session.
// This is a local contract test only: it never opens Google OAuth or makes a
// network request.
process.env.GOOGLE_CLIENT_ID = 'synthetic-google-client';
process.env.GOOGLE_CLIENT_SECRET = 'synthetic-google-secret';
process.env.GOOGLE_CALLBACK_URL = 'https://capitalflow.test/api/auth/google/callback';
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const authRouter = require('../server/routes/auth');
const passport = require('passport');
const crypto = require('node:crypto');
const { createGoogleOAuthStateStore } = require('../server/services/googleOAuthState');

function authenticate(req, options = authRouter.GOOGLE_CALLBACK_AUTH_OPTIONS) {
  const configured = passport._strategy('google');
  assert.ok(configured, 'exercise the strategy actually installed by the auth router');
  const strategy = Object.create(configured);
  const exchanges = [];
  strategy._oauth2 = Object.create(configured._oauth2);
  strategy._oauth2.getOAuthAccessToken = (code, params, done) => {
    exchanges.push({ code, params });
    done(null, 'synthetic-access-token', null, {});
  };
  strategy._loadUserProfile = (_token, done) => done(null, { id: 'synthetic-profile' });
  strategy._verify = (_access, _refresh, _profile, done) => done(null, { id: 'synthetic-user' });
  return new Promise((resolve, reject) => {
    strategy.redirect = (url) => resolve({ kind: 'redirect', url: new URL(url), exchanges });
    strategy.success = (user) => resolve({ kind: 'success', user, exchanges });
    strategy.fail = (info, status) => resolve({ kind: 'fail', info, status, exchanges });
    strategy.error = reject;
    strategy.authenticate(req, options);
  });
}

function save(store, req, meta, verifier = 'v'.repeat(43)) {
  return new Promise((resolve, reject) =>
    store.store(req, verifier, true, meta, (err, state) => (err ? reject(err) : resolve(state)))
  );
}

function verify(store, req, state, meta) {
  return new Promise((resolve, reject) =>
    store.verify(req, state, meta, (err, value) => (err ? reject(err) : resolve(value)))
  );
}

test('Google OAuth authorization and callback both require Passport state verification', () => {
  assert.equal(authRouter.GOOGLE_AUTH_OPTIONS.state, true);
  assert.deepEqual(authRouter.GOOGLE_AUTH_OPTIONS.scope, ['profile', 'email']);
  assert.equal(authRouter.GOOGLE_CALLBACK_AUTH_OPTIONS.state, true);
  assert.equal(authRouter.GOOGLE_CALLBACK_AUTH_OPTIONS.session, false);
});

test('the installed Google strategy emits random state and S256, keeping the verifier out of the browser cookie', async () => {
  const request = { query: {}, session: {} };
  const first = await authenticate(request, authRouter.GOOGLE_AUTH_OPTIONS);
  const second = await authenticate({ query: {}, session: {} }, authRouter.GOOGLE_AUTH_OPTIONS);
  assert.equal(first.kind, 'redirect');
  assert.match(first.url.searchParams.get('state'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(first.url.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.url.searchParams.get('state'), second.url.searchParams.get('state'));
  assert.deepEqual(Object.keys(request.session), ['googleOAuthBrowserBinding', 'googleOAuthCookieRenewal']);
  const snapshot = structuredClone(request.session);
  const callback = { query: { code: 'synthetic-code', state: first.url.searchParams.get('state') }, session: snapshot };
  const accepted = await authenticate(callback);
  assert.equal(accepted.kind, 'success');
  assert.equal(accepted.exchanges.length, 1);
  const verifier = accepted.exchanges[0].params.code_verifier;
  assert.equal(
    crypto.createHash('sha256').update(verifier).digest('base64url'),
    first.url.searchParams.get('code_challenge')
  );
  assert.equal(JSON.stringify(request.session).includes(verifier), false);
  const replay = await authenticate({ ...callback, session: structuredClone(snapshot) });
  assert.equal(replay.kind, 'fail');
  assert.equal(replay.status, 403);
  assert.equal(replay.exchanges.length, 0, 'replaying an old signed cookie must not exchange the authorization code');
});

test('missing, forged and cross-browser callbacks cannot exchange codes; the original browser still works', async () => {
  const started = { query: {}, session: {} };
  const authorization = await authenticate(started, authRouter.GOOGLE_AUTH_OPTIONS);
  const state = authorization.url.searchParams.get('state');
  for (const request of [
    { query: { code: 'c' }, session: started.session },
    { query: { code: 'c', state: 'x'.repeat(43) }, session: started.session },
    { query: { code: 'c', state }, session: {} },
    { query: { code: 'c', state: [state, state] }, session: started.session },
  ]) {
    const rejected = await authenticate(request);
    assert.equal(rejected.kind, 'fail');
    assert.equal(rejected.exchanges.length, 0);
  }
  assert.equal((await authenticate({ query: { code: 'c', state }, session: started.session })).kind, 'success');
});

test('state is bound to exact provider/callback, expires, is bounded and is consumed atomically', async () => {
  let now = 1000;
  const store = createGoogleOAuthStateStore({ now: () => now, ttlMs: 100, capacity: 2 });
  const request = { session: {} };
  const meta = {
    authorizationURL: 'https://google.test/authorize',
    tokenURL: 'https://google.test/token',
    clientID: 'client',
    callbackURL: 'https://capitalflow.test/callback',
  };
  const state = await save(store, request, meta);
  for (const key of Object.keys(meta))
    assert.equal(await verify(store, request, state, { ...meta, [key]: 'different' }), false);
  const results = await Promise.all([verify(store, request, state, meta), verify(store, request, state, meta)]);
  assert.deepEqual(results, ['v'.repeat(43), false]);
  const expired = await save(store, request, meta);
  await save(store, request, meta);
  await assert.rejects(save(store, request, meta), /temporarily unavailable/);
  now += 100;
  assert.equal(await verify(store, request, expired, meta), false);
  assert.ok(await save(store, request, meta), 'expired entries free the bounded store');
  assert.equal(
    await verify(createGoogleOAuthStateStore(), request, expired, meta),
    false,
    'restart fails old transactions closed'
  );
  await assert.rejects(save(store, {}, meta), /session unavailable/);
});

test('one browser cannot monopolize the OAuth pool and renewal keeps simultaneous tabs bound', async () => {
  const store = createGoogleOAuthStateStore({ capacity: 2000, perBrowserCapacity: 8 });
  const request = { session: {} },
    meta = { clientID: 'synthetic' };
  const first = await save(store, request, meta);
  const binding = request.session.googleOAuthBrowserBinding;
  const renewal = request.session.googleOAuthCookieRenewal;
  const second = await save(store, request, meta);
  assert.equal(request.session.googleOAuthBrowserBinding, binding);
  assert.notEqual(request.session.googleOAuthCookieRenewal, renewal);
  for (let i = 2; i < 8; i++) await save(store, request, meta);
  await assert.rejects(save(store, request, meta), /temporarily unavailable/);
  assert.ok(await save(store, { session: {} }, meta), 'a fresh browser still has capacity');
  assert.equal(await verify(store, request, first, meta), 'v'.repeat(43));
  assert.equal(await verify(store, request, second, meta), 'v'.repeat(43));
});
