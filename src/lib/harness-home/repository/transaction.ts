import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashBytes, hashFile } from './hash';
import {
  HARNESS_MANIFEST_FILE,
  HARNESS_TRANSACTIONS_DIR,
  assertNoSymlinkTraversal,
  assertSafeRepositoryPath,
  resolveInternalPath,
  resolveRepositoryPath,
} from './paths';

export type RepositoryTransactionState =
  | 'prepared'
  | 'committed'
  | 'orphaned';

export interface RepositoryTransactionFile {
  readonly targetPath: string;
  readonly stagedPath: string;
  readonly expectedOldHash: string | null;
  readonly newHash: string;
}

export interface RepositoryTransactionJournal {
  readonly transactionId: string;
  readonly baseGeneration: number;
  readonly targetGeneration: number;
  readonly createdAt: string;
  readonly committedAt?: string;
  readonly orphanedAt?: string;
  readonly orphanedReason?: string;
  readonly state: RepositoryTransactionState;
  readonly files: readonly RepositoryTransactionFile[];
}

export interface RepositoryWrite {
  readonly path: string;
  readonly content: string | Buffer;
  readonly expectedOldHash?: string | null;
}

export interface RepositoryFaultInjector {
  afterTargetWrite?(targetPath: string, completedCount: number): void;
}

function transactionRoot(root: string, transactionId: string): string {
  if (
    !transactionId
    || transactionId === '.'
    || transactionId === '..'
    || !/^[a-zA-Z0-9_-]+$/.test(transactionId)
  ) {
    throw new Error('Harness transaction id is invalid.');
  }
  return resolveInternalPath(root, HARNESS_TRANSACTIONS_DIR, transactionId);
}

function journalPath(root: string, transactionId: string): string {
  return path.join(transactionRoot(root, transactionId), 'journal.json');
}

function syncDirectory(directory: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(directory, 'r');
    fs.fsyncSync(fd);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      process.platform === 'win32'
      && ['EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(code ?? '')
    ) {
      return;
    }
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function writeJournal(root: string, journal: RepositoryTransactionJournal): void {
  const target = journalPath(root, journal.transactionId);
  const temp = `${target}.tmp`;
  const fd = fs.openSync(temp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, target);
  syncDirectory(path.dirname(target));
}

function resolveStagedTransactionPath(
  txRoot: string,
  stagedPath: string,
): string {
  if (!stagedPath || path.isAbsolute(stagedPath)) {
    throw new Error('Harness transaction stagedPath must be relative.');
  }
  const resolvedRoot = path.resolve(txRoot);
  const resolved = path.resolve(resolvedRoot, stagedPath);
  if (
    resolved === resolvedRoot
    || !resolved.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error('Harness transaction stagedPath escapes its transaction.');
  }
  const real = fs.realpathSync.native(resolved);
  if (!real.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Harness transaction stagedPath traverses a symlink.');
  }
  if (!fs.statSync(real).isFile()) {
    throw new Error('Harness transaction stagedPath must identify a file.');
  }
  return real;
}

export function readTransactionJournal(
  root: string,
  transactionId: string,
): RepositoryTransactionJournal {
  return JSON.parse(
    fs.readFileSync(journalPath(root, transactionId), 'utf8'),
  ) as RepositoryTransactionJournal;
}

export function listTransactionJournals(
  root: string,
): readonly RepositoryTransactionJournal[] {
  const transactionsDir = resolveInternalPath(root, HARNESS_TRANSACTIONS_DIR);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(transactionsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const journals: RepositoryTransactionJournal[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      journals.push(readTransactionJournal(root, entry.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const txRoot = transactionRoot(root, entry.name);
      const temp = `${journalPath(root, entry.name)}.tmp`;
      try {
        const recovered = JSON.parse(
          fs.readFileSync(temp, 'utf8'),
        ) as RepositoryTransactionJournal;
        fs.renameSync(temp, journalPath(root, entry.name));
        syncDirectory(txRoot);
        journals.push(recovered);
      } catch (tempError) {
        if ((tempError as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw tempError;
        }
        // Without either a committed journal or its fsynced temporary file,
        // staged bytes have no recoverable intent. Remove only this validated
        // internal transaction directory so one crash remnant cannot hide
        // valid sibling journals forever.
        fs.rmSync(txRoot, { recursive: true, force: true });
      }
    }
  }
  return journals.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function prepareRepositoryTransaction(input: {
  readonly root: string;
  readonly baseGeneration: number;
  readonly targetGeneration: number;
  readonly writes: readonly RepositoryWrite[];
  readonly manifestContent: string;
  readonly expectedManifestHash: string | null;
}): RepositoryTransactionJournal {
  const transactionId = crypto.randomUUID();
  const txRoot = transactionRoot(input.root, transactionId);
  const stagingRoot = path.join(txRoot, 'staging');
  fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });

  const writes: RepositoryWrite[] = [
    ...input.writes,
    {
      path: HARNESS_MANIFEST_FILE,
      content: input.manifestContent,
      expectedOldHash: input.expectedManifestHash,
    },
  ];
  const seen = new Set<string>();
  const files: RepositoryTransactionFile[] = [];

  for (const [index, write] of writes.entries()) {
    assertSafeRepositoryPath(write.path);
    if (seen.has(write.path)) {
      throw new Error(`Repository transaction writes "${write.path}" twice.`);
    }
    seen.add(write.path);
    const stagedName = `${String(index).padStart(4, '0')}.content`;
    const stagedPath = path.join(stagingRoot, stagedName);
    fs.writeFileSync(stagedPath, write.content);
    // Windows FlushFileBuffers (used by fsyncSync) requires a handle opened
    // with write access. These are private staging files we just created, so
    // `r+` preserves the durability contract on every platform.
    const fd = fs.openSync(stagedPath, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    files.push({
      targetPath: write.path,
      stagedPath: path.relative(txRoot, stagedPath),
      expectedOldHash:
        write.expectedOldHash === undefined
          ? hashFile(resolveRepositoryPath(input.root, write.path))
          : write.expectedOldHash,
      newHash: hashBytes(write.content),
    });
  }

  const journal: RepositoryTransactionJournal = {
    transactionId,
    baseGeneration: input.baseGeneration,
    targetGeneration: input.targetGeneration,
    createdAt: new Date().toISOString(),
    state: 'prepared',
    files,
  };
  writeJournal(input.root, journal);
  return journal;
}

function markOrphaned(
  root: string,
  journal: RepositoryTransactionJournal,
  reason: string,
): RepositoryTransactionJournal {
  const orphaned: RepositoryTransactionJournal = {
    ...journal,
    state: 'orphaned',
    orphanedAt: new Date().toISOString(),
    orphanedReason: reason,
  };
  writeJournal(root, orphaned);
  return orphaned;
}

export function applyPreparedTransaction(
  root: string,
  inputJournal: RepositoryTransactionJournal,
  faultInjector?: RepositoryFaultInjector,
): RepositoryTransactionJournal {
  if (inputJournal.state !== 'prepared') return inputJournal;
  const txRoot = transactionRoot(root, inputJournal.transactionId);
  let completedCount = 0;

  try {
    for (const file of inputJournal.files) {
      assertNoSymlinkTraversal(root, file.targetPath);
      const target = resolveRepositoryPath(root, file.targetPath);
      const currentHash = hashFile(target);
      if (currentHash === file.newHash) {
        completedCount++;
        continue;
      }
      if (currentHash !== file.expectedOldHash) {
        return markOrphaned(
          root,
          inputJournal,
          `Expected ${file.expectedOldHash ?? 'missing'} at ${file.targetPath}, `
          + `found ${currentHash ?? 'missing'}.`,
        );
      }

      fs.mkdirSync(path.dirname(target), { recursive: true });
      const staged = resolveStagedTransactionPath(txRoot, file.stagedPath);
      const targetTemp = `${target}.${inputJournal.transactionId}.tmp`;
      fs.copyFileSync(staged, targetTemp);
      // See the staging fsync above: a read-only Windows file handle returns
      // EPERM from FlushFileBuffers even though the file itself is writable.
      const fd = fs.openSync(targetTemp, 'r+');
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(targetTemp, target);
      completedCount++;
      faultInjector?.afterTargetWrite?.(file.targetPath, completedCount);
    }
  } catch (error) {
    // The prepared journal and staging files intentionally remain available
    // for startup recovery.
    throw error;
  }

  const committed: RepositoryTransactionJournal = {
    ...inputJournal,
    state: 'committed',
    committedAt: new Date().toISOString(),
  };
  writeJournal(root, committed);
  fs.rmSync(path.join(txRoot, 'staging'), { recursive: true, force: true });
  return committed;
}

export function recoverPreparedTransactions(
  root: string,
): readonly RepositoryTransactionJournal[] {
  return listTransactionJournals(root)
    .filter((journal) => journal.state === 'prepared')
    .map((journal) => applyPreparedTransaction(root, journal));
}
