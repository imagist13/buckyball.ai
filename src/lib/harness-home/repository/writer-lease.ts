import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HARNESS_HOME_SCHEMA_VERSION } from '../contracts';
import {
  HARNESS_LOCK_FILE,
  resolveInternalPath,
} from './paths';

export interface WriterLeaseMetadata {
  readonly instanceId: string;
  /** Opaque, non-user-facing identity for the physical machine. */
  readonly machineId: string;
  readonly pid: number;
  readonly processStartedAt: string;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly schemaVersion: number;
  readonly repositoryGeneration: number;
}

export interface AcquireWriterLeaseInput {
  readonly instanceId?: string;
  readonly machineId?: string;
  readonly pid?: number;
  readonly processStartedAt?: string;
  readonly repositoryGeneration: number;
}

export class RepositoryLockedError extends Error {
  constructor(readonly holder: WriterLeaseMetadata) {
    super(
      `Harness repository is already writable by instance ${holder.instanceId} `
      + `(pid ${holder.pid}, heartbeat ${holder.heartbeatAt}).`,
    );
    this.name = 'RepositoryLockedError';
  }
}

function processStartedAt(): string {
  return new Date(Date.now() - process.uptime() * 1000).toISOString();
}

/**
 * Stable but opaque by default. The optional seed gives administrators a
 * rotation path without persisting a hostname or account name in a portable
 * Harness root.
 */
export function currentHarnessMachineId(): string {
  let userIdentity = '';
  try {
    const user = os.userInfo();
    userIdentity = `${user.uid ?? ''}:${user.username}`;
  } catch {
    // Some restricted runtimes do not expose userInfo. The remaining machine
    // properties still provide a stable local recovery boundary.
  }
  const seed = process.env.HARNESS_HOME_MACHINE_ID
    || [os.hostname(), os.platform(), os.arch(), userIdentity].join('\0');
  return `sha256:${crypto.createHash('sha256').update(seed).digest('hex')}`;
}

function lockPath(root: string): string {
  return resolveInternalPath(root, HARNESS_LOCK_FILE);
}

function parseLease(raw: string): WriterLeaseMetadata {
  const parsed = JSON.parse(raw) as Partial<WriterLeaseMetadata>;
  if (
    typeof parsed.instanceId !== 'string'
    || !parsed.instanceId
    || !Number.isSafeInteger(parsed.pid)
    || typeof parsed.processStartedAt !== 'string'
    || typeof parsed.acquiredAt !== 'string'
    || typeof parsed.heartbeatAt !== 'string'
    || !Number.isSafeInteger(parsed.schemaVersion)
    || !Number.isSafeInteger(parsed.repositoryGeneration)
  ) {
    throw new Error('Harness writer lease metadata is malformed.');
  }
  return {
    ...parsed,
    // Pre-machine-identity leases remain visible as conflicts, but the empty
    // identity makes them intentionally ineligible for automatic recovery.
    machineId: typeof parsed.machineId === 'string' ? parsed.machineId : '',
  } as WriterLeaseMetadata;
}

function writeLeaseAtomic(root: string, lease: WriterLeaseMetadata): void {
  const target = lockPath(root);
  const temp = `${target}.${lease.instanceId}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(lease, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(temp, target);
}

export function inspectWriterLease(root: string): WriterLeaseMetadata | undefined {
  try {
    return parseLease(fs.readFileSync(lockPath(root), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export function isLeaseProcessAlive(lease: WriterLeaseMetadata): boolean | undefined {
  if (lease.pid <= 0) return undefined;
  try {
    process.kill(lease.pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return undefined;
    return undefined;
  }
}

export class RepositoryWriterLease {
  #released = false;

  constructor(
    readonly root: string,
    private metadataValue: WriterLeaseMetadata,
  ) {}

  get metadata(): WriterLeaseMetadata {
    return this.metadataValue;
  }

  refresh(repositoryGeneration: number): void {
    this.assertOwned();
    const next: WriterLeaseMetadata = {
      ...this.metadataValue,
      heartbeatAt: new Date().toISOString(),
      repositoryGeneration,
    };
    writeLeaseAtomic(this.root, next);
    this.metadataValue = next;
  }

  assertOwned(): void {
    if (this.#released) throw new Error('Harness writer lease is released.');
    const current = inspectWriterLease(this.root);
    if (!current || current.instanceId !== this.metadataValue.instanceId) {
      throw new Error('Harness writer lease ownership was lost.');
    }
  }

  release(): void {
    if (this.#released) return;
    const current = inspectWriterLease(this.root);
    if (current?.instanceId === this.metadataValue.instanceId) {
      fs.unlinkSync(lockPath(this.root));
    }
    this.#released = true;
  }
}

export function acquireWriterLease(
  root: string,
  input: AcquireWriterLeaseInput,
): RepositoryWriterLease {
  fs.mkdirSync(resolveInternalPath(root), { recursive: true, mode: 0o700 });
  const now = new Date().toISOString();
  const metadata: WriterLeaseMetadata = {
    instanceId: input.instanceId ?? crypto.randomUUID(),
    machineId: input.machineId ?? currentHarnessMachineId(),
    pid: input.pid ?? process.pid,
    processStartedAt: input.processStartedAt ?? processStartedAt(),
    acquiredAt: now,
    heartbeatAt: now,
    schemaVersion: HARNESS_HOME_SCHEMA_VERSION,
    repositoryGeneration: input.repositoryGeneration,
  };
  const target = lockPath(root);

  try {
    const fd = fs.openSync(target, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const holder = inspectWriterLease(root);
    if (!holder) {
      throw new Error('Harness writer lock exists but cannot be inspected.');
    }
    throw new RepositoryLockedError(holder);
  }

  return new RepositoryWriterLease(path.resolve(root), metadata);
}

export interface TakeoverWriterLeaseInput extends AcquireWriterLeaseInput {
  readonly expectedInstanceId: string;
  readonly confirmedByUser: boolean;
}

export function recoverDeadWriterLease(
  root: string,
  input: Omit<TakeoverWriterLeaseInput, 'confirmedByUser'>,
): RepositoryWriterLease {
  const holder = inspectWriterLease(root);
  if (!holder || holder.instanceId !== input.expectedInstanceId) {
    throw new Error('Writer lease changed before recovery; rescan and retry.');
  }
  const claimantMachineId = input.machineId ?? currentHarnessMachineId();
  if (!holder.machineId || holder.machineId !== claimantMachineId) {
    throw new Error(
      'Cannot recover a Harness writer lease owned by another or unknown machine; '
      + 'recovery fails closed.',
    );
  }
  const alive = isLeaseProcessAlive(holder);
  if (alive !== false) {
    throw new Error(
      alive
        ? 'Cannot recover a live Harness writer lease.'
        : 'Cannot prove the Harness writer process is dead; recovery fails closed.',
    );
  }
  fs.unlinkSync(lockPath(root));
  return acquireWriterLease(root, {
    ...input,
    machineId: claimantMachineId,
  });
}

/**
 * Explicit recovery path. It never takes over a live or unverifiable lease,
 * and it requires the caller to confirm the exact observed holder.
 */
export function takeoverDeadWriterLease(
  root: string,
  input: TakeoverWriterLeaseInput,
): RepositoryWriterLease {
  if (!input.confirmedByUser) {
    throw new Error('Writer lease takeover requires explicit user confirmation.');
  }
  return recoverDeadWriterLease(root, input);
}
