import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  HARNESS_HOME_SCHEMA_VERSION,
  type HarnessHomeManifest,
  type PortableContentRef,
} from '../contracts';
import {
  parseHarnessHomeManifest,
  serializeHarnessHomeManifest,
} from '../manifest';
import { assertNoSecretMaterial } from '../validation';
import { hashBytes, hashFile } from './hash';
import {
  HARNESS_INTERNAL_DIR,
  HARNESS_MANIFEST_FILE,
  assertNoSymlinkTraversal,
  resolveRepositoryPath,
} from './paths';
import {
  RepositoryLockedError,
  RepositoryWriterLease,
  acquireWriterLease,
  inspectWriterLease,
  recoverDeadWriterLease,
  type WriterLeaseMetadata,
} from './writer-lease';
import {
  applyPreparedTransaction,
  prepareRepositoryTransaction,
  recoverPreparedTransactions,
  type RepositoryFaultInjector,
  type RepositoryTransactionJournal,
  type RepositoryWrite,
} from './transaction';

export type RepositoryOpenMode = 'readonly' | 'prefer-writable' | 'require-writable';

export interface FileHarnessRepositoryOptions {
  readonly mode?: RepositoryOpenMode;
  readonly instanceId?: string;
  readonly machineId?: string;
  readonly faultInjector?: RepositoryFaultInjector;
}

export interface RepositoryConsistencyIssue {
  readonly path: string;
  readonly expectedHash: string;
  readonly actualHash: string | null;
  readonly state: 'missing' | 'modified';
}

export interface RepositoryDiagnostics {
  readonly root: string;
  readonly writable: boolean;
  readonly generation: number;
  readonly manifestHash: string;
  readonly lockHolder?: WriterLeaseMetadata;
  readonly consistency: readonly RepositoryConsistencyIssue[];
  readonly stale: boolean;
}

interface ConsistencyCacheEntry {
  readonly expectedHash: string;
  readonly statSignature: string | null;
  readonly actualHash: string | null;
}

const MAX_CONSISTENCY_CACHE_GENERATIONS = 32;
const consistencyCache = new Map<
  string,
  ReadonlyMap<string, ConsistencyCacheEntry>
>();
let consistencyHashReads = 0;

export function getRepositoryConsistencyCacheStats(): {
  readonly cachedGenerations: number;
  readonly contentHashReads: number;
} {
  return {
    cachedGenerations: consistencyCache.size,
    contentHashReads: consistencyHashReads,
  };
}

function contentStatSignature(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath, { bigint: true });
    if (!stat.isFile()) return 'not-a-file';
    return [
      stat.dev,
      stat.ino,
      stat.size,
      stat.mtimeNs,
      stat.ctimeNs,
    ].join(':');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function rememberConsistencyGeneration(
  key: string,
  entries: ReadonlyMap<string, ConsistencyCacheEntry>,
): void {
  consistencyCache.delete(key);
  consistencyCache.set(key, entries);
  while (consistencyCache.size > MAX_CONSISTENCY_CACHE_GENERATIONS) {
    const oldest = consistencyCache.keys().next().value as string | undefined;
    if (!oldest) break;
    consistencyCache.delete(oldest);
  }
}

function emptyManifest(harnessId: string): HarnessHomeManifest {
  return {
    schemaVersion: HARNESS_HOME_SCHEMA_VERSION,
    harnessId,
    generation: 0,
    writtenAt: new Date().toISOString(),
    definition: {
      identityRefs: [],
      ruleRefs: [],
      skillRefs: [],
      mcpRefs: [],
      creativeMethodRefs: [],
    },
    state: {
      memoryRefs: [],
      preferenceRefs: [],
      feedbackRefs: [],
    },
    assetRefs: [],
    runtimeOverlays: {},
    secretRefs: [],
  };
}

function allContentRefs(manifest: HarnessHomeManifest): readonly PortableContentRef[] {
  const refs: PortableContentRef[] = [
    ...manifest.definition.identityRefs,
    ...manifest.definition.ruleRefs,
    ...manifest.definition.skillRefs,
    ...manifest.definition.mcpRefs,
    ...manifest.definition.creativeMethodRefs,
    ...manifest.state.memoryRefs,
    ...manifest.state.preferenceRefs,
    ...manifest.state.feedbackRefs,
  ];
  for (const overlay of Object.values(manifest.runtimeOverlays)) {
    refs.push(...overlay.definitionRefs, ...overlay.stateRefs);
  }
  return refs;
}

function readManifest(root: string): HarnessHomeManifest {
  const content = fs.readFileSync(
    resolveRepositoryPath(root, HARNESS_MANIFEST_FILE),
    'utf8',
  );
  return parseHarnessHomeManifest(JSON.parse(content));
}

function secretScanValue(content: string | Buffer): unknown {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : content;
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      // Invalid JSON is still scanned as text and may be rejected by its
      // content-specific validator later.
    }
  }
  return text;
}

export class FileHarnessRepository {
  readonly root: string;
  readonly #faultInjector?: RepositoryFaultInjector;
  #manifest: HarnessHomeManifest;
  #manifestHash: string;
  #lease?: RepositoryWriterLease;

  private constructor(input: {
    root: string;
    manifest: HarnessHomeManifest;
    manifestHash: string;
    lease?: RepositoryWriterLease;
    faultInjector?: RepositoryFaultInjector;
  }) {
    this.root = input.root;
    this.#manifest = input.manifest;
    this.#manifestHash = input.manifestHash;
    this.#lease = input.lease;
    this.#faultInjector = input.faultInjector;
  }

  static create(
    root: string,
    harnessId: string = crypto.randomUUID(),
    options: FileHarnessRepositoryOptions = {},
  ): FileHarnessRepository {
    fs.mkdirSync(root, { recursive: true });
    const canonicalRoot = fs.realpathSync.native(root);
    const manifestPath = resolveRepositoryPath(canonicalRoot, HARNESS_MANIFEST_FILE);
    if (fs.existsSync(manifestPath)) {
      throw new Error(`Harness repository already exists at ${canonicalRoot}.`);
    }
    const manifest = emptyManifest(harnessId);
    const serialized = serializeHarnessHomeManifest(manifest);
    fs.writeFileSync(manifestPath, serialized, { encoding: 'utf8', flag: 'wx' });
    const lease = options.mode === 'readonly'
      ? undefined
      : acquireWriterLease(canonicalRoot, {
        instanceId: options.instanceId,
        machineId: options.machineId,
        repositoryGeneration: manifest.generation,
      });
    return new FileHarnessRepository({
      root: canonicalRoot,
      manifest,
      manifestHash: hashBytes(serialized),
      lease,
      faultInjector: options.faultInjector,
    });
  }

  static open(
    root: string,
    options: FileHarnessRepositoryOptions = {},
  ): FileHarnessRepository {
    const canonicalRoot = fs.realpathSync.native(root);
    let manifest = readManifest(canonicalRoot);
    let manifestHash = hashFile(
      resolveRepositoryPath(canonicalRoot, HARNESS_MANIFEST_FILE),
    );
    if (!manifestHash) throw new Error('Harness manifest disappeared while opening.');

    let lease: RepositoryWriterLease | undefined;
    const mode = options.mode ?? 'prefer-writable';
    if (mode !== 'readonly') {
      try {
        lease = acquireWriterLease(canonicalRoot, {
          instanceId: options.instanceId,
          machineId: options.machineId,
          repositoryGeneration: manifest.generation,
        });
      } catch (error) {
        if (!(error instanceof RepositoryLockedError)) {
          throw error;
        }
        try {
          // A SIGKILL or power loss leaves the exclusive file behind. Reclaim
          // only the exact observed holder and only when the OS proves its PID
          // is dead. Live or unverifiable locks still fail closed.
          lease = recoverDeadWriterLease(canonicalRoot, {
            expectedInstanceId: error.holder.instanceId,
            instanceId: options.instanceId,
            machineId: options.machineId,
            repositoryGeneration: manifest.generation,
          });
        } catch {
          if (mode === 'require-writable') throw error;
        }
      }
    }
    if (lease) {
      let recoverySucceeded = false;
      try {
        const recovered = recoverPreparedTransactions(canonicalRoot);
        const orphaned = recovered.find((journal) => journal.state === 'orphaned');
        if (orphaned) {
          throw new Error(
            `Harness recovery found an orphaned transaction `
            + `${orphaned.transactionId}: ${orphaned.orphanedReason ?? 'unknown reason'}`,
          );
        }
        if (recovered.length > 0) {
          manifest = readManifest(canonicalRoot);
          manifestHash = hashFile(
            resolveRepositoryPath(canonicalRoot, HARNESS_MANIFEST_FILE),
          );
          if (!manifestHash) {
            throw new Error('Harness manifest disappeared during recovery.');
          }
          lease.refresh(manifest.generation);
        }
        recoverySucceeded = true;
      } finally {
        if (!recoverySucceeded) lease.release();
      }
    }
    return new FileHarnessRepository({
      root: canonicalRoot,
      manifest,
      manifestHash,
      lease,
      faultInjector: options.faultInjector,
    });
  }

  get writable(): boolean {
    return !!this.#lease;
  }

  get manifest(): HarnessHomeManifest {
    return JSON.parse(JSON.stringify(this.#manifest)) as HarnessHomeManifest;
  }

  read(relativePath: string): Buffer {
    assertNoSymlinkTraversal(this.root, relativePath);
    return fs.readFileSync(resolveRepositoryPath(this.root, relativePath));
  }

  refresh(): HarnessHomeManifest {
    const currentHash = hashFile(
      resolveRepositoryPath(this.root, HARNESS_MANIFEST_FILE),
    );
    if (!currentHash) throw new Error('Harness manifest is missing.');
    this.#manifest = readManifest(this.root);
    this.#manifestHash = currentHash;
    return this.manifest;
  }

  scanConsistency(): readonly RepositoryConsistencyIssue[] {
    const cacheKey = `${this.root}\u0000${this.#manifestHash}`;
    const previous = consistencyCache.get(cacheKey);
    const current = new Map<string, ConsistencyCacheEntry>();
    const issues = allContentRefs(this.#manifest).flatMap((ref) => {
      assertNoSymlinkTraversal(this.root, ref.path);
      const filePath = resolveRepositoryPath(this.root, ref.path);
      const statSignature = contentStatSignature(filePath);
      const cached = previous?.get(ref.path);
      const actualHash = (
        cached
        && cached.expectedHash === ref.contentHash
        && cached.statSignature === statSignature
      )
        ? cached.actualHash
        : (() => {
          consistencyHashReads += 1;
          return hashFile(filePath);
        })();
      current.set(ref.path, {
        expectedHash: ref.contentHash,
        statSignature,
        actualHash,
      });
      if (actualHash === ref.contentHash) return [];
      return [{
        path: ref.path,
        expectedHash: ref.contentHash,
        actualHash,
        state: actualHash ? 'modified' as const : 'missing' as const,
      }];
    });
    rememberConsistencyGeneration(cacheKey, current);
    return issues;
  }

  diagnostics(): RepositoryDiagnostics {
    const consistency = this.scanConsistency();
    return {
      root: this.root,
      writable: this.writable,
      generation: this.#manifest.generation,
      manifestHash: this.#manifestHash,
      ...(inspectWriterLease(this.root)
        ? { lockHolder: inspectWriterLease(this.root) }
        : {}),
      consistency,
      stale: consistency.length > 0,
    };
  }

  commit(input: {
    readonly expectedGeneration: number;
    readonly manifest: HarnessHomeManifest;
    readonly writes: readonly RepositoryWrite[];
  }): RepositoryTransactionJournal {
    if (!this.#lease) throw new Error('Harness repository is read-only.');
    this.#lease.assertOwned();

    const diskManifestHash = hashFile(
      resolveRepositoryPath(this.root, HARNESS_MANIFEST_FILE),
    );
    if (diskManifestHash !== this.#manifestHash) {
      throw new Error('Harness manifest changed externally; refresh before writing.');
    }
    if (
      input.expectedGeneration !== this.#manifest.generation
      || input.manifest.generation !== input.expectedGeneration + 1
    ) {
      throw new Error('Harness generation conflict; refusing last-write-wins.');
    }
    if (input.manifest.harnessId !== this.#manifest.harnessId) {
      throw new Error('Harness identity cannot change during a repository commit.');
    }

    const parsedManifest = parseHarnessHomeManifest(input.manifest);
    const writesByPath = new Map(
      input.writes.map((write) => {
        assertNoSecretMaterial(
          secretScanValue(write.content),
          `Repository write ${write.path}`,
        );
        return [write.path, hashBytes(write.content)];
      }),
    );
    const referencedPaths = new Set<string>();
    for (const ref of allContentRefs(parsedManifest)) {
      referencedPaths.add(ref.path);
      const actualHash = writesByPath.get(ref.path)
        ?? hashFile(resolveRepositoryPath(this.root, ref.path));
      if (actualHash !== ref.contentHash) {
        throw new Error(
          `Manifest ref ${ref.id} expects ${ref.contentHash} at ${ref.path}, `
          + `found ${actualHash ?? 'missing'}.`,
        );
      }
    }
    for (const writePath of writesByPath.keys()) {
      if (!referencedPaths.has(writePath)) {
        throw new Error(
          `Repository write ${writePath} is not referenced by the target manifest.`,
        );
      }
    }

    this.#lease.refresh(this.#manifest.generation);
    const journal = prepareRepositoryTransaction({
      root: this.root,
      baseGeneration: this.#manifest.generation,
      targetGeneration: parsedManifest.generation,
      writes: input.writes,
      manifestContent: serializeHarnessHomeManifest(parsedManifest),
      expectedManifestHash: this.#manifestHash,
    });
    const committed = applyPreparedTransaction(
      this.root,
      journal,
      this.#faultInjector,
    );
    if (committed.state !== 'committed') {
      throw new Error(
        `Harness transaction ${committed.transactionId} is ${committed.state}: `
        + `${committed.orphanedReason ?? 'unknown reason'}`,
      );
    }
    this.refresh();
    this.#lease.refresh(this.#manifest.generation);
    return committed;
  }

  watch(onHint: () => void, debounceMs = 100): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watcher = fs.watch(this.root, { recursive: true }, (_event, filename) => {
      if (!filename || filename.startsWith(`${HARNESS_INTERNAL_DIR}${path.sep}`)) {
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(onHint, debounceMs);
    });
    return () => {
      if (timer) clearTimeout(timer);
      watcher.close();
    };
  }

  close(): void {
    this.#lease?.release();
    this.#lease = undefined;
  }
}
