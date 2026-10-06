// Real auth routes and an isolated SQLite database, with in-memory SMTP and
// Siteverify substitutes. No real account, secret, email or provider call.
require('./helpers/testEnv');
process.env.TURNSTILE_SECRET = 'test-only-turnstile-secret';
process.env.GMAIL_USER = 'mailer@example.test';
process.env.GMAIL_APP_PASSWORD = 'test-only-smtp-password';
process.env.RESEND_API_KEY = '';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const messages = [];
let mailFailure = false;
nodemailer.createTransport = () => ({
  sendMail: async (payload) => {
    if (mailFailure) throw new Error('Mock SMTP temporarily unavailable');
    messages.push(payload);
    return { messageId: 'mock-message' };
  },
});
const nativeFetch = global.fetch;
let verificationMode = 'normal';
const consumed = new Set();
global.fetch = async (url, options) => {
  if (url !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify') return nativeFetch(url, options);
  if (verificationMode === 'offline') throw new Error('Mock verification unavailable');
  if (verificationMode === 'non-json')
    return {
      ok: true,
      json: async () => {
        throw new SyntaxError('Invalid JSON');
      },
    };
  const token = options.body.get('response');
  const success = token.startsWith('valid-') && !consumed.has(token);
  if (success) consumed.add(token);
  return { ok: true, json: async () => ({ success, 'error-codes': success ? [] : ['timeout-or-duplicate'] }) };
};
const db = require('../server/db');
const authRouter = require('../server/routes/auth');
let server;
let origin;
before(async () => {
  await db.ready;
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api/auth', authRouter);
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  global.fetch = nativeFetch;
  await new Promise((resolve) => server.close(resolve));
});
async function post(path, body) {
  const response = await nativeFetch(`${origin}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}
function emailCode(email, prefix) {
  const message = messages.findLast((item) => item.to === email && item.subject.startsWith(prefix));
  assert.ok(message, 'the verification mail must be accepted by the mocked transport');
  const code = message.subject.match(/\d{6}/)?.[0];
  assert.ok(code);
  return code;
}

test('email signup, OTP verification, password login and refresh use the normal real route flow', async () => {
  const email = 'signup-roundtrip@example.test';
  const password = 'test-only-password-123';
  const signup = await post('signup', { email, password, captchaToken: 'valid-roundtrip' });
  assert.equal(signup.response.status, 200);
  const row = await db.prepare('SELECT is_verified, password_hash FROM users WHERE email = ?').get(email);
  assert.equal(row.is_verified, 0);
  assert.notEqual(row.password_hash, password);
  const verified = await post('verify-otp', { email, code: emailCode(email, 'Your verification code:') });
  assert.equal(verified.response.status, 200);
  assert.equal(verified.body.user.is_verified, true);
  assert.equal(verified.body.user.auth_provider, 'Email and password');
  assert.ok(verified.body.token);
  assert.equal(verified.body.user.password_hash, undefined);
  const login = await post('login', { email, password });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  const refresh = await nativeFetch(`${origin}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: cookie.split(';')[0] },
  });
  assert.equal(refresh.status, 200);
  assert.ok((await refresh.json()).token);
});

test('missing, malformed and reused challenges never create an account', async () => {
  for (const [index, captchaToken] of [undefined, { token: 'valid-object' }, 'valid-roundtrip'].entries()) {
    const email = `rejected-${index}@example.test`;
    const result = await post('signup', { email, password: 'test-password-123', captchaToken });
    assert.equal(result.response.status, 400);
    assert.equal(await db.prepare('SELECT id FROM users WHERE email = ?').get(email), undefined);
  }
});

test('verification outage and invalid provider JSON fail closed without account creation', async () => {
  for (const mode of ['offline', 'non-json']) {
    verificationMode = mode;
    const email = `${mode}@example.test`;
    const result = await post('signup', { email, password: 'test-password-123', captchaToken: `valid-${mode}` });
    assert.equal(result.response.status, 400);
    assert.equal(await db.prepare('SELECT id FROM users WHERE email = ?').get(email), undefined);
  }
  verificationMode = 'normal';
});

test('mail failure can recover with a fresh challenge without duplicating the account', async () => {
  const email = 'mail-recovery@example.test';
  mailFailure = true;
  const failed = await post('signup', { email, password: 'test-password-123', captchaToken: 'valid-mail-first' });
  assert.equal(failed.response.status, 500);
  mailFailure = false;
  const recovered = await post('signup', { email, password: 'test-password-123', captchaToken: 'valid-mail-retry' });
  assert.equal(recovered.response.status, 200);
  const count = await db.prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?').get(email);
  assert.equal(count.count, 1);
  const verified = await post('verify-otp', { email, code: emailCode(email, 'Your verification code:') });
  assert.equal(verified.response.status, 200);
});
