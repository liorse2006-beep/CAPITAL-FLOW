// The application database backup must still leave the container when the
// optional Gmail SMTP account is absent. This test keeps the provider call
// fully local: the Resend HTTP request is intercepted before the service is
// loaded, and no real message is sent.
process.env.GMAIL_USER = '';
process.env.GMAIL_APP_PASSWORD = '';
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.RESEND_FROM_EMAIL = 'Capital Flow <backup@test.local>';

require('./helpers/testEnv');

const { test, before } = require('node:test');
const assert = require('node:assert/strict');

const resendRequests = [];
const originalFetch = global.fetch;
global.fetch = async (url, init) => {
  resendRequests.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
  return new Response(JSON.stringify({ id: 'backup-email-test' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const db = require('../server/db');
const { runBackupTick } = require('../server/services/dbBackup');

before(async () => {
  await db.ready;
});

test('application backup falls back to Resend when Gmail is not configured', async () => {
  resendRequests.length = 0;
  await runBackupTick();

  assert.equal(resendRequests.length, 1);
  assert.equal(resendRequests[0].url, 'https://api.resend.com/emails');
  assert.equal(resendRequests[0].body.to, 'admin@test.local');
  assert.match(resendRequests[0].body.subject, /Application database backup/);
  assert.equal(resendRequests[0].body.attachments.length, 1);
  assert.match(resendRequests[0].body.attachments[0].filename, /capital-flow-backup-\d{4}-\d{2}-\d{2}\.json\.gz/);

  const marker = await db.prepare("SELECT value FROM app_meta WHERE key = 'last_backup_at'").get();
  assert.ok(marker && Number(marker.value) > 0, 'successful fallback delivery must update backup freshness');
});

test.after(() => {
  global.fetch = originalFetch;
});
