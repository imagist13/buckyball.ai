import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeText } from './telemetry/sanitize';

export const DATABASE_STARTUP_MARKER = 'CODEPILOT_DB_STARTUP_BLOCKED';
export const DATABASE_STARTUP_DIAGNOSTIC_MARKER = 'CODEPILOT_DB_STARTUP_DIAGNOSTIC';
export const SERVER_HEALTH_DIAGNOSTIC_MARKER = 'CODEPILOT_SERVER_HEALTH_DIAGNOSTIC';
export const DATABASE_RECOVERY_DIRNAME = 'database-recovery';
export const DATABASE_FRESH_START_MARKER_SUFFIX = '.start-fresh.json';
export const DATABASE_RECOVERY_MAX_BACKUPS = 10;

export type DatabaseStartupCode =
  | 'database_corrupt'
  | 'database_busy'
  | 'database_access_denied'
  | 'database_io_failure'
  | 'database_migration_failed'
  | 'database_runtime_recovery_failed'
  | 'database_fresh_start_conflict'
  | 'database_unavailable';

export type DatabasePreservationStatus = 'complete' | 'partial' | 'failed' | 'not_attempted';

export interface DatabasePreservationResult {
  status: DatabasePreservationStatus;
  backupDirectory: string;
  copiedFiles: string[];
  expectedFiles: string[];
}

interface DatabaseBackupIdentity {
  name: string;
  size: number;
  sha256: string;
}

interface FreshDatabaseIntentV2 {
  version: 2;
  confirmedAt: string;
  backupDirectory: string;
  backupFiles: DatabaseBackupIdentity[];
}

export type DatabaseStartupStage = 'migration' | 'runtime_recovery';

/** A path-free startup error safe for health responses, local logs and telemetry. */
export class DatabaseStartupError extends Error {
  readonly code: DatabaseStartupCode;
  readonly preservation: DatabasePreservationStatus;

  constructor(code: DatabaseStartupCode, preservation: DatabasePreservationStatus) {
    super(`${DATABASE_STARTUP_MARKER} code=${code} preservation=${preservation}`);
    this.name = 'DatabaseStartupError';
    this.code = code;
    this.preservation = preservation;
  }
}

/**
 * Preserve a useful local root-cause breadcrumb without exposing the database
 * path, home directory, URL, credential-shaped text or an unbounded stack.
 * Main copies only this marker into the offline diagnostic summary.
 */
export function formatDatabaseStartupDiagnostic(
  stage: DatabaseStartupStage,
  error: unknown,
): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const rawCode = String(record.code ?? 'unknown');
  const rawName = error instanceof Error ? error.name : 'UnknownError';
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = sanitizeText(rawMessage, 384)
    .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, '[local-path]')
    .replace(/(^|[\s"'(])\/(?:[^/\s]+\/)*[^/\s]*/g, '$1[local-path]');
  return `${DATABASE_STARTUP_DIAGNOSTIC_MARKER} ${JSON.stringify({
    stage,
    category: classifyDatabaseStartupCode(error),
    errorName: /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(rawName) ? rawName : 'UnknownError',
    errorCode: /^[A-Za-z0-9_]{1,64}$/.test(rawCode) ? rawCode : 'unknown',
    message,
  })}`;
}

/** Unknown health-route failures are product faults, but still need one safe local breadcrumb. */
export function formatServerHealthDiagnostic(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const rawCode = String(record.code ?? 'unknown');
  const rawName = error instanceof Error ? error.name : 'UnknownError';
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = sanitizeText(rawMessage, 384)
    .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, '[local-path]')
    .replace(/(^|[\s"'(])\/(?:[^/\s]+\/)*[^/\s]*/g, '$1[local-path]');
  return `${SERVER_HEALTH_DIAGNOSTIC_MARKER} ${JSON.stringify({
    errorName: /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(rawName) ? rawName : 'UnknownError',
    errorCode: /^[A-Za-z0-9_]{1,64}$/.test(rawCode) ? rawCode : 'unknown',
    message,
  })}`;
}

function databaseFiles(databasePath: string): string[] {
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]
    .filter((candidate) => fs.existsSync(candidate));
}

export function freshDatabaseIntentPath(databasePath: string): string {
  return `${databasePath}${DATABASE_FRESH_START_MARKER_SUFFIX}`;
}

export function hasFreshDatabaseIntent(databasePath: string): boolean {
  return fs.existsSync(freshDatabaseIntentPath(databasePath));
}

function isDirectChild(candidate: string, parent: string): boolean {
  return path.dirname(path.resolve(candidate)) === path.resolve(parent);
}

function backupIdentity(filePath: string): DatabaseBackupIdentity {
  return {
    name: path.basename(filePath),
    size: fs.statSync(filePath).size,
    sha256: fileSha256(filePath),
  };
}

function sortedBackupIdentities(filePaths: string[]): DatabaseBackupIdentity[] {
  return filePaths.map(backupIdentity).sort((left, right) => left.name.localeCompare(right.name));
}

function backupIdentitiesEqual(
  left: DatabaseBackupIdentity[],
  right: DatabaseBackupIdentity[],
): boolean {
  return left.length === right.length && left.every((identity, index) => (
    identity.name === right[index]?.name
    && identity.size === right[index]?.size
    && identity.sha256 === right[index]?.sha256
  ));
}

function readVerifiedFreshDatabaseIntent(databasePath: string): FreshDatabaseIntentV2 {
  const markerPath = freshDatabaseIntentPath(databasePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    throw new DatabaseStartupError('database_fresh_start_conflict', 'failed');
  }
  const record = parsed as Partial<FreshDatabaseIntentV2> | null;
  const recoveryRoot = path.join(path.dirname(databasePath), DATABASE_RECOVERY_DIRNAME);
  if (
    !record
    || record.version !== 2
    || typeof record.confirmedAt !== 'string'
    || typeof record.backupDirectory !== 'string'
    || !isDirectChild(record.backupDirectory, recoveryRoot)
    || !Array.isArray(record.backupFiles)
    || record.backupFiles.length === 0
  ) {
    throw new DatabaseStartupError('database_fresh_start_conflict', 'failed');
  }
  const allowedNames = new Set(databaseFiles(databasePath).map(file => path.basename(file)));
  // The originals may already be absent, so add the complete known sidecar set.
  allowedNames.add(path.basename(databasePath));
  allowedNames.add(path.basename(`${databasePath}-wal`));
  allowedNames.add(path.basename(`${databasePath}-shm`));
  const seen = new Set<string>();
  for (const identity of record.backupFiles) {
    if (
      !identity
      || typeof identity.name !== 'string'
      || !allowedNames.has(identity.name)
      || seen.has(identity.name)
      || !Number.isSafeInteger(identity.size)
      || identity.size < 0
      || !/^[a-f0-9]{64}$/.test(identity.sha256)
    ) {
      throw new DatabaseStartupError('database_fresh_start_conflict', 'failed');
    }
    seen.add(identity.name);
    const backupPath = path.join(record.backupDirectory, identity.name);
    try {
      const actual = backupIdentity(backupPath);
      if (actual.size !== identity.size || actual.sha256 !== identity.sha256) {
        throw new Error('backup identity mismatch');
      }
    } catch {
      throw new DatabaseStartupError('database_fresh_start_conflict', 'failed');
    }
  }
  return record as FreshDatabaseIntentV2;
}

/**
 * Consume a previously user-confirmed fresh-start intent before legacy-path
 * migration runs. The marker is written only after a complete verified backup
 * and survives relaunch/crash, so an old legacy database can never be copied
 * back into the newly emptied location.
 */
export function enforceFreshDatabaseIntent(databasePath: string): boolean {
  if (!hasFreshDatabaseIntent(databasePath)) return false;
  readVerifiedFreshDatabaseIntent(databasePath);
  // A file that reappears after the user confirmed fresh start is ambiguous:
  // it may be crash residue or a deliberate manual restore. Never delete it
  // automatically; Main presents explicit keep/continue choices instead.
  if (databaseFiles(databasePath).length > 0) {
    throw new DatabaseStartupError('database_fresh_start_conflict', 'complete');
  }
  return true;
}

export function clearFreshDatabaseIntent(databasePath: string): void {
  const markerPath = freshDatabaseIntentPath(databasePath);
  if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
}

/** User explicitly chose the already-restored database over the old intent. */
export function cancelFreshDatabaseIntent(databasePath: string): void {
  clearFreshDatabaseIntent(databasePath);
}

/** User explicitly reconfirmed empty startup after a verified backup conflict. */
export function continueFreshDatabaseIntent(databasePath: string): void {
  readVerifiedFreshDatabaseIntent(databasePath);
  for (const source of databaseFiles(databasePath)) fs.unlinkSync(source);
}

function backupName(now: Date): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `${timestamp}-${process.pid}`;
}

function fileSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

export function pruneDatabaseRecoveryBackups(
  recoveryRoot: string,
  keep = DATABASE_RECOVERY_MAX_BACKUPS,
  protectedDirectory?: string,
): string[] {
  if (!Number.isSafeInteger(keep) || keep < 1 || !fs.existsSync(recoveryRoot)) return [];
  const managed = fs.readdirSync(recoveryRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T[\d-]+Z-\d+$/.test(entry.name))
    .map(entry => entry.name)
    .sort()
    .reverse();
  const protectedName = protectedDirectory && isDirectChild(protectedDirectory, recoveryRoot)
    ? path.basename(protectedDirectory)
    : null;
  const retained = new Set<string>();
  if (protectedName && managed.includes(protectedName)) retained.add(protectedName);
  for (const name of managed) {
    if (retained.size >= keep) break;
    retained.add(name);
  }
  const removable = managed.filter(name => !retained.has(name));
  const removed: string[] = [];
  for (const name of removable) {
    const target = path.join(recoveryRoot, name);
    if (!isDirectChild(target, recoveryRoot)) continue;
    try {
      fs.rmSync(target, { recursive: true });
      removed.push(name);
    } catch {
      // Retention failure must never invalidate the new verified backup.
    }
  }
  return removed;
}

function readManagedBackupIdentities(directory: string): DatabaseBackupIdentity[] | null {
  try {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    if (entries.length === 0 || entries.some(entry => !entry.isFile())) return null;
    return sortedBackupIdentities(entries.map(entry => path.join(directory, entry.name)));
  } catch {
    return null;
  }
}

function findMatchingRecoveryBackup(
  recoveryRoot: string,
  identities: DatabaseBackupIdentity[],
  excludedDirectory: string,
): string | null {
  if (!fs.existsSync(recoveryRoot)) return null;
  const names = fs.readdirSync(recoveryRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T[\d-]+Z-\d+$/.test(entry.name))
    .map(entry => entry.name)
    .sort()
    .reverse();
  for (const name of names) {
    const candidate = path.join(recoveryRoot, name);
    if (path.resolve(candidate) === path.resolve(excludedDirectory)) continue;
    const candidateIdentities = readManagedBackupIdentities(candidate);
    if (candidateIdentities && backupIdentitiesEqual(candidateIdentities, identities)) return candidate;
  }
  return null;
}

/**
 * Copy the database and any WAL/SHM sidecars before recovery is offered.
 * The source files are never deleted or modified by this function.
 */
export function preserveDatabaseFiles(
  databasePath: string,
  now: Date = new Date(),
): DatabasePreservationResult {
  const sources = databaseFiles(databasePath);
  const recoveryRoot = path.join(path.dirname(databasePath), DATABASE_RECOVERY_DIRNAME);
  let backupDirectory = path.join(recoveryRoot, backupName(now));
  const copiedFiles: string[] = [];
  let sourceIdentities: DatabaseBackupIdentity[];

  try {
    sourceIdentities = sortedBackupIdentities(sources);
  } catch {
    return {
      status: 'failed',
      backupDirectory,
      copiedFiles,
      expectedFiles: sources.map((source) => path.basename(source)),
    };
  }

  try {
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  } catch {
    return {
      status: 'failed',
      backupDirectory,
      copiedFiles,
      expectedFiles: sources.map((source) => path.basename(source)),
    };
  }

  for (const source of sources) {
    const basename = path.basename(source);
    try {
      const destination = path.join(backupDirectory, basename);
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      const destinationDescriptor = fs.openSync(destination, 'r');
      try { fs.fsyncSync(destinationDescriptor); } finally { fs.closeSync(destinationDescriptor); }
      const expected = sourceIdentities.find(identity => identity.name === basename);
      const copied = backupIdentity(destination);
      if (!expected || !backupIdentitiesEqual([expected], [copied])) {
        throw new Error('database preservation identity mismatch');
      }
      copiedFiles.push(basename);
    } catch {
      // Keep any successful copies. A partial backup is useful evidence, but
      // is never sufficient for the user-confirmed "start fresh" action.
    }
  }

  let stableSourceSet = false;
  try {
    stableSourceSet = backupIdentitiesEqual(
      sourceIdentities,
      sortedBackupIdentities(databaseFiles(databasePath)),
    );
  } catch {
    stableSourceSet = false;
  }
  const status: DatabasePreservationStatus = copiedFiles.length === sources.length
    && sources.length > 0
    && stableSourceSet
    ? 'complete'
    : copiedFiles.length > 0
      ? 'partial'
      : 'failed';
  if (status === 'complete') {
    const duplicate = findMatchingRecoveryBackup(recoveryRoot, sourceIdentities, backupDirectory);
    if (duplicate) {
      try {
        fs.rmSync(backupDirectory, { recursive: true });
        backupDirectory = duplicate;
      } catch {
        // Keeping two verified copies is safe; retention below remains bounded.
      }
    }
    pruneDatabaseRecoveryBackups(recoveryRoot, DATABASE_RECOVERY_MAX_BACKUPS, backupDirectory);
  }
  return {
    status,
    backupDirectory,
    copiedFiles,
    expectedFiles: sources.map((source) => path.basename(source)),
  };
}

/**
 * User-confirmed escape hatch: first prove a complete copy exists, then
 * remove the blocked originals so the next launch can create an empty DB.
 */
export function prepareFreshDatabase(databasePath: string): DatabasePreservationResult {
  const preserved = preserveDatabaseFiles(databasePath);
  if (preserved.status !== 'complete') return preserved;

  const markerPath = freshDatabaseIntentPath(databasePath);
  try {
    const backupFiles = preserved.copiedFiles.map(name => (
      backupIdentity(path.join(preserved.backupDirectory, name))
    ));
    fs.writeFileSync(markerPath, JSON.stringify({
      version: 2,
      confirmedAt: new Date().toISOString(),
      backupDirectory: preserved.backupDirectory,
      backupFiles,
    }), { encoding: 'utf8', mode: 0o600 });
    const markerDescriptor = fs.openSync(markerPath, 'r');
    try { fs.fsyncSync(markerDescriptor); } finally { fs.closeSync(markerDescriptor); }
  } catch {
    return { ...preserved, status: 'partial' };
  }

  const sources = databaseFiles(databasePath);
  try {
    for (const source of sources) fs.unlinkSync(source);
    return preserved;
  } catch {
    // The complete timestamped copy remains available even if source cleanup
    // is only partly successful. Do not relaunch when this result is returned.
    return { ...preserved, status: 'partial' };
  }
}

export function classifyDatabaseStartupCode(error: unknown): DatabaseStartupCode {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  const message = error instanceof Error ? error.message : String(error);
  if (
    code === 'SQLITE_BUSY'
    || code === 'SQLITE_LOCKED'
    || code.startsWith('SQLITE_BUSY_')
    || code.startsWith('SQLITE_LOCKED_')
    || /database is (?:busy|locked)|database table is locked/i.test(message)
  ) return 'database_busy';
  if (
    code === 'SQLITE_CORRUPT'
    || code === 'SQLITE_NOTADB'
    || /database disk image is malformed|file is not a database|database corruption/i.test(message)
  ) return 'database_corrupt';
  if (
    ['EACCES', 'EPERM', 'SQLITE_READONLY', 'SQLITE_CANTOPEN', 'SQLITE_PERM'].includes(code)
    || /permission denied|access denied|readonly database|unable to open database/i.test(message)
  ) return 'database_access_denied';
  if (code.startsWith('SQLITE_IOERR') || code === 'SQLITE_FULL' || code === 'ENOSPC') {
    return 'database_io_failure';
  }
  return 'database_unavailable';
}
