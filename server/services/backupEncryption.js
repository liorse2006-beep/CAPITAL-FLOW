'use strict';
const crypto = require('node:crypto');

// Versioned binary envelope: authenticated magic, unique 96-bit nonce,
// 128-bit GCM tag, then ciphertext. Keys never travel with the attachment.
const MAGIC = Buffer.from('CFBK1\r\n', 'ascii');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function encryptionKey(value = process.env.BACKUP_ENCRYPTION_KEY) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error('Backup encryption key is missing or invalid.');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new Error('Backup encryption key is missing or invalid.');
  }
  return key;
}
function isEncryptedBackup(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= MAGIC.length && bytes.subarray(0, MAGIC.length).equals(MAGIC);
}
function encryptBackup(compressed, keyValue) {
  if (!Buffer.isBuffer(compressed)) throw new Error('Backup input must be a buffer.');
  const key = encryptionKey(keyValue);
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ciphertext]);
}
function decryptBackup(envelope, keyValue) {
  const key = encryptionKey(keyValue);
  const headerBytes = MAGIC.length + NONCE_BYTES + TAG_BYTES;
  if (!isEncryptedBackup(envelope) || envelope.length <= headerBytes) {
    throw new Error('Invalid encrypted backup format.');
  }
  try {
    const nonce = envelope.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES);
    const tag = envelope.subarray(MAGIC.length + NONCE_BYTES, headerBytes);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(tag);
    // No plaintext is returned unless final() authenticates the complete file.
    return Buffer.concat([decipher.update(envelope.subarray(headerBytes)), decipher.final()]);
  } catch {
    throw new Error('Backup authentication failed. The key is incorrect or the file was modified.');
  }
}
module.exports = { encryptBackup, decryptBackup, encryptionKey, isEncryptedBackup };
