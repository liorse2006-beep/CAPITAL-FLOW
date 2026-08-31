#!/usr/bin/env node
// Restore a database dump produced by server/services/dbBackup.js.
//
// The confirmed operation is intentionally all-or-nothing: every DELETE and
// INSERT is sent through the shared libSQL write transaction. The default is a
// dry run, so opening a backup file can never mutate a database accidentally.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const { BACKUP_TABLES } = require('./server/services/backupTables');

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BACKUP_TABLE_SET = new Set(BACKUP_TABLES);

function quoteIdentifier(identifier) {
  if (!IDENTIFIER.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `"${identifier}"`;
}

function validateDump(dump) {
  if (!dump || typeof dump !== 'object' || Array.isArray(dump)) {
    throw new Error('Backup payload must be a JSON object');
  }
  if (!dump.tables || typeof dump.tables !== 'object' || Array.isArray(dump.tables)) {
    throw new Error('Backup payload does not contain a tables object');
  }

  const tables = Object.keys(dump.tables);
  if (tables.length === 0) throw new Error('This backup file contains no tables — nothing to restore.');
  for (const table of tables) {
    if (!BACKUP_TABLE_SET.has(table)) {
      throw new Error(`Backup contains a table outside the restore allowlist: ${table}`);
    }
    if (!Array.isArray(dump.tables[table])) {
      throw new Error(`Backup table ${table} must contain an array of rows`);
    }
    for (const row of dump.tables[table]) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`Backup table ${table} contains a non-object row`);
      }
      const columns = Object.keys(row);
      if (columns.length === 0) throw new Error(`Backup table ${table} contains an empty row`);
      for (const column of columns) quoteIdentifier(column);
    }
  }
  return tables;
}

async function validateSchema(db, tables, dump) {
  for (const table of tables) {
    const schemaRows = await db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
    const schemaColumns = new Set(schemaRows.map((column) => column.name));
    if (schemaColumns.size === 0) throw new Error(`Target database is missing table: ${table}`);
    for (const row of dump.tables[table]) {
      for (const column of Object.keys(row)) {
        if (!schemaColumns.has(column)) {
          throw new Error(`Backup table ${table} contains unknown column: ${column}`);
        }
      }
    }
  }
}

function buildRestoreStatements(dump, tables) {
  const statements = [];
  for (const table of tables) {
    const quotedTable = quoteIdentifier(table);
    statements.push({ sql: `DELETE FROM ${quotedTable}`, args: [] });
    for (const row of dump.tables[table]) {
      const columns = Object.keys(row);
      const quotedColumns = columns.map(quoteIdentifier).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      statements.push({
        sql: `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES (${placeholders})`,
        args: columns.map((column) => row[column]),
      });
    }
  }
  return statements;
}

async function restoreDump(db, dump) {
  const tables = validateDump(dump);
  await db.ready;
  await validateSchema(db, tables, dump);
  const statements = buildRestoreStatements(dump, tables);
  await db.transaction(statements);
  return { tables, statementCount: statements.length };
}

function readDumpFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  const gzipped = fs.readFileSync(resolved);
  return { resolved, dump: JSON.parse(zlib.gunzipSync(gzipped).toString('utf8')) };
}

async function main(argv = process.argv.slice(2)) {
  const confirmed = argv.includes('--confirm');
  const filePaths = argv.filter((arg) => !arg.startsWith('--'));
  if (filePaths.length !== 1) {
    throw new Error('Usage: node restoreDb.js <path-to-backup.json.gz> [--confirm]');
  }

  const { resolved, dump } = readDumpFile(filePaths[0]);
  const tables = validateDump(dump);
  console.log(`Reading ${resolved} ...`);
  console.log(`Backup created at: ${dump.createdAt || 'unknown'}`);
  console.log(`Tables in this backup (${tables.length}):`);
  for (const table of tables) console.log(`  - ${table}: ${dump.tables[table].length} row(s)`);

  if (!confirmed) {
    console.log('\nDRY RUN — no changes made. Re-run with --confirm only after verifying');
    console.log('the database target and the backup summary. The confirmed restore is atomic.');
    return;
  }

  // Loading the DB only after validation keeps dry-run and malformed-file
  // paths independent of production credentials and database availability.
  const db = require('./server/db');
  await restoreDump(db, dump);
  console.log('\nRestore complete (atomic transaction committed).');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[restoreDb] FAILED:', err.message || 'restore failed');
    process.exitCode = 1;
  });
}

module.exports = { BACKUP_TABLES, buildRestoreStatements, main, readDumpFile, restoreDump, validateDump };
