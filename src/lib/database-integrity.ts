import Database from 'better-sqlite3';
import {
  classifyDatabaseStartupCode,
  DatabaseStartupError,
  preserveDatabaseFiles,
} from './database-recovery';

/**
 * One read-only quick_check before normal bootstrap. WAL/SHM are included by
 * SQLite's ordinary readonly open; `immutable` must not be used here because
 * it would ignore live sidecars.
 */
export function verifyDatabaseBeforeBootstrap(databasePath: string): void {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let probe: Database.Database | null = null;
    try {
      probe = new Database(databasePath, { readonly: true, fileMustExist: true });
      probe.pragma('busy_timeout = 1000');
      const result = probe.pragma('quick_check(1)', { simple: true });
      if (result !== 'ok') throw new Error('database corruption detected by quick_check');
      return;
    } catch (error) {
      const code = classifyDatabaseStartupCode(error);
      if (code === 'database_busy') {
        if (attempt < maxAttempts) {
          // Synchronous module by design; bounded sleep avoids permanently
          // blocking startup on the first antivirus/other-process lock.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 150);
          continue;
        }
        throw new DatabaseStartupError(code, 'not_attempted');
      }
      const preservation = preserveDatabaseFiles(databasePath);
      throw new DatabaseStartupError(code, preservation.status);
    } finally {
      try { probe?.close(); } catch { /* blocked DB may not close cleanly */ }
    }
  }
}

export function blockDatabaseBootstrap(databasePath: string, error: unknown): DatabaseStartupError {
  const code = classifyDatabaseStartupCode(error);
  if (code === 'database_busy') {
    // A transient writer/antivirus lock is not evidence that a useful snapshot
    // can be taken. Repeated startup retries must not fill retention with torn
    // or duplicate "backups" of a live database.
    return new DatabaseStartupError(code, 'not_attempted');
  }
  const preservation = preserveDatabaseFiles(databasePath);
  return new DatabaseStartupError(code, preservation.status);
}
