// Operator-invoked only, excluded from the Docker web runtime. No HTTP route.
// Creates an encrypted backup through the existing operator email flow, then
// restores those exact bytes in a separate, network-disabled process/database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const RESTORE_SOURCE_SHA256 = '3e0a09fa4e17e0bbe5e005421391100be4594fd0abfab5f954751a4b748fb4b4';

function guard(options, env = process.env) {
  assert.match(options.expectedRelease || '', /^[a-f0-9]{40}$/);
  assert.match(options.expectedServiceId || '', /^srv-[a-z0-9]+$/);
  assert.match(options.expectedKeyFingerprint || '', /^[a-f0-9]{64}$/);
  assert.equal(env.RENDER_GIT_COMMIT, options.expectedRelease, 'Live release changed; stop before reading data');
  assert.equal(env.RENDER_SERVICE_ID, options.expectedServiceId, 'Not the approved service');
  assert.equal(
    env.ADMIN_EMAIL?.trim().toLowerCase(),
    options.expectedAdminEmail?.trim().toLowerCase(),
    'Wrong backup recipient'
  );
  assert.ok(
    options.expectedAdminEmail && env.GMAIL_USER && env.GMAIL_APP_PASSWORD,
    'Existing Gmail backup transport required'
  );
  assert.equal(
    new URL(env.DATABASE_URL || env.TURSO_DB_URL).protocol,
    'libsql:',
    'Only the approved hosted database topology is allowed'
  );
  const key = Buffer.from(env.BACKUP_ENCRYPTION_KEY || '', 'base64');
  assert.equal(key.length, 32, 'Missing recovery key');
  assert.equal(
    crypto.createHash('sha256').update(key).digest('hex'),
    options.expectedKeyFingerprint,
    'Separate operator key does not match'
  );
}

function childEnvironment(directory, key, env = process.env) {
  assert.match(directory, /^\/tmp\/cf-recovery-[A-Za-z0-9]+$/);
  return {
    PATH: env.PATH,
    NODE_ENV: 'test',
    JWT_SECRET: 'isolated-recovery-jwt-'.padEnd(48, 'x'),
    SESSION_SECRET: 'isolated-recovery-session-'.padEnd(48, 'x'),
    ADMIN_EMAIL: 'admin@test.local',
    DATABASE_URL: '',
    TURSO_DB_URL: 'file:' + directory + '/recovered.db',
    TURSO_AUTH_TOKEN: '',
    BACKUP_ENCRYPTION_KEY: key,
    DOTENV_CONFIG_OVERRIDE: 'false',
    RESEND_API_KEY: '',
    GMAIL_USER: '',
    GMAIL_APP_PASSWORD: '',
    FINNHUB_API_KEY: '',
    FMP_API_KEY: '',
    MASSIVE_API_KEY: '',
    WHOP_API_KEY: '',
  };
}

function childProgram(root, directory) {
  return `const assert=require('node:assert/strict');const crypto=require('node:crypto');
    let networkAttempts=0;const deny=()=>{networkAttempts++;throw new Error('Restore network prohibited')};
    globalThis.fetch=deny;require('node:net').Socket.prototype.connect=deny;
    require('node:http').request=deny;require('node:https').request=deny;
    assert.equal(process.env.DATABASE_URL,'');assert.equal(process.env.TURSO_DB_URL,${JSON.stringify('file:' + directory + '/recovered.db')});
    const db=require(${JSON.stringify(root + '/server/db')});
    const restore=require(${JSON.stringify(directory + '/restore.cjs')});
    function digest(rows){return crypto.createHash('sha256').update(JSON.stringify(rows.map(row=>Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]]))).map(row=>JSON.stringify(row)).sort())).digest('hex')}
    (async()=>{const {dump}=restore.readDumpFile(${JSON.stringify(directory + '/backup.enc')});
    const tables=restore.validateDump(dump);await db.ready;assert.equal(db.dialect,'sqlite');
    await restore.restoreDump(db,dump);const counts={};let rows=0;
    for(const table of tables){const actual=await db.prepare('SELECT * FROM '+table).all();
      assert.equal(digest(actual),digest(dump.tables[table]),'Restored table differs: '+table);
      counts[table]=actual.length;rows+=actual.length;}
    assert.equal(networkAttempts,0);console.log('RECOVERY_CHILD '+JSON.stringify({tables:tables.length,rows,counts,exactTableHashesMatch:true,networkAttempts}));
    })().catch(error=>{console.error('RECOVERY_CHILD_FAILED '+error.name);process.exitCode=1}).finally(()=>db.close());`;
}

async function main(options) {
  guard(options);
  const root = process.cwd();
  assert.equal(root, '/app', 'Only the existing Docker service runtime is supported');
  const limit = Number(fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim());
  const used = Number(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim());
  assert.ok(
    Number.isFinite(limit) && limit - used >= 192 * 1024 * 1024,
    'Insufficient spare memory for an isolated restore'
  );
  const sourceResponse = await fetch(
    `https://raw.githubusercontent.com/liorse2006-beep/CAPITAL-FLOW/${options.expectedRelease}/restoreDb.js`,
    { signal: AbortSignal.timeout(10000) }
  );
  assert.equal(sourceResponse.status, 200, 'Pinned recovery source unavailable');
  const source = await sourceResponse.text();
  assert.equal(
    crypto.createHash('sha256').update(source).digest('hex'),
    RESTORE_SOURCE_SHA256,
    'Recovery source changed; review it before execution'
  );
  const db = require(root + '/server/db');
  let directory;
  let output;
  try {
    await db.ready;
    assert.equal(typeof db.readSnapshot, 'function', 'Consistent snapshot fix must be deployed first');
    const { TABLES } = require(root + '/server/services/dbBackup');
    const counts = await db.readSnapshot(
      TABLES.map((table) => ({ sql: 'SELECT COUNT(*) AS count FROM ' + table, args: [] }))
    );
    assert.ok(
      counts.reduce((sum, rows) => sum + rows[0].count, 0) <= 5000,
      'Dataset exceeds this bounded operator test'
    );
    const encryption = require(root + '/server/services/backupEncryption');
    const original = encryption.encryptBackup;
    let captured;
    encryption.encryptBackup = (...args) => {
      const bytes = original(...args);
      captured = Buffer.from(bytes);
      return bytes;
    };
    // Reload only this short-lived helper's module, never the running service.
    delete require.cache[require.resolve(root + '/server/services/dbBackup')];
    try {
      await require(root + '/server/services/dbBackup').runBackupTick();
    } finally {
      encryption.encryptBackup = original;
    }
    assert.ok(
      encryption.isEncryptedBackup(captured) && captured.length < 2 * 1024 * 1024,
      'Invalid or oversized encrypted snapshot'
    );
    directory = fs.mkdtempSync('/tmp/cf-recovery-');
    fs.chmodSync(directory, 0o700);
    fs.writeFileSync(directory + '/backup.enc', captured, { mode: 0o600, flag: 'wx' });
    // Mechanical path rebasing of the reviewed, hash-pinned restore module.
    const rebased = source.replaceAll("require('./server/", "require('/app/server/");
    fs.writeFileSync(directory + '/restore.cjs', rebased, { mode: 0o600, flag: 'wx' });
    const child = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', childProgram(root, directory)], {
      cwd: directory,
      env: childEnvironment(directory, process.env.BACKUP_ENCRYPTION_KEY),
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    assert.equal(child.status, 0, 'Temporary restore failed or exceeded its bound');
    const line = child.stdout.split(/\r?\n/).find((value) => value.startsWith('RECOVERY_CHILD '));
    assert.ok(line, 'Missing recovery evidence');
    output = {
      release: options.expectedRelease,
      encryptedBytes: captured.length,
      encryptedSha256: crypto.createHash('sha256').update(captured).digest('hex'),
      separateKeyMatches: true,
      existingOperatorEmailSent: true,
      restore: JSON.parse(line.slice('RECOVERY_CHILD '.length)),
      liveDatabaseNotRestored: true,
    };
  } finally {
    await db.close();
    if (directory) {
      assert.match(path.resolve(directory), /^\/tmp\/cf-recovery-[A-Za-z0-9]+$/);
      for (const name of [
        'backup.enc',
        'restore.cjs',
        'recovered.db',
        'recovered.db-wal',
        'recovered.db-shm',
        'recovered.db-journal',
      ]) {
        const file = path.join(directory, name);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      fs.rmdirSync(directory);
    }
  }
  output.temporaryPlaintextAndFilesRemoved = true;
  console.log('OPERATOR_RECOVERY ' + JSON.stringify(output));
  return output;
}

module.exports = { main, guard, childEnvironment, childProgram };
