import crypto from 'node:crypto';
import type {
  AssetRef,
  HarnessHomeManifest,
  HarnessScope,
  PortableContentRef,
  TasteMemoryClass,
  TasteMemoryEvidence,
} from './contracts';
import { FileHarnessRepository } from './repository/file-repository';
import { hashBytes } from './repository/hash';
import {
  harnessScopeApplies,
  harnessScopeRank,
  type HarnessScopeContext,
} from './scope';
import {
  assertNoSecretMaterial,
  validateTasteMemoryEvidence,
} from './validation';

export const TASTE_MEMORY_MEDIA_TYPE =
  'application/vnd.harness-home.taste-memory+json';

export interface TasteMemoryRecord {
  readonly evidence: TasteMemoryEvidence;
  readonly ref: PortableContentRef;
}

export interface InvalidTasteMemoryRecord {
  readonly id: string;
  readonly path: string;
  readonly contentHash: string;
  readonly reason: string;
}

export interface TasteMemoryReadResult {
  readonly records: readonly TasteMemoryRecord[];
  readonly invalid: readonly InvalidTasteMemoryRecord[];
}

export interface WriteTasteMemoryInput {
  readonly id: string;
  readonly preferenceKey: string;
  readonly classification: TasteMemoryClass;
  readonly statement: string;
  readonly evidenceRef: PortableContentRef | AssetRef;
  readonly scope: HarnessScope;
  readonly confidence: number;
  readonly affectedMethodIds: readonly string[];
  readonly lastConfirmedAt?: string;
  readonly observedAt?: string;
  readonly sourceRef: string;
  readonly expectedContentHash?: string;
}

export type WriteTasteMemoryResult =
  | {
    readonly status: 'unchanged';
    readonly generation: number;
    readonly record: TasteMemoryRecord;
  }
  | {
    readonly status: 'created' | 'updated' | 'revoked';
    readonly generation: number;
    readonly transactionId: string;
    readonly record: TasteMemoryRecord;
  };

export interface TasteMemoryConflict {
  readonly preferenceKey: string;
  readonly scopeRank: number;
  readonly evidenceIds: readonly string[];
  readonly reason: 'same_scope_conflict';
}

export interface TasteMemoryProjection {
  readonly selected: readonly TasteMemoryRecord[];
  readonly conflicts: readonly TasteMemoryConflict[];
  readonly ignored: readonly {
    readonly id: string;
    readonly reason:
      | 'revoked'
      | 'scope_mismatch'
      | 'evidence_unavailable'
      | 'overridden';
  }[];
}

function normalizedField(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 240 || /[\u0000-\u001f]/.test(normalized)) {
    throw new Error(
      `Taste Memory ${label} must be 1-240 characters without control characters.`,
    );
  }
  return normalized;
}

function tastePath(id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'taste';
  const suffix = crypto.createHash('sha256').update(id).digest('hex').slice(0, 10);
  return `state/taste/${slug}-${suffix}.json`;
}

function readTasteMemory(
  repository: FileHarnessRepository,
  ref: PortableContentRef,
): TasteMemoryEvidence {
  let parsed: unknown;
  try {
    parsed = JSON.parse(repository.read(ref.path).toString('utf8'));
  } catch {
    throw new Error(`Taste Memory "${ref.id}" is not valid JSON.`);
  }
  assertNoSecretMaterial(parsed, `Taste Memory ${ref.id}`);
  const evidence = parsed as TasteMemoryEvidence;
  validateTasteMemoryEvidence(evidence);
  if (evidence.id !== ref.id) {
    throw new Error(
      `Taste Memory ref "${ref.id}" does not match evidence id `
      + `"${evidence.id}".`,
    );
  }
  return evidence;
}

export function listTasteMemories(
  repository: FileHarnessRepository,
): readonly TasteMemoryRecord[] {
  return inspectTasteMemories(repository).records;
}

export function inspectTasteMemories(
  repository: FileHarnessRepository,
): TasteMemoryReadResult {
  const records: TasteMemoryRecord[] = [];
  const invalid: InvalidTasteMemoryRecord[] = [];
  for (const ref of repository.manifest.state.preferenceRefs) {
    if (ref.mediaType !== TASTE_MEMORY_MEDIA_TYPE) continue;
    try {
      records.push({ evidence: readTasteMemory(repository, ref), ref });
    } catch (error) {
      invalid.push({
        id: ref.id,
        path: ref.path,
        contentHash: ref.contentHash,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { records, invalid };
}

function comparableInput(input: WriteTasteMemoryInput): string {
  return JSON.stringify({
    id: input.id.trim(),
    preferenceKey: input.preferenceKey.trim(),
    classification: input.classification,
    statement: input.statement.trim(),
    evidenceRef: input.evidenceRef,
    scope: input.scope,
    confidence: input.confidence,
    affectedMethodIds: input.affectedMethodIds,
    lastConfirmedAt: input.lastConfirmedAt,
    sourceRef: input.sourceRef,
  });
}

function comparableRecord(record: TasteMemoryRecord): string {
  return JSON.stringify({
    id: record.evidence.id,
    preferenceKey: record.evidence.preferenceKey,
    classification: record.evidence.classification,
    statement: record.evidence.statement,
    evidenceRef: record.evidence.evidenceRef,
    scope: record.evidence.scope,
    confidence: record.evidence.confidence,
    affectedMethodIds: record.evidence.affectedMethodIds,
    lastConfirmedAt: record.evidence.lastConfirmedAt,
    sourceRef: record.ref.provenance?.sourceRef,
  });
}

function replacePreferenceRef(
  manifest: HarnessHomeManifest,
  ref: PortableContentRef,
): readonly PortableContentRef[] {
  const exists = manifest.state.preferenceRefs.some(
    (candidate) =>
      candidate.mediaType === TASTE_MEMORY_MEDIA_TYPE
      && candidate.id === ref.id,
  );
  return exists
    ? manifest.state.preferenceRefs.map((candidate) =>
      candidate.mediaType === TASTE_MEMORY_MEDIA_TYPE
      && candidate.id === ref.id
        ? ref
        : candidate)
    : [...manifest.state.preferenceRefs, ref];
}

function commitTasteMemory(
  repository: FileHarnessRepository,
  evidence: TasteMemoryEvidence,
  input: {
    readonly sourceRef: string;
    readonly existing?: TasteMemoryRecord;
    readonly resultStatus: 'created' | 'updated' | 'revoked';
  },
): WriteTasteMemoryResult {
  validateTasteMemoryEvidence(evidence);
  assertNoSecretMaterial(evidence, `Taste Memory ${evidence.id}`);
  const content = `${JSON.stringify(evidence, null, 2)}\n`;
  const contentHash = hashBytes(content);
  const refPath = input.existing?.ref.path ?? tastePath(evidence.id);
  const ref: PortableContentRef = {
    ...(input.existing?.ref ?? {}),
    id: evidence.id,
    preferenceKey: evidence.preferenceKey,
    classification: evidence.classification,
    revoked: !!evidence.revokedAt,
    path: refPath,
    contentHash,
    mediaType: TASTE_MEMORY_MEDIA_TYPE,
    provenance: {
      sourceKind: 'host_application',
      sourceRef: input.sourceRef,
      observedAt: evidence.updatedAt,
      contentHash,
      secretMaterial: 'absent',
    },
  };
  const manifest = repository.manifest;
  const nextManifest: HarnessHomeManifest = {
    ...manifest,
    generation: manifest.generation + 1,
    writtenAt: evidence.updatedAt,
    state: {
      ...manifest.state,
      preferenceRefs: replacePreferenceRef(manifest, ref),
    },
  };
  const transaction = repository.commit({
    expectedGeneration: manifest.generation,
    manifest: nextManifest,
    writes: [{ path: refPath, content }],
  });
  return {
    status: input.resultStatus,
    generation: nextManifest.generation,
    transactionId: transaction.transactionId,
    record: { evidence, ref },
  };
}

/**
 * The only creation/update boundary. Evidence is mandatory and classification
 * is explicit; no selection event is silently upgraded to a durable user
 * preference.
 */
export function writeTasteMemory(
  repository: FileHarnessRepository,
  input: WriteTasteMemoryInput,
): WriteTasteMemoryResult {
  if (!repository.writable) {
    throw new Error('Harness repository is read-only.');
  }
  const id = normalizedField(input.id, 'id');
  const preferenceKey = normalizedField(input.preferenceKey, 'preferenceKey');
  const sourceRef = normalizedField(input.sourceRef, 'sourceRef');
  const inspection = inspectTasteMemories(repository);
  const invalidExisting = inspection.invalid.find((record) => record.id === id);
  if (invalidExisting) {
    throw new Error(
      `Taste Memory "${id}" is invalid and must be repaired before update: `
      + invalidExisting.reason,
    );
  }
  const existing = inspection.records
    .find((record) => record.evidence.id === id);
  const normalizedInput = {
    ...input,
    id,
    preferenceKey,
    statement: input.statement.trim(),
    sourceRef,
  };
  if (existing && comparableRecord(existing) === comparableInput(normalizedInput)) {
    return {
      status: 'unchanged',
      generation: repository.manifest.generation,
      record: existing,
    };
  }
  if (existing && input.expectedContentHash !== existing.ref.contentHash) {
    throw new Error(
      `Taste Memory "${id}" changed since it was read; `
      + `expectedContentHash must equal ${existing.ref.contentHash}.`,
    );
  }
  if (!existing && input.expectedContentHash) {
    throw new Error(
      `Taste Memory "${id}" does not exist, so expectedContentHash must be omitted.`,
    );
  }
  const now = input.observedAt ?? new Date().toISOString();
  const evidence: TasteMemoryEvidence = {
    id,
    preferenceKey,
    classification: input.classification,
    statement: input.statement.trim(),
    evidenceRef: input.evidenceRef,
    scope: input.scope,
    confidence: input.confidence,
    createdAt: existing?.evidence.createdAt ?? now,
    updatedAt: now,
    ...(input.lastConfirmedAt
      ? { lastConfirmedAt: input.lastConfirmedAt }
      : {}),
    affectedMethodIds: input.affectedMethodIds,
  };
  return commitTasteMemory(repository, evidence, {
    sourceRef,
    existing,
    resultStatus: existing ? 'updated' : 'created',
  });
}

export function revokeTasteMemory(
  repository: FileHarnessRepository,
  input: {
    readonly id: string;
    readonly reason: string;
    readonly expectedContentHash: string;
    readonly revokedAt?: string;
    readonly sourceRef?: string;
  },
): WriteTasteMemoryResult {
  if (!repository.writable) {
    throw new Error('Harness repository is read-only.');
  }
  const id = normalizedField(input.id, 'id');
  const reason = input.reason.trim();
  if (!reason) throw new Error('Taste Memory revoke reason must not be empty.');
  const inspection = inspectTasteMemories(repository);
  const invalidExisting = inspection.invalid.find((record) => record.id === id);
  if (invalidExisting) {
    throw new Error(
      `Taste Memory "${id}" is invalid and must be repaired before revoke: `
      + invalidExisting.reason,
    );
  }
  const existing = inspection.records
    .find((record) => record.evidence.id === id);
  if (!existing) throw new Error(`Taste Memory "${id}" does not exist.`);
  if (existing.ref.contentHash !== input.expectedContentHash) {
    throw new Error(
      `Taste Memory "${id}" changed since it was read; `
      + `expectedContentHash must equal ${existing.ref.contentHash}.`,
    );
  }
  if (existing.evidence.revokedAt) {
    return {
      status: 'unchanged',
      generation: repository.manifest.generation,
      record: existing,
    };
  }
  const revokedAt = input.revokedAt ?? new Date().toISOString();
  return commitTasteMemory(
    repository,
    {
      ...existing.evidence,
      updatedAt: revokedAt,
      revokedAt,
      revokeReason: reason,
    },
    {
      sourceRef: input.sourceRef ?? 'api:harness-home/taste-memory/revoke',
      existing,
      resultStatus: 'revoked',
    },
  );
}

/**
 * Narrower scopes override broader scopes. Conflicting statements at the same
 * rank are withheld from model context and returned as diagnostics so the
 * user can resolve them explicitly.
 */
export function resolveTasteMemoryProjection(input: {
  readonly records: readonly TasteMemoryRecord[];
  readonly scopeContext: HarnessScopeContext;
  readonly unavailableEvidenceIds?: ReadonlySet<string>;
}): TasteMemoryProjection {
  const ignored: TasteMemoryProjection['ignored'][number][] = [];
  const applicable = input.records.filter((record) => {
    if (input.unavailableEvidenceIds?.has(record.evidence.id)) {
      ignored.push({
        id: record.evidence.id,
        reason: 'evidence_unavailable',
      });
      return false;
    }
    if (record.evidence.revokedAt) {
      ignored.push({ id: record.evidence.id, reason: 'revoked' });
      return false;
    }
    if (!harnessScopeApplies(record.evidence.scope, input.scopeContext)) {
      ignored.push({ id: record.evidence.id, reason: 'scope_mismatch' });
      return false;
    }
    return true;
  });
  const groups = new Map<string, TasteMemoryRecord[]>();
  for (const record of applicable) {
    const entries = groups.get(record.evidence.preferenceKey) ?? [];
    entries.push(record);
    groups.set(record.evidence.preferenceKey, entries);
  }
  const selected: TasteMemoryRecord[] = [];
  const conflicts: TasteMemoryConflict[] = [];
  for (const [preferenceKey, entries] of groups) {
    const maxRank = Math.max(
      ...entries.map((record) => harnessScopeRank(record.evidence.scope)),
    );
    const winners = entries.filter(
      (record) => harnessScopeRank(record.evidence.scope) === maxRank,
    );
    for (const entry of entries) {
      if (!winners.includes(entry)) {
        ignored.push({ id: entry.evidence.id, reason: 'overridden' });
      }
    }
    const statements = new Set(
      winners.map((record) => record.evidence.statement.trim().toLocaleLowerCase()),
    );
    if (statements.size > 1) {
      conflicts.push({
        preferenceKey,
        scopeRank: maxRank,
        evidenceIds: winners.map((record) => record.evidence.id),
        reason: 'same_scope_conflict',
      });
      continue;
    }
    selected.push(
      [...winners].sort((a, b) => {
        const confidence = b.evidence.confidence - a.evidence.confidence;
        if (confidence !== 0) return confidence;
        return b.evidence.updatedAt.localeCompare(a.evidence.updatedAt);
      })[0],
    );
  }
  return { selected, conflicts, ignored };
}

function evidenceBreadcrumb(ref: PortableContentRef | AssetRef): string {
  return 'assetId' in ref
    ? `asset:${ref.assetId}`
    : `file:${ref.path}#${ref.contentHash}`;
}

export function renderTasteMemory(record: TasteMemoryRecord): string {
  const evidence = record.evidence;
  return [
    `Preference key: ${evidence.preferenceKey}`,
    `Classification: ${evidence.classification}`,
    `Statement: ${evidence.statement}`,
    `Confidence: ${evidence.confidence}`,
    `Evidence: ${evidenceBreadcrumb(evidence.evidenceRef)}`,
    `Last confirmed: ${evidence.lastConfirmedAt ?? 'not explicitly confirmed'}`,
  ].join('\n');
}
