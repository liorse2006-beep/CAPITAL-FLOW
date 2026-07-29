// Daily DB backup (server/services/dbBackup.js) + its staleness indicator in
// the admin panel (GET /admin/api/backup-status). Gmail creds must be set
// before config.js is first required (it reads them at module-load time).
process.env.GMAIL_USER = 'backup-test@test.local';
process.env.GMAIL_APP_PASSWORD = 'app-password-placeholder';

require('./helpers/testEnv');
const { test, before, mock } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('../server/db');

before(async () => {
  await db.ready;
});

const nodemailer = require('nodemailer');
const { runBackupTick } = require('../server/services/dbBackup');
const { issueToken } = require('../server/services/auth');
const adminRouter = require('../server/routes/admin');

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/', adminRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('runBackupTick records last_backup_at in app_meta on a successful send', async (t) => {
  const sendMail = mock.fn(async () => ({}));
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail }));

  const before = await db.prepare("SELECT value FROM app_meta WHERE key = 'last_backup_at'").get();

  await runBackupTick();

  assert.strictEqual(sendMail.mock.callCount(), 1);
  const after = await db.prepare("SELECT value FROM app_meta WHERE key = 'last_backup_at'").get();
  assert.ok(after, 'last_backup_at should now be recorded');
  const nowSec = Math.floor(Date.now() / 1000);
  assert.ok(Number(after.value) <= nowSec && Number(after.value) > nowSec - 10, 'timestamp should be roughly now');
  if (before) assert.notStrictEqual(after.value, before.value);
});

test('runBackupTick leaves the previous timestamp in place when the send fails', async (t) => {
  const sendMail = mock.fn(async () => {
    throw new Error('gmail rejected');
  });
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail }));

  const before = await db.prepare("SELECT value FROM app_meta WHERE key = 'last_backup_at'").get();
  await assert.rejects(runBackupTick());
  const after = await db.prepare("SELECT value FROM app_meta WHERE key = 'last_backup_at'").get();
  assert.strictEqual(after.value, before.value, 'a failed send must not overwrite the last successful timestamp');
});

test('GET /admin/api/backup-status reports a numeric lastBackupAt once a backup has run', async (t) => {
  const sendMail = mock.fn(async () => ({}));
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail }));

  const result = await db.prepare('INSERT INTO users (email, is_verified) VALUES (?, 1)').run('admin@test.local');
  const adminUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = await issueToken(adminUser);

  await runBackupTick();

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const data = await fetch(`http://localhost:${port}/admin/api/backup-status`, {
      headers: { Authorization: 'Bearer ' + token },
    }).then((r) => r.json());
    assert.strictEqual(typeof data.lastBackupAt, 'number');
  } finally {
    server.close();
  }
});

test('GET /admin/api/backup-status rejects an unauthenticated request', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/admin/api/backup-status`);
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
  }
});
