import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { blockDatabaseBootstrap, verifyDatabaseBeforeBootstrap } from '../../lib/database-integrity';
import {
  cancelFreshDatabaseIntent,
  clearFreshDatabaseIntent,
  classifyDatabaseStartupCode,
  continueFreshDatabaseIntent,
  DATABASE_RECOVERY_DIRNAME,
  DatabaseStartupError,
  enforceFreshDatabaseIntent,
  formatDatabaseStartupDiagnostic,
  formatServerHealthDiagnostic,
  hasFreshDatabaseIntent,
  prepareFreshDatabase,
  preserveDatabaseFiles,
  pruneDatabaseRecoveryBackups,
} from '../../lib/database-recovery';
import { resolveCodePilotDataDir } from '../../lib/codepilot-data-dir';

function tempDatabaseRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-database-recovery-'));
}

describe('database startup integrity and recovery', () => {
  it('accepts a healthy database through the read-only quick_check', () => {
    const root = tempDatabaseRoot();
    const databasePath = path.join(root, 'codepilot.db');
    const db = new Database(databasePath);
    db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)');
    db.close();

    assert.doesNotThrow(() => verifyDatabaseBeforeBootstrap(databasePath));
    assert.equal(fs.existsSync(path.join(root, DATABASE_RECOVERY_DIRNAME)), false);
  });

  it('blocks a malformed database, preserves it, and never rewrites the original', () => {
    const root = tempDatabaseRoot();
    const databasePath = path.join(root, 'codepilot.db');
    const malformed = Buffer.alloc(8_192, 0x5a);
    fs.writeFileSync(databasePath, malformed);

    assert.throws(
      () => verifyDatabaseBeforeBootstrap(databasePath),
      (error: unknown) => {
        assert.ok(error instanceof DatabaseStartupError);
        assert.equal(error.code, 'database_corrupt');
        assert.equal(error.preservation, 'complete');
        assert.doesNotMatch(error.message, new RegExp(root));
        return true;
      },
    );
    assert.deepEqual(fs.readFileSync(databasePath), malformed);
    const backups = fs.readdirSync(path.join(root, DATABASE_RECOVERY_DIRNAME));
    assert.equal(backups.length, 1);
    assert.deepEqual(
      fs.readFileSync(path.join(root, DATABASE_RECOVERY_DIRNAME, backups[0], 'codepilot.db')),
      malformed,
    );
  });

  it('preserves DB/WAL/SHM together and starts fresh only after a complete copy', () => {
    const root = tempDatabaseRoot();
    const databasePath = path.join(root, 'codepilot.db');
    fs.writeFileSync(databasePath, 'db');
    fs.writeFileSync(`${databasePath}-wal`, 'wal');
    fs.writeFileSync(`${databasePath}-shm`, 'shm');

    const preserved = preserveDatabaseFiles(databasePath, new Date('2026-08-23T10:00:00.000Z'));
    assert.equal(preserved.status, 'complete');
    assert.deepEqual(preserved.copiedFiles.sort(), ['codepilot.db', 'codepilot.db-shm', 'codepilot.db-wal']);
    assert.equal(fs.readFileSync(databasePath, 'utf8'), 'db');

    const fresh = prepareFreshDatabase(databasePath);
    assert.equal(fresh.status, 'complete');
    assert.equal(fs.existsSync(databasePath), false);
    assert.equal(fs.existsSync(`${databasePath}-wal`), false);
    assert.equal(fs.existsSync(`${databasePath}-shm`), false);
    assert.equal(fs.readFileSync(path.join(fresh.backupDirectory, 'codepilot.db'), 'utf8'), 'db');
    assert.equal(hasFreshDatabaseIntent(databasePath), true);
  });

  it('rejects a backup generation when DB/WAL/SHM change across the copy envelope', () => {
    const root = tempDatabaseRoot();
    const databasePath = path.join(root, 'codepilot.db');
    fs.writeFileSync(databasePath, 'db-before');
    fs.writeFileSync(`${databasePath}-wal`, 'wal-before');
    fs.writeFileSync(`${databasePath}-shm`, 'shm-before');

    const mutableFs = fs as typeof fs & { copyFileSync: typeof fs.copyFileSync };
    const originalCopy = mutableFs.copyFileSync;
    let copyCount = 0;
    mutableFs.copyFileSync = ((...args: unknown[]) => {
      Reflect.apply(originalCopy, fs, args);
      copyCount += 1;
      if (copyCount === 1) fs.appendFileSync(`${databasePath}-wal`, '-changed-during-copy');
    }) as typeof fs.copyFileSync;
    try {
      const preserved = preserveDatabaseFiles(databasePath, new Date('2026-08-23T10:01:00.000Z'));
      assert.equal(preserved.status, 'partial');
      assert.equal(fs.existsSync(databasePath), true);
      assert.equal(fs.existsSync(`${databasePath}-wal`), true);
    } finally {
      mutableFs.copyFileSync = originalCopy;
    }
  });

  it('deduplicates identical generations so repeated blocked starts cannot evict older evidence', () => {
    const root = tempDatabaseRoot();
    const databasePath = path.join(root, 'codepilot.db');
    fs.writeFileSync(databasePath, 'same-corrupt-generation');

    const first = preserveDatabaseFiles(databasePath, new Date('2026-08-23T10:02:00.000Z'));
    const repeated = preserveDatabaseFiles(databasePath, new Date('2026-08-23T10:03:00.000Z'));
    assert.equal(first.status, 'complete');
    assert.equal(repeated.status, 'complete');
    assert.equal(repeated.backupDirectory, first.backupDirectory);
    assert.equal(fs.readdirSync(path.join(root, DATABASE_RECOVERY_DIRNAME)).length, 1);

    fs.writeFileSync(databasePath, 'different-generation');
    const changed = preserveDatabaseFiles(databasePath, new Date('2026-08-23T10:04:00.000Z'));
    assert.equal(changed.status, 'complete');
    assert.notEqual(changed.backupDirectory, first.backupDirectory);
    assert.equal(fs.readdirSync(path.join(root, DATABASE_RECOVERY_DIRNAME)).length, 2);
  });

  it('preserves a database that reappears after fresh-start intent until the user chooses', () => {
    const root = tempDatabaseRoot();
    const databasePath = path.join(root, 'codepilot.db');
    fs.writeFileSync(databasePath, 'current');
    assert.equal(prepareFreshDatabase(databasePath).status, 'complete');

    fs.writeFileSync(databasePath, 'manual restore');
    assert.throws(
      () => enforceFreshDatabaseIntent(databasePath),
      (error: unknown) => {
        assert.ok(error instanceof DatabaseStartupError);
        assert.equal(error.code, 'database_fresh_start_conflict');
        assert.equal(error.preservation, 'complete');
        return true;
      },
    );
    assert.equal(fs.readFileSync(databasePath, 'utf8'), 'manual restore');
    assert.equal(hasFreshDatabaseIntent(databasePath), true);

    cancelFreshDatabaseIntent(databasePath);
    assert.equal(hasFreshDatabaseIntent(databasePath), false);
    assert.equal(fs.readFileSync(databasePath, 'utf8'), 'manual restore');
  });

  it('continues fresh start only after re-verifying the prior complete backup', () => {
    const root = tempDatabaseRoot();
    const databasePath = path.join(root, 'codepilot.db');
    fs.writeFileSync(databasePath, 'current');
    const fresh = prepareFreshDatabase(databasePath);
    assert.equal(fresh.status, 'complete');

    fs.writeFileSync(databasePath, 'crash residue');
    continueFreshDatabaseIntent(databasePath);
    assert.equal(fs.existsSync(databasePath), false);
    assert.equal(hasFreshDatabaseIntent(databasePath), true);
    assert.equal(enforceFreshDatabaseIntent(databasePath), true);
    clearFreshDatabaseIntent(databasePath);

    fs.writeFileSync(databasePath, 'second current');
    const second = prepareFreshDatabase(databasePath);
    assert.equal(second.status, 'complete');
    fs.writeFileSync(databasePath, 'manual restore');
    fs.appendFileSync(path.join(second.backupDirectory, 'codepilot.db'), 'tampered');
    assert.throws(
      () => continueFreshDatabaseIntent(databasePath),
      (error: unknown) => error instanceof DatabaseStartupError
        && error.code === 'database_fresh_start_conflict',
    );
    assert.equal(fs.readFileSync(databasePath, 'utf8'), 'manual restore');
  });

  it('bounds timestamped recovery backups without following links or deleting unrelated entries', () => {
    const root = tempDatabaseRoot();
    const recoveryRoot = path.join(root, DATABASE_RECOVERY_DIRNAME);
    fs.mkdirSync(recoveryRoot);
    const names = Array.from({ length: 12 }, (_, index) => (
      `2026-08-${String(index + 1).padStart(2, '0')}T10-00-00-000Z-${100 + index}`
    ));
    for (const name of names) fs.mkdirSync(path.join(recoveryRoot, name));
    fs.mkdirSync(path.join(recoveryRoot, 'manual-export'));
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-recovery-external-'));
    fs.symlinkSync(external, path.join(recoveryRoot, '2026-08-01T00-00-00-000Z-999'), 'dir');

    assert.deepEqual(
      pruneDatabaseRecoveryBackups(recoveryRoot, 10).sort(),
      names.slice(0, 2).sort(),
    );
    assert.equal(fs.existsSync(path.join(recoveryRoot, 'manual-export')), true);
    assert.equal(fs.existsSync(external), true);
    assert.equal(fs.lstatSync(path.join(recoveryRoot, '2026-08-01T00-00-00-000Z-999')).isSymbolicLink(), true);
  });

  it('resolves one absolute data directory for Electron recovery and the utility process', () => {
    assert.equal(resolveCodePilotDataDir({}, '/Users/tester'), '/Users/tester/.codepilot');
    assert.equal(
      resolveCodePilotDataDir({ CLAUDE_GUI_DATA_DIR: '  ./custom-data  ' }, '/Users/tester'),
      path.resolve('./custom-data'),
    );
  });

  it('fails closed when the recovery destination cannot be created', () => {
    const root = tempDatabaseRoot();
    const databasePath = path.join(root, 'codepilot.db');
    fs.writeFileSync(databasePath, 'original');
    fs.writeFileSync(path.join(root, DATABASE_RECOVERY_DIRNAME), 'not-a-directory');

    const preserved = preserveDatabaseFiles(databasePath);
    assert.equal(preserved.status, 'failed');
    assert.equal(fs.readFileSync(databasePath, 'utf8'), 'original');

    const fresh = prepareFreshDatabase(databasePath);
    assert.equal(fresh.status, 'failed');
    assert.equal(fs.readFileSync(databasePath, 'utf8'), 'original');
  });

  it('classifies access and storage failures without exposing a path', () => {
    assert.equal(classifyDatabaseStartupCode({ code: 'SQLITE_BUSY' }), 'database_busy');
    assert.equal(classifyDatabaseStartupCode(new Error('database table is locked')), 'database_busy');
    assert.equal(classifyDatabaseStartupCode({ code: 'EPERM' }), 'database_access_denied');
    assert.equal(classifyDatabaseStartupCode({ code: 'SQLITE_IOERR_FSYNC' }), 'database_io_failure');
    const error = new DatabaseStartupError('database_io_failure', 'partial');
    assert.equal(error.message, 'CODEPILOT_DB_STARTUP_BLOCKED code=database_io_failure preservation=partial');
  });

  it('does not create recovery copies for a transient rw-open busy failure', () => {
    const root = tempDatabaseRoot();
    const databasePath = path.join(root, 'codepilot.db');
    fs.writeFileSync(databasePath, 'live-database');
    const blocked = blockDatabaseBootstrap(databasePath, { code: 'SQLITE_BUSY' });
    assert.equal(blocked.code, 'database_busy');
    assert.equal(blocked.preservation, 'not_attempted');
    assert.equal(fs.existsSync(path.join(root, DATABASE_RECOVERY_DIRNAME)), false);
  });

  it('keeps migration diagnostics useful, bounded and path/secret free', () => {
    const root = tempDatabaseRoot();
    const error = Object.assign(
      new Error(`no such column: api_providers.new_field at ${root}/codepilot.db?api_key=secret-value`),
      { code: 'SQLITE_ERROR' },
    );
    const diagnostic = formatDatabaseStartupDiagnostic('migration', error);
    assert.match(diagnostic, /^CODEPILOT_DB_STARTUP_DIAGNOSTIC /);
    assert.match(diagnostic, /no such column: api_providers\.new_field/);
    assert.match(diagnostic, /SQLITE_ERROR/);
    assert.doesNotMatch(diagnostic, new RegExp(root));
    assert.doesNotMatch(diagnostic, /secret-value/);

    const health = formatServerHealthDiagnostic(error);
    assert.match(health, /^CODEPILOT_SERVER_HEALTH_DIAGNOSTIC /);
    assert.match(health, /no such column: api_providers\.new_field/);
    assert.doesNotMatch(health, new RegExp(root));
    assert.doesNotMatch(health, /secret-value/);
  });

  it('requires fsync and SHA-256 equality before a backup is complete', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/database-recovery.ts'), 'utf8');
    assert.match(source, /fs\.fsyncSync\(destinationDescriptor\)/);
    assert.match(source, /backupIdentitiesEqual\(\[expected\], \[copied\]\)/);
    assert.match(source, /sortedBackupIdentities\(databaseFiles\(databasePath\)\)/);
    assert.match(source, /fs\.fsyncSync\(markerDescriptor\)/);
  });

  it('keeps migration/runtime faults outside the corruption recovery claim', () => {
    const dbSource = fs.readFileSync(path.resolve(__dirname, '../../lib/db.ts'), 'utf8');
    const healthSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/health/route.ts'), 'utf8');
    assert.match(dbSource, /database_migration_failed/);
    assert.match(dbSource, /database_runtime_recovery_failed/);
    assert.match(dbSource, /formatDatabaseStartupDiagnostic\('migration', error\)/);
    assert.match(dbSource, /formatDatabaseStartupDiagnostic\('runtime_recovery', error\)/);
    assert.match(dbSource, /enforceFreshDatabaseIntent\(DB_PATH\)/);
    assert.match(dbSource, /!freshStartIntent/);
    assert.match(healthSource, /CODEPILOT_SERVER_HEALTH_FAILED/);
    assert.match(healthSource, /formatServerHealthDiagnostic\(error\)/);
    assert.doesNotMatch(
      healthSource.slice(healthSource.indexOf('// Unknown route/runtime failures')),
      /code:\s*'database_unavailable'/,
    );
  });
});
