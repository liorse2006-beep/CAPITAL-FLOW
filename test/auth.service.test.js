require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');
const { hashPassword, verifyPassword, generateToken, verifyToken, generateOTP } = require('../server/services/auth');

test('password hash roundtrip: correct password verifies, wrong one fails', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.strictEqual(await verifyPassword('correct horse battery staple', hash), true);
  assert.strictEqual(await verifyPassword('wrong password', hash), false);
});

test('JWT roundtrip: token carries the user id and email', () => {
  const token = generateToken({ id: 42, email: 'user@example.com', is_premium: 1 });
  const payload = verifyToken(token);
  assert.strictEqual(payload.id, 42);
  assert.strictEqual(payload.email, 'user@example.com');
});

test('JWT signed with a different secret is rejected', () => {
  const jwt = require('jsonwebtoken');
  const forged = jwt.sign({ id: 1, email: 'admin@test.local' }, 'some-other-secret', { expiresIn: '1h' });
  assert.throws(() => verifyToken(forged), /invalid signature/);
});

test('pre-parsed HMAC key preserves existing string-signed tokens and token lifetime', () => {
  const jwt = require('jsonwebtoken');
  const { JWT_SECRET } = require('../server/config');
  const legacy = jwt.sign({ id: 42, email: 'user@example.com', sid: 7 }, JWT_SECRET, { expiresIn: '1h' });
  assert.strictEqual(verifyToken(legacy).sid, 7);
  const created = generateToken({ id: 42, email: 'user@example.com', is_premium: 1 }, 7);
  const payload = jwt.verify(created, JWT_SECRET);
  assert.strictEqual(payload.sid, 7);
  assert.strictEqual(payload.exp - payload.iat, 3600);
  const expired = jwt.sign({ id: 42, sid: 7 }, JWT_SECRET, { expiresIn: -1 });
  assert.throws(() => verifyToken(expired), /jwt expired/);
  const unsigned = jwt.sign({ id: 42, sid: 7 }, null, { algorithm: 'none' });
  assert.throws(() => verifyToken(unsigned), /signature is required/);
});

test('generateOTP produces a 6-digit numeric string, well distributed', () => {
  const codes = new Set();
  for (let i = 0; i < 200; i++) {
    const code = generateOTP();
    assert.match(code, /^\d{6}$/, `OTP "${code}" should be exactly 6 digits`);
    codes.add(code);
  }
  // Extremely unlikely to collide this much if using a real RNG across 200 draws
  assert.ok(codes.size > 190, 'OTPs should not repeat suspiciously often');
});
