#!/usr/bin/env node
// Restores a database dump produced by server/services/dbBackup.js
// (the .json.gz attachment emailed daily to ADMIN_EMAIL).
//
// This did not exist before — the backup email told the admin to "ungzip
// the attachment and read the JSON", with no actual tooling to put that
// data back into the database during a real incident. Hand-writing SQL
// under pressure while production is down is exactly how a bad restore
// makes things worse.
//
// Usage:
//   node restoreDb.js path/to/capital-flow-backup-2026-01-01.json.gz --confirm
//
// Without --confirm, this only prints what it WOULD do and exits — this is
// a destructive operation (wipes and replaces every row in every table the
// backup contains) and must never run by accident. Connects through the
// same server/db abstraction the app itself uses, so it targets whichever
// database TURSO_DB_URL/TURSO_AUTH_TOKEN in the environment point at —
// double-check those before running this against production.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  const confirmed = args.includes('--confirm');
  const filePath = args.find((a) => !a.startsWith('--'));

  if (!filePath) {
    console.error('Usage: node restoreDb.js <path-to-backup.json.gz> [--confirm]');
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  console.log(`Reading ${resolved} ...`);
  const gzipped = fs.readFileSync(resolved);
  const json = zlib.gunzipSync(gzipped).toString('utf8');
  const dump = JSON.parse(json);

  const tables = Object.keys(dump.tables || {});
  if (tables.length === 0) {
    console.error('This backup file contains no tables — nothing to restore.');
    process.exit(1);
  }

  console.log(`Backup created at: ${dump.createdAt}`);
  console.log(`Tables in this backup (${tables.length}):`);
  for (const table of tables) {
    console.log(`  - ${table}: ${dump.tables[table].length} row(s)`);
  }

  if (!confirmed) {
    console.log('\nDRY RUN — no changes made. This will DELETE every row currently in each');
    console.log('table listed above and replace it with the rows from this backup, on');
    console.log('whichever database TURSO_DB_URL currently points at. Re-run with --confirm');
    console.log('to actually perform the restore.');
    process.exit(0);
  }

  // Required only now, after the dry-run summary already printed — a typo
  // in the filepath arg shouldn't force loading DB config unnecessarily.
  const db = require('./server/db');
  await db.ready;

  console.log('\n--confirm passed. Restoring now...');
  for (const table of tables) {
    const rows = dump.tables[table];
    await db.prepare(`DELETE FROM ${table}`).run();
    for (const row of rows) {
      const columns = Object.keys(row);
      if (columns.length === 0) continue;
      const placeholders = columns.map(() => '?').join(', ');
      const values = columns.map((c) => row[c]);
      await db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
    }
    console.log(`  ✓ Restored ${table}: ${rows.length} row(s)`);
  }

  console.log('\nRestore complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[restoreDb] FAILED:', err);
  process.exit(1);
});
