'use strict';

const zlib = require('zlib');
const db = require('../db');
const {
  ADMIN_EMAIL,
  STATUS_ALERT_RECIPIENTS,
  STATUS_BACKUP_ENABLED,
  STATUS_BACKUP_INTERVAL_MS,
  STATUS_BACKUP_MAX_BYTES,
  STATUS_BACKUP_RECIPIENTS,
} = require('../config');
const { sendStatusBackupEmail } = require('./email');
const { reportError, safeErrorSummary } = require('../utils/reportError');

// This list is deliberately limited to the independent status database. It
// avoids copying application credentials or user data into an operations
// backup, while preserving everything needed to reconstruct status history,
// incidents, maintenance and alert delivery state.
const STATUS_TABLES = [
  'status_components',
  'status_checks',
  'status_incidents',
  'status_incident_updates',
  'status_notification_deliveries',
  'status_alert_recipients',
  'status_maintenance',
  'status_meta',
  'status_daily_rollups',
];
const STATUS_TABLE_SET = new Set(STATUS_TABLES);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function now() {
  return Math.floor(Date.now() / 1000);
}

function backupFilename(createdAt) {
  return 'capital-flow-status-backup-' + createdAt.slice(0, 10) + '.json.gz';
}

async function configuredRecipients() {
  const values = [
    ...(STATUS_BACKUP_RECIPIENTS || '').split(','),
    ...(STATUS_ALERT_RECIPIENTS || '').split(','),
    ADMIN_EMAIL || '',
  ];
  const stored = await db.prepare('SELECT email FROM status_alert_recipients WHERE active = 1').all();
  values.push(...stored.map((row) => row.email));
  return [
    ...new Set(
      values.map((value) =>
        String(value || '')
          .trim()
          .toLowerCase()
      )
    ),
  ].filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

async function setMeta(key, value) {
  await db
    .prepare(
      'INSERT INTO status_meta (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    )
    .run(key, String(value), now());
}

async function dumpStatusTables() {
  await db.ready;
  const dump = { createdAt: new Date().toISOString(), tables: {} };
  for (const table of STATUS_TABLES) {
    dump.tables[table] = await db.prepare('SELECT * FROM ' + table).all();
  }
  return dump;
}

function encodeStatusBackup(dump) {
  const json = JSON.stringify(dump, null, 2);
  return zlib.gzipSync(json);
}

async function runStatusBackup({ send = sendStatusBackupEmail } = {}) {
  if (!STATUS_BACKUP_ENABLED) return { status: 'disabled' };
  await db.ready;
  const attemptedAt = now();
  await setMeta('status_backup_last_attempt_at', attemptedAt);
  const recipients = await configuredRecipients();
  if (!recipients.length) {
    const error = 'No status backup recipients are configured.';
    await setMeta('status_backup_last_error', error);
    await setMeta('status_backup_status', 'failed');
    throw new Error(error);
  }

  const dump = await dumpStatusTables();
  const content = encodeStatusBackup(dump);
  const filename = backupFilename(dump.createdAt);
  if (content.length > STATUS_BACKUP_MAX_BYTES) {
    const error = 'Status backup exceeds the configured attachment limit.';
    await setMeta('status_backup_last_error', error);
    await setMeta('status_backup_status', 'failed');
    throw new Error(error);
  }

  const errors = [];
  for (const recipient of recipients) {
    try {
      await send({
        recipient,
        filename,
        content,
        tableCount: STATUS_TABLES.length,
        createdAt: dump.createdAt,
      });
    } catch (err) {
      errors.push(recipient + ': ' + safeErrorSummary(err));
    }
  }
  if (errors.length) {
    await setMeta('status_backup_last_error', errors.join(' | '));
    await setMeta('status_backup_status', 'failed');
    throw new Error('Status backup delivery failed for one or more recipients.');
  }

  await setMeta('status_backup_last_success_at', attemptedAt);
  await setMeta('status_backup_last_size_bytes', content.length);
  await setMeta('status_backup_last_filename', filename);
  await setMeta('status_backup_last_tables', STATUS_TABLES.length);
  await setMeta('status_backup_last_error', '');
  await setMeta('status_backup_status', 'success');
  return { status: 'success', filename, bytes: content.length, recipients, tables: STATUS_TABLES.length, dump };
}

async function maybeRunStatusBackup() {
  await db.ready;
  const row = await db.prepare("SELECT value FROM status_meta WHERE key = 'status_backup_last_success_at'").get();
  const last = Number(row?.value || 0);
  if (last && now() - last < Math.floor(STATUS_BACKUP_INTERVAL_MS / 1000)) return { status: 'not_due' };
  return runStatusBackup();
}

function startScheduledStatusBackup() {
  if (!STATUS_BACKUP_ENABLED) return null;
  const run = () => maybeRunStatusBackup().catch((err) => reportError(err, '[status database backup]'));
  const startup = setTimeout(run, 30 * 1000);
  startup.unref();
  const interval = setInterval(run, Math.min(60 * 60 * 1000, STATUS_BACKUP_INTERVAL_MS));
  interval.unref();
  return { startup, interval };
}

function validateDump(dump) {
  if (!dump || typeof dump !== 'object' || !dump.tables || typeof dump.tables !== 'object') {
    throw new Error('Invalid status backup format.');
  }
  const tables = Object.keys(dump.tables);
  if (!tables.length || tables.some((table) => !STATUS_TABLE_SET.has(table))) {
    throw new Error('Backup contains an unsupported status table.');
  }
  for (const table of tables) {
    if (!Array.isArray(dump.tables[table])) throw new Error('Backup table is not an array: ' + table);
    for (const row of dump.tables[table]) {
      const keys = row && typeof row === 'object' ? Object.keys(row) : [];
      if (!row || typeof row !== 'object' || keys.length === 0 || keys.some((key) => !IDENTIFIER.test(key))) {
        throw new Error('Backup contains an invalid row in: ' + table);
      }
    }
  }
  return tables;
}

function quoteIdentifier(identifier) {
  if (!IDENTIFIER.test(identifier)) throw new Error('Unsafe status-backup identifier: ' + identifier);
  return '"' + identifier + '"';
}

async function validateStatusSchema(tables, dump) {
  for (const table of tables) {
    const schemaRows = await db.prepare('PRAGMA table_info(' + quoteIdentifier(table) + ')').all();
    const schemaColumns = new Set(schemaRows.map((column) => column.name));
    if (schemaColumns.size === 0) throw new Error('Target database is missing status table: ' + table);
    for (const row of dump.tables[table]) {
      for (const column of Object.keys(row)) {
        if (!schemaColumns.has(column)) {
          throw new Error('Status backup contains unknown column: ' + table + '.' + column);
        }
      }
    }
  }
}

function buildStatusRestoreStatements(dump, tables) {
  const statements = [];
  for (const table of tables) {
    const quotedTable = quoteIdentifier(table);
    statements.push({ sql: 'DELETE FROM ' + quotedTable, args: [] });
    for (const row of dump.tables[table]) {
      const columns = Object.keys(row);
      const placeholders = columns.map(() => '?').join(', ');
      statements.push({
        sql:
          'INSERT INTO ' +
          quotedTable +
          ' (' +
          columns.map(quoteIdentifier).join(', ') +
          ') VALUES (' +
          placeholders +
          ')',
        args: columns.map((column) => row[column]),
      });
    }
  }
  return statements;
}

async function restoreStatusTables(dump, { confirm = false } = {}) {
  const tables = validateDump(dump);
  const summary = tables.map((table) => ({ table, rows: dump.tables[table].length }));
  if (!confirm) return { dryRun: true, createdAt: dump.createdAt || null, tables: summary };

  await db.ready;
  await validateStatusSchema(tables, dump);
  // Restore every selected operational table as one transaction. A malformed
  // or incompatible later row must never leave status history half-deleted.
  await db.transaction(buildStatusRestoreStatements(dump, tables));
  return { dryRun: false, createdAt: dump.createdAt || null, tables: summary };
}

module.exports = {
  STATUS_TABLES,
  dumpStatusTables,
  encodeStatusBackup,
  buildStatusRestoreStatements,
  maybeRunStatusBackup,
  restoreStatusTables,
  runStatusBackup,
  startScheduledStatusBackup,
};
