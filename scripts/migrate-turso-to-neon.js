'use strict';

// One-time, non-destructive-by-default migration helper. It reads the current
// Turso application database, writes only the user-facing application tables
// into the already-created Neon target, and verifies row counts plus a
// deterministic content digest for every transferred table. Status-service
// tables are intentionally excluded because that service has an independent
// database contract and must be migrated only with its own source credentials.
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createClient } = require('@libsql/client');
const { BACKUP_TABLES } = require('../server/services/backupTables');
const { createPostgresDatabase } = require('../server/db/postgres');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function readNeonUrlFromClipboard() {
  const clipboard = execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], {
    encoding: 'utf8',
  });
  const line = clipboard.split(/\r?\n/).find((value) => /postgres(?:ql)?:\/\//i.test(value));
  const match = line && line.match(/postgres(?:ql)?:\/\/[^"'`\s]+/i);
  if (!match) throw new Error('Neon connection string is not available in the clipboard.');
  return match[0];
}

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error('Unsafe migration identifier.');
  return `"${identifier}"`;
}

function normalizeValue(value) {
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : String(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  return value;
}

function normalizeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeValue(value)]));
}

function canonicalize(value) {
  if (Buffer.isBuffer(value)) return { type: 'buffer', value: value.toString('base64') };
  if (value === undefined) return { type: 'undefined' };
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function digestRows(rows) {
  const canonicalRows = rows.map(canonicalize).sort((left, right) => {
    const a = JSON.stringify(left);
    const b = JSON.stringify(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return crypto.createHash('sha256').update(JSON.stringify(canonicalRows)).digest('hex');
}

async function readSourceDump(source, tables) {
  const dump = { createdAt: new Date().toISOString(), tables: {} };
  for (const table of tables) {
    const result = await source.execute(`SELECT * FROM ${quoteIdentifier(table)}`);
    dump.tables[table] = result.rows.map(normalizeRow);
  }
  return dump;
}

async function readTargetRows(target, table) {
  return target.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all();
}

async function summarize(dump, target) {
  const summary = [];
  for (const table of BACKUP_TABLES) {
    const sourceRows = dump?.tables?.[table] || [];
    const targetRows = target ? await readTargetRows(target, table) : [];
    summary.push({
      table,
      sourceRows: sourceRows.length,
      targetRows: target ? targetRows.length : null,
      sourceDigest: digestRows(sourceRows),
      targetDigest: target ? digestRows(targetRows) : null,
    });
  }
  return summary;
}

function printSummary(summary, phase) {
  const total = summary.reduce((sum, row) => sum + row.sourceRows, 0);
  const targetTotal = summary.reduce((sum, row) => sum + (row.targetRows || 0), 0);
  console.log(`${phase} tables=${summary.length} source_rows=${total} target_rows=${targetTotal}`);
  for (const row of summary) {
    const digestStatus =
      row.targetDigest == null ? '' : row.sourceDigest === row.targetDigest ? ' digest=match' : ' digest=MISMATCH';
    console.log(`  ${row.table}: source=${row.sourceRows} target=${row.targetRows ?? 'not-checked'}${digestStatus}`);
  }
}

async function main() {
  const confirmed = process.argv.includes('--confirm');
  const sourceUrl = String(process.env.TURSO_DB_URL || '').trim();
  const sourceToken = String(process.env.TURSO_AUTH_TOKEN || '').trim();
  if (!sourceUrl || !sourceToken)
    throw new Error('The source Turso URL/token is not configured in the local environment.');

  const neonUrl = readNeonUrlFromClipboard();
  const source = createClient({ url: sourceUrl, authToken: sourceToken });
  const target = createPostgresDatabase(neonUrl);
  try {
    const dump = await readSourceDump(source, BACKUP_TABLES);
    const sourceSummary = await summarize(dump, null);
    printSummary(sourceSummary, 'SOURCE_SNAPSHOT');
    if (!confirmed) {
      console.log('DRY_RUN no target rows changed; rerun with --confirm after reviewing the source snapshot.');
      return;
    }

    // The application database module owns schema initialization and restore
    // validation. Point it at the same Neon target only after the source
    // snapshot is complete and the explicit confirmation flag is present.
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = neonUrl;
    process.env.JWT_SECRET = 'isolated-neon-migration-validation-placeholder-32';
    process.env.SESSION_SECRET = 'isolated-neon-migration-validation-placeholder-32';
    const db = require('../server/db');
    const { restoreDump } = require('../restoreDb');
    await db.ready;
    const result = await restoreDump(db, dump);
    const targetSummary = await summarize(dump, db);
    printSummary(targetSummary, 'POST_RESTORE_VERIFY');
    const mismatches = targetSummary.filter(
      (row) => row.sourceRows !== row.targetRows || row.sourceDigest !== row.targetDigest
    );
    if (mismatches.length) throw new Error(`Migration verification failed for ${mismatches.length} table(s).`);
    console.log(`MIGRATION_OK restored_tables=${result.tables.length} restored_statements=${result.statementCount}`);
    await db.close();
  } finally {
    await target.close();
    if (typeof source.close === 'function') source.close();
  }
}

main().catch((error) => {
  const message = String(error?.message || error).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED]');
  console.error(`MIGRATION_FAILED ${message}`);
  process.exitCode = 1;
});
