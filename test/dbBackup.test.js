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
const zlib = require('zlib');
const dbBackup = require('../server/services/dbBackup');
const { runBackupTick, dumpTables } = dbBackup;
const { issueToken } = require('../server/services/auth');
const adminRouter = require('../server/routes/admin');

// checkToken only accepts a JWT belonging to ADMIN_EMAIL ('admin@test.local',
// set in testEnv), so every test needing admin auth must reuse that exact
// user rather than inserting a fresh email each time (email is UNIQUE).
async function getAdminToken() {
  let adminUser = await db.prepare('SELECT * FROM users WHERE email = ?').get('admin@test.local');
  if (!adminUser) {
    const result = await db.prepare('INSERT INTO users (email, is_verified) VALUES (?, 1)').run('admin@test.local');
    adminUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  }
  return issueToken(adminUser);
}

function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/', adminRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('dumpTables includes every user-facing and operational table, not just the original short list', async () => {
  const dump = await dumpTables();
  const expected = [
    'users',
    'watchlist',
    'watchlist_alerts',
    'pilot_allowlist',
    'push_subscriptions',
    'feedback',
    'coupons',
    'scheduled_scans',
    'chat_messages',
    'notifications',
    'admin_audit_log',
    'processed_webhook_events',
    'site_visits',
    'app_meta',
  ];
  for (const table of expected) {
    assert.ok(table in dump.tables, `backup must include the ${table} table`);
  }
  // otp_codes is deliberately excluded — every row is expired garbage
  // within 15 minutes, so backing it up would never be useful.
  assert.ok(!('otp_codes' in dump.tables));
});

test('runBackupTick refuses to send an oversized attachment and alerts the admin instead of failing silently', async (t) => {
  const sendMail = mock.fn(async () => ({}));
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail }));
  // Force the gzip step to report an oversized payload without actually
  // having to insert 20MB+ of rows into the test DB.
  t.mock.method(zlib, 'gzipSync', () => Buffer.alloc(21 * 1024 * 1024));

  await assert.rejects(runBackupTick(), /too large/i);

  assert.strictEqual(sendMail.mock.callCount(), 1, 'must still notify the admin, just without the attachment');
  const call = sendMail.mock.calls[0].arguments[0];
  assert.match(call.subject, /FAILED/);
  assert.strictEqual(call.attachments, undefined, 'the oversized attachment itself must not be sent');
});

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

test('POST /admin/api/backup/run-now sends a backup on demand and records it', async (t) => {
  const sendMail = mock.fn(async () => ({}));
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail }));

  const token = await getAdminToken();

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/admin/api/backup/run-now`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(sendMail.mock.callCount(), 1);
  } finally {
    server.close();
  }
});

test('POST /admin/api/backup/run-now surfaces the real send error instead of failing silently', async (t) => {
  const sendMail = mock.fn(async () => {
    throw new Error('Invalid login: 535-5.7.8 Username and Password not accepted');
  });
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail }));

  const token = await getAdminToken();

  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/admin/api/backup/run-now`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.strictEqual(res.status, 500);
    const body = await res.json();
    assert.match(body.error, /Invalid login/);
  } finally {
    server.close();
  }
});

test('POST /admin/api/backup/run-now rejects an unauthenticated request', async () => {
  const server = await startTestApp();
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/admin/api/backup/run-now`, { method: 'POST' });
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
  }
});
