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
// otp_codes is deliberately excluded — every row expires within 15 minutes
// (see services/auth.js), so a backed-up copy is always stale garbage by
// the time anyone would ever restore it. Every other user-facing or
// operationally-relevant table is included: a restore that silently drops
// starred watchlists, chat history, in-app notifications, the admin audit
// trail, or the webhook idempotency ledger (risking a replayed Whop event
// being reprocessed after restore) is not actually a usable backup.
const TABLES = [
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

// Gmail rejects attachments over 25MB — silently, from this app's point of
// view (sendMail rejects, the generic catch in runBackupTick's caller just
// logs it, and nobody notices the backup stopped actually happening). Warn
// well under that ceiling instead of finding out at the worst possible time.
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

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

  if (gzipped.length > MAX_ATTACHMENT_BYTES) {
    // Send a loud failure notice instead of letting sendMail reject the
    // oversized attachment silently — an admin who never gets an email at
    // all has no way to know backups quietly stopped working.
    await transport.sendMail({
      from: `"Capital Flow" <${GMAIL_USER}>`,
      to,
      subject: `⚠️ Capital Flow — DB backup ${dateStr} FAILED (too large to email)`,
      text: `The gzipped backup is ${(gzipped.length / 1024 / 1024).toFixed(1)}MB, over the ${(MAX_ATTACHMENT_BYTES / 1024 / 1024).toFixed(0)}MB safety threshold this app enforces (Gmail itself caps attachments at 25MB). No backup was sent today. This app needs a real backup destination (cloud storage) now that the database has outgrown email-based backups — restoreDb.js and the email flow can no longer be the whole story.`,
    });
    throw new Error(`Backup too large to email: ${gzipped.length} bytes`);
  }

  await transport.sendMail({
    from: `"Capital Flow" <${GMAIL_USER}>`,
    to,
    subject: `Capital Flow — DB backup ${dateStr}`,
    text: `Automated daily backup. ${TABLES.length} tables, ${gzipped.length} bytes gzipped. Restore with: node restoreDb.js capital-flow-backup-${dateStr}.json.gz --confirm`,
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
