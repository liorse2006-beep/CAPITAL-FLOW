const zlib = require('zlib');
const nodemailer = require('nodemailer');
const db = require('../db');
const { GMAIL_USER, GMAIL_APP_PASSWORD, ADMIN_EMAIL } = require('../config');

// Render's filesystem is ephemeral — anything written to disk there is gone
// on the next deploy or restart, so a backup can only be useful if it leaves
// the container. There's no cloud-storage account configured for this app,
// so daily backups are gzipped and emailed to the admin's own inbox as an
// attachment via a plain Gmail SMTP account instead of standing up a new
// service. This is a SEPARATE set of credentials from RESEND_API_KEY (used
// for OTP/welcome emails in server/services/email.js) — GMAIL_USER and
// GMAIL_APP_PASSWORD must be set on their own for this feature to work.
const TABLES = ['users', 'watchlist_alerts', 'pilot_allowlist', 'push_subscriptions', 'feedback', 'coupons', 'scheduled_scans'];

function createTransport() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
}

async function dumpTables() {
  const dump = { createdAt: new Date().toISOString(), tables: {} };
  for (const table of TABLES) {
    dump.tables[table] = await db.prepare(`SELECT * FROM ${table}`).all();
  }
  return dump;
}

async function runBackupTick() {
  const transport = createTransport();
  const to = ADMIN_EMAIL;
  if (!transport || !to) return; // not configured — nothing to send to

  const dump = await dumpTables();
  const json = JSON.stringify(dump, null, 2);
  const gzipped = zlib.gzipSync(json);
  const dateStr = dump.createdAt.slice(0, 10);

  await transport.sendMail({
    from: `"Capital Flow" <${GMAIL_USER}>`,
    to,
    subject: `Capital Flow — DB backup ${dateStr}`,
    text: `Automated daily backup. ${TABLES.length} tables, ${gzipped.length} bytes gzipped. Restore by ungzipping the attachment and reading the JSON.`,
    attachments: [
      {
        filename: `capital-flow-backup-${dateStr}.json.gz`,
        content: gzipped,
      },
    ],
  });

  // Only reached once the email actually sent — a failed send (bad creds,
  // Gmail rate limit, etc.) leaves the previous timestamp in place, so the
  // admin panel's staleness badge reflects reality instead of resetting on
  // every attempt regardless of success.
  await db
    .prepare("INSERT INTO app_meta (key, value) VALUES ('last_backup_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(Math.floor(Date.now() / 1000)));
}

function startScheduledBackup() {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const STARTUP_DELAY_MS = 2 * 60 * 1000; // let the DB/config finish settling after boot
  // A pure 24h setInterval never fires on Render's free tier: the instance
  // spins down after 15 min idle and every redeploy restarts the process,
  // resetting the countdown before it reaches 24h. Also run once shortly
  // after boot so a backup actually goes out on every deploy/restart, not
  // only on the (rare here) occasion the process stays up a full day.
  setTimeout(function () {
    runBackupTick().catch(function (err) {
      console.error('[dbBackup]', err);
    });
  }, STARTUP_DELAY_MS);
  setInterval(function () {
    runBackupTick().catch(function (err) {
      console.error('[dbBackup]', err);
    });
  }, ONE_DAY_MS);
}

module.exports = { dumpTables, runBackupTick, startScheduledBackup };
