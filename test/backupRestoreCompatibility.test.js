require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { encryptBackup } = require('../server/services/backupEncryption');
const { readDumpFile } = require('../restoreDb');

test('legacy gzip restores remain readable but encrypted filename aliases cannot accept plaintext', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-restore-compat-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const payload = { createdAt: '2026-10-11T00:00:00.000Z', tables: { users: [] } };
  const gzip = zlib.gzipSync(JSON.stringify(payload));
  const legacy = path.join(directory, 'legacy.json.gz');
  fs.writeFileSync(legacy, gzip);
  assert.deepEqual(readDumpFile(legacy).dump, payload);
  for (const extension of ['enc', 'ENC', 'EnC']) {
    const file = path.join(directory, 'untrusted.' + extension);
    fs.writeFileSync(file, gzip);
    assert.throws(() => readDumpFile(file), /Invalid encrypted backup format/);
    fs.writeFileSync(file, encryptBackup(gzip));
    assert.deepEqual(readDumpFile(file).dump, payload);
  }
});
test('CLI dry-run accepts a key only in a recovery file or .env, without contacting a database or printing credentials', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-restore-env-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const key = process.env.BACKUP_ENCRYPTION_KEY;
  const backup = path.join(directory, 'synthetic.json.gz.enc');
  fs.writeFileSync(backup, encryptBackup(zlib.gzipSync(JSON.stringify({ tables: { users: [] } }))));
  for (const configFile of ['.env.backup-recovery', '.env']) {
    const filename = path.join(directory, configFile);
    fs.writeFileSync(filename, 'BACKUP_ENCRYPTION_KEY=' + key + '\n');
    const result = spawnSync(process.execPath, [require.resolve('../restoreDb'), backup], {
      cwd: directory,
      env: { ...process.env, BACKUP_ENCRYPTION_KEY: '', DATABASE_URL: 'invalid://must-not-connect' },
      encoding: 'utf8',
    });
    // Remove the inherited variable altogether: an explicitly empty value is
    // intentionally authoritative and must not be silently overridden.
    const environment = { ...process.env, DATABASE_URL: 'invalid://must-not-connect' };
    delete environment.BACKUP_ENCRYPTION_KEY;
    const loaded = spawnSync(process.execPath, [require.resolve('../restoreDb'), backup], {
      cwd: directory,
      env: environment,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, 'explicitly invalid process key remains rejected');
    assert.equal(loaded.status, 0, loaded.stderr);
    assert.match(loaded.stdout, /DRY RUN — no changes made/);
    assert.equal((loaded.stdout + loaded.stderr).includes(key), false);
    fs.unlinkSync(filename);
  }
});
