// Production-mode auth routes, real signed proof and a disposable SQLite DB.
// Mail stays inside this process; no production account or email is created.
require('./helpers/testEnv');
process.env.TURNSTILE_SECRET = '';
process.env.HCAPTCHA_SECRET = '';
process.env.GMAIL_USER = 'mailer@example.test';
process.env.GMAIL_APP_PASSWORD = 'test-only-smtp-password';
process.env.RESEND_API_KEY = '';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const { solveChallenge } = require('altcha-lib');
const { deriveKey } = require('altcha-lib/algorithms/pbkdf2');
const messages = [];
let mailFails = false;
nodemailer.createTransport = () => ({
  sendMail: async (payload) => {
    if (mailFails) throw new Error('Mock mail unavailable');
    messages.push(payload);
    return { messageId: 'mock-message' };
  },
});
const db = require('../server/db');
const authRouter = require('../server/routes/auth');
const { authLimiter } = require('../server/middleware/rateLimiters');
const fetchNative = global.fetch;
let server, origin, previousEnvironment;

before(async () => {
  await db.ready;
  previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  global.fetch = (url, options) => {
    assert.ok(String(url).startsWith(origin + '/'), 'this flow must not call any external provider');
    return fetchNative(url, options);
  };
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api/auth', authRouter);
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});
// Independent scenarios receive a clean IP bucket. The dedicated threshold
// test below exercises the unchanged production limiter rather than disabling it.
beforeEach(() => authLimiter.resetKey('127.0.0.1'));
after(async () => {
  global.fetch = fetchNative;
  if (previousEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnvironment;
  await new Promise((resolve) => server.close(resolve));
});

async function challenge(purpose = 'signup', route, previousCookie = '') {
  const response = await fetch(`${origin}/api/auth/${route || purpose + '-challenge'}`, {
    headers: { Cookie: previousCookie },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  const challenge = await response.json();
  const solution = await solveChallenge({ challenge, deriveKey, timeout: 20000 });
  assert.ok(solution);
  return {
    cookie: cookie.split(';')[0],
    captchaToken: 'altcha:' + Buffer.from(JSON.stringify({ challenge, solution })).toString('base64'),
  };
}
async function post(path, body, cookie = '') {
  const response = await fetch(`${origin}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test('production signup -> delivered test OTP -> verified account -> password login -> refresh', async () => {
  const email = 'self-hosted-signup@example.test';
  const password = 'synthetic-test-password-123';
  const proof = await challenge();
  const signup = await post('signup', { email, password, captchaToken: proof.captchaToken }, proof.cookie);
  assert.equal(signup.response.status, 200);
  const code = messages.find((item) => item.to === email)?.subject.match(/\d{6}/)?.[0];
  assert.ok(code, 'OTP must actually be accepted by the isolated SMTP transport');
  const row = await db.prepare('SELECT is_verified, password_hash FROM users WHERE email = ?').get(email);
  assert.equal(row.is_verified, 0);
  assert.notEqual(row.password_hash, password);
  const verified = await post('verify-otp', { email, code });
  assert.equal(verified.response.status, 200);
  assert.equal(verified.body.user.is_verified, true);
  assert.equal(verified.body.user.auth_provider, 'Email and password');
  assert.ok(verified.body.token);
  assert.equal(verified.body.user.password_hash, undefined);
  const loginProof = await challenge('login');
  const login = await post('login', { email, password, captchaToken: loginProof.captchaToken }, loginProof.cookie);
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  assert.match(login.response.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await post('refresh', {}, cookie)).response.status, 200);
  const replay = await post(
    'signup',
    { email: 'replay@example.test', password, captchaToken: proof.captchaToken },
    proof.cookie
  );
  assert.equal(replay.response.status, 400);
  assert.equal(await db.prepare('SELECT id FROM users WHERE email = ?').get('replay@example.test'), undefined);
});

test('missing browser binding and invalid verification do not create an account', async () => {
  const proof = await challenge();
  for (const captchaToken of [proof.captchaToken, '', { token: proof.captchaToken }]) {
    const result = await post('signup', {
      email: 'unverified@example.test',
      password: 'test-password-123',
      captchaToken,
    });
    assert.equal(result.response.status, 400);
  }
  assert.equal(await db.prepare('SELECT id FROM users WHERE email = ?').get('unverified@example.test'), undefined);
});

test('a mail failure recovers with a fresh proof, without duplicate account creation', async () => {
  const email = 'self-hosted-retry@example.test';
  let proof = await challenge();
  mailFails = true;
  const first = await post(
    'signup',
    { email, password: 'test-password-123', captchaToken: proof.captchaToken },
    proof.cookie
  );
  assert.equal(first.response.status, 500);
  mailFails = false;
  proof = await challenge();
  const retry = await post(
    'signup',
    { email, password: 'test-password-123', captchaToken: proof.captchaToken },
    proof.cookie
  );
  assert.equal(retry.response.status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?').get(email)).count, 1);
});

test('production login requires its own browser-bound proof and rejects replay without exposing the account', async () => {
  const email = 'self-hosted-signup@example.test';
  const password = 'synthetic-test-password-123';
  for (const captchaToken of [undefined, '', { token: 'invalid' }, 'altcha:forged']) {
    assert.equal((await post('login', { email, password, captchaToken })).response.status, 400);
  }
  const signupProof = await challenge();
  assert.equal(
    (await post('login', { email, password, captchaToken: signupProof.captchaToken }, signupProof.cookie)).response
      .status,
    400
  );
  const proof = await challenge('login');
  assert.equal((await post('login', { email, password, captchaToken: proof.captchaToken })).response.status, 400);
  const login = await post('login', { email, password, captchaToken: proof.captchaToken }, proof.cookie);
  assert.equal(login.response.status, 200);
  assert.equal(
    (await post('login', { email, password, captchaToken: proof.captchaToken }, proof.cookie)).response.status,
    400
  );
  assert.equal(login.body.user.password_hash, undefined);
});

test('credential traffic is limited after ten attempts even when no proof was supplied', async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal(
      (await post('login', { email: 'not-an-account@example.test', password: 'legacy-password' })).response.status,
      400
    );
  }
  const blocked = await post('login', { email: 'not-an-account@example.test', password: 'legacy-password' });
  assert.equal(blocked.response.status, 429);
  assert.ok(Number(blocked.response.headers.get('retry-after')) > 0);
});

test('accepted login aliases issue usable login proofs and renew their browser cookie', async () => {
  const email = 'self-hosted-signup@example.test',
    password = 'synthetic-test-password-123';
  let cookie = '';
  for (const route of ['login-challenge/', 'LOGIN-CHALLENGE', 'LoGiN-ChAlLeNgE/']) {
    const proof = await challenge('login', route, cookie);
    assert.match(proof.cookie, /^vs_login_verification=/);
    if (cookie) assert.equal(proof.cookie, cookie, 'renewal preserves the browser binding');
    cookie = proof.cookie;
    assert.equal(
      (await post('login', { email, password, captchaToken: proof.captchaToken }, cookie)).response.status,
      200
    );
  }
});
