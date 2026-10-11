require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { encryptBackup, decryptBackup, encryptionKey } = require('../server/services/backupEncryption');

test('encrypted backups authenticate and round-trip without a readable database or a reused nonce', () => {
  const dump = { tables: { users: [{ email: 'synthetic@example.test', password_hash: 'synthetic-private-hash' }] } };
  const gzip = zlib.gzipSync(JSON.stringify(dump));
  const first = encryptBackup(gzip),
    second = encryptBackup(gzip);
  assert.notDeepEqual(first, second);
  assert.equal(first.includes(Buffer.from('synthetic-private-hash')), false);
  assert.equal(first.includes(gzip), false);
  assert.deepEqual(JSON.parse(zlib.gunzipSync(decryptBackup(first))), dump);
  assert.deepEqual(decryptBackup(second), gzip);
});
test('missing, malformed and incorrect keys never produce a readable backup', () => {
  for (const value of ['', 'short', {}, Buffer.alloc(32, 1).toString('hex')]) {
    assert.throws(() => encryptionKey(value), /key is missing or invalid/);
  }
  const encrypted = encryptBackup(Buffer.from('private payload'));
  assert.throws(() => decryptBackup(encrypted, Buffer.alloc(32, 2).toString('base64')), /authentication failed/);
});
test('modified header, nonce, authentication tag, ciphertext or truncated files fail closed', () => {
  const encrypted = encryptBackup(Buffer.from('private payload'));
  for (const offset of [0, 8, 20, encrypted.length - 1]) {
    const modified = Buffer.from(encrypted);
    modified[offset] ^= 1;
    assert.throws(() => decryptBackup(modified), /format|authentication failed/);
  }
  assert.throws(() => decryptBackup(encrypted.subarray(0, 20)), /format/);
});
