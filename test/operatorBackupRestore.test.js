const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { guard, childEnvironment, childProgram } = require('../scripts/operator-backup-restore.cjs');
const key = Buffer.alloc(32, 0x42).toString('base64');
const options = {
  expectedRelease: 'a'.repeat(40),
  expectedServiceId: 'srv-synthetic',
  expectedAdminEmail: 'admin@test.local',
  expectedKeyFingerprint: crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex'),
};
const environment = {
  RENDER_GIT_COMMIT: options.expectedRelease,
  RENDER_SERVICE_ID: options.expectedServiceId,
  ADMIN_EMAIL: options.expectedAdminEmail,
  GMAIL_USER: 'synthetic@test.local',
  GMAIL_APP_PASSWORD: 'synthetic-only',
  TURSO_DB_URL: 'libsql://synthetic.test.local',
  BACKUP_ENCRYPTION_KEY: key,
};
test('operator recovery refuses a changed service, release, recipient, key or database topology before reading data', () => {
  assert.doesNotThrow(() => guard(options, environment));
  for (const change of [
    { RENDER_GIT_COMMIT: 'b'.repeat(40) },
    { RENDER_SERVICE_ID: 'srv-other' },
    { ADMIN_EMAIL: 'other@test.local' },
    { BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') },
    { DATABASE_URL: 'file:/app/data/users.db' },
    { GMAIL_USER: '' },
  ])
    assert.throws(() => guard(options, { ...environment, ...change }));
});
test('temporary restore receives only isolated file credentials and cannot inherit production access', () => {
  const result = childEnvironment('/tmp/cf-recovery-ABC123', key, {
    PATH: '/synthetic/bin',
    DATABASE_URL: 'private',
    TURSO_AUTH_TOKEN: 'private',
    GMAIL_APP_PASSWORD: 'private',
    WHOP_API_KEY: 'private',
  });
  assert.equal(result.DATABASE_URL, '');
  assert.equal(result.TURSO_DB_URL, 'file:/tmp/cf-recovery-ABC123/recovered.db');
  for (const name of ['TURSO_AUTH_TOKEN', 'GMAIL_APP_PASSWORD', 'RESEND_API_KEY', 'WHOP_API_KEY'])
    assert.equal(result[name], '');
  for (const invalid of ['/app', '/tmp/cf-recovery-ABC123/../other', '/tmp/other'])
    assert.throws(() => childEnvironment(invalid, key));
  const child = childProgram('/app', '/tmp/cf-recovery-ABC123');
  assert.match(child, /Socket\.prototype\.connect=deny/);
  assert.match(child, /exactTableHashesMatch:true/);
  assert.doesNotMatch(child, /private|GMAIL_APP_PASSWORD/);
});
