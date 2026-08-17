#!/usr/bin/env node
'use strict';

// Safe restore utility for the independent status database.
//
// Without --confirm this only validates and summarizes the backup. The
// confirmed path is intentionally explicit because it replaces status history
// in the database selected by STATUS_TURSO_DB_URL/TURSO_DB_URL.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { restoreStatusTables } = require('./server/services/statusDbBackup');

async function main() {
  const args = process.argv.slice(2);
  const filePath = args.find((arg) => !arg.startsWith('--'));
  const confirm = args.includes('--confirm');
  if (!filePath) {
    console.error('Usage: node restoreStatusDb.js <backup.json.gz> [--confirm]');
    process.exit(1);
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error('File not found: ' + resolved);
    process.exit(1);
  }
  const dump = JSON.parse(zlib.gunzipSync(fs.readFileSync(resolved)).toString('utf8'));
  const result = await restoreStatusTables(dump, { confirm });
  console.log(JSON.stringify(result, null, 2));
  if (result.dryRun) {
    console.log(
      '\nDRY RUN — no status data was changed. Re-run with --confirm only after verifying the target database.'
    );
  }
}

main().catch((err) => {
  console.error('[restoreStatusDb] FAILED:', err.message);
  process.exit(1);
});
