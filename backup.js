const fs   = require('fs');
const path = require('path');

const DB_PATH        = path.join(__dirname, 'data', 'users.db');
const BACKUP_DIR     = path.join(__dirname, 'data', 'backups');
const ONEDRIVE_DIR   = path.join('C:\\Users\\LiorSe\\OneDrive', 'CapitalFlow-Backups');
const MAX_LOCAL      = 48; // 48 hourly = 2 days
const MAX_ONEDRIVE   = 30; // 30 daily  = 1 month

if (!fs.existsSync(BACKUP_DIR))   fs.mkdirSync(BACKUP_DIR,   { recursive: true });
if (!fs.existsSync(ONEDRIVE_DIR)) fs.mkdirSync(ONEDRIVE_DIR, { recursive: true });

if (!fs.existsSync(DB_PATH)) {
  console.log('[backup] DB not found — skipping');
  process.exit(0);
}

// ── Local hourly backup ──────────────────────────────────────────────────────
const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const dest = path.join(BACKUP_DIR, `users-${ts}.db`);

try {
  fs.copyFileSync(DB_PATH, dest);
  console.log(`[backup] ✓ Local  → ${dest}`);

  const localFiles = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('users-') && f.endsWith('.db'))
    .sort();
  if (localFiles.length > MAX_LOCAL) {
    localFiles.slice(0, localFiles.length - MAX_LOCAL).forEach(f => {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
      console.log(`[backup] Pruned local: ${f}`);
    });
  }
} catch (err) {
  console.error('[backup] Local backup failed:', err.message);
  process.exit(1);
}

// ── OneDrive daily backup (overwrites same-day file, syncs to cloud) ─────────
try {
  const today         = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const cloudDest     = path.join(ONEDRIVE_DIR, `users-${today}.db`);
  fs.copyFileSync(DB_PATH, cloudDest);
  console.log(`[backup] ✓ OneDrive → ${cloudDest}`);

  const cloudFiles = fs.readdirSync(ONEDRIVE_DIR)
    .filter(f => f.startsWith('users-') && f.endsWith('.db'))
    .sort();
  if (cloudFiles.length > MAX_ONEDRIVE) {
    cloudFiles.slice(0, cloudFiles.length - MAX_ONEDRIVE).forEach(f => {
      fs.unlinkSync(path.join(ONEDRIVE_DIR, f));
      console.log(`[backup] Pruned OneDrive: ${f}`);
    });
  }
} catch (err) {
  // OneDrive failure is non-fatal — local backup already succeeded
  console.error('[backup] OneDrive backup failed:', err.message);
}
