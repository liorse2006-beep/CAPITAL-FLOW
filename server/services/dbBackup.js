const zlib = require('zlib');
const nodemailer = require('nodemailer');
const db = require('../db');
const { GMAIL_USER, GMAIL_APP_PASSWORD, ADMIN_EMAIL, RESEND_API_KEY } = require('../config');
const { reportError } = require('../utils/reportError');
const { sendApplicationBackupEmail, sendApplicationBackupFailureEmail } = require('./email');

// Render's filesystem is ephemeral — anything written to disk there is gone
// on the next deploy or restart, so a backup can only be useful if it leaves
// the container. There's no cloud-storage account configured for this app,
// so the weekly backup is gzipped and emailed to the admin's own inbox as an
// attachment. Gmail SMTP is preferred when configured; the transactional
// Resend sender is a safe fallback, so backup delivery does not silently
// disappear just because the operator did not create a second mail account.
// GMAIL_USER/GMAIL_APP_PASSWORD are therefore optional when RESEND_API_KEY
// and ADMIN_EMAIL are present.
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
  if ((!transport && !RESEND_API_KEY) || !to) return; // not configured — nothing to send to

  const dump = await dumpTables();
  const json = JSON.stringify(dump, null, 2);
  const gzipped = zlib.gzipSync(json);
  const dateStr = dump.createdAt.slice(0, 10);

  if (gzipped.length > MAX_ATTACHMENT_BYTES) {
    // Send a loud failure notice instead of letting sendMail reject the
    // oversized attachment silently — an admin who never gets an email at
    // all has no way to know backups quietly stopped working.
    if (transport) {
      await transport.sendMail({
        from: `"Capital Flow" <${GMAIL_USER}>`,
        to,
        subject: `⚠️ Capital Flow — DB backup ${dateStr} FAILED (too large to email)`,
        text: `The gzipped backup is ${(gzipped.length / 1024 / 1024).toFixed(1)}MB, over the ${(MAX_ATTACHMENT_BYTES / 1024 / 1024).toFixed(0)}MB safety threshold this app enforces (Gmail itself caps attachments at 25MB). No backup was sent today. This app needs a real backup destination (cloud storage) now that the database has outgrown email-based backups — restoreDb.js and the email flow can no longer be the whole story.`,
      });
    } else {
      await sendApplicationBackupFailureEmail({
        recipient: to,
        date: dateStr,
        bytes: gzipped.length,
        maxBytes: MAX_ATTACHMENT_BYTES,
      });
    }
    throw new Error(`Backup too large to email: ${gzipped.length} bytes`);
  }

  const filename = `capital-flow-backup-${dateStr}.json.gz`;
  if (transport) {
    await transport.sendMail({
      from: `"Capital Flow" <${GMAIL_USER}>`,
      to,
      subject: `Capital Flow — DB backup ${dateStr}`,
      text: `Automated weekly backup. ${TABLES.length} tables, ${gzipped.length} bytes gzipped. Restore with: node restoreDb.js ${filename} --confirm`,
      attachments: [{ filename, content: gzipped }],
    });
  } else {
    await sendApplicationBackupEmail({
      recipient: to,
      filename,
      content: gzipped,
      tableCount: TABLES.length,
      createdAt: dump.createdAt,
    });
  }

  // Only reached once the email actually sent — a failed send (bad creds,
  // Gmail rate limit, etc.) leaves the previous timestamp in place, so the
  // admin panel's staleness badge reflects reality instead of resetting on
  // every attempt regardless of success.
  await db
    .prepare(
      "INSERT INTO app_meta (key, value) VALUES ('last_backup_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(String(Math.floor(Date.now() / 1000)));
}

function startScheduledBackup() {
  const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly poll is plenty for a once-a-week job
  const STARTUP_DELAY_MS = 2 * 60 * 1000; // let the DB/config finish settling after boot
  const MIN_GAP_MS = 6 * 24 * 60 * 60 * 1000; // guards against a second send within the same Sunday

  async function maybeRunBackup() {
    try {
      // Every redeploy restarts this process, so "run once on boot" (the old
      // behavior) sent a fresh backup email on every push — the actual
      // complaint that led to this weekly schedule. Checking wall-clock day
      // instead of process uptime makes the schedule survive redeploys.
      const isSunday = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).getDay() === 0;
      if (!isSunday) return;

      const row = await db.prepare("SELECT value FROM app_meta WHERE key = 'last_backup_at'").get();
      const lastBackupMs = row ? Number(row.value) * 1000 : 0;
      if (Date.now() - lastBackupMs < MIN_GAP_MS) return; // already sent this week

      await runBackupTick();
    } catch (err) {
      reportError(err, '[dbBackup]');
    }
  }

  setTimeout(maybeRunBackup, STARTUP_DELAY_MS);
  setInterval(maybeRunBackup, CHECK_INTERVAL_MS);
}

module.exports = { dumpTables, runBackupTick, startScheduledBackup };
