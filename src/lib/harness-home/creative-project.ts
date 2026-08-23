import crypto from 'node:crypto';
import { requireAssetKind } from '@/lib/assets/kind-registry';
import type {
  AssetRef,
  HarnessHomeManifest,
  HarnessScope,
  PortableContentRef,
} from './contracts';
import { FileHarnessRepository } from './repository/file-repository';
import { hashBytes } from './repository/hash';
import {
  assertNoSecretMaterial,
  validateHarnessScope,
} from './validation';

export const CREATIVE_PROJECT_MEDIA_TYPE =
  'application/vnd.harness-home.creative-project+json';

export type CreativeOutputStage = 'image' | 'video' | 'html_bundle';

export interface CreativeDirection {
  readonly id: string;
  readonly title: string;
  readonly rationale: string;
  readonly criterionRefs: readonly string[];
}

export interface CreativeDecision {
  readonly directionId: string;
  readonly outcome: 'selected' | 'rejected';
  readonly reason: string;
  readonly evidenceRef: PortableContentRef | AssetRef;
  readonly decidedAt: string;
}

export interface CreativeProjectAsset {
  readonly stage: CreativeOutputStage;
  readonly assetRef: AssetRef;
  readonly parentAssetIds: readonly string[];
  readonly createdAt: string;
}

export interface CreativeExecutionCheckpoint {
  readonly runtimeId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly changedAt: string;
}

export interface CreativeProjectState {
  readonly id: string;
  readonly brief: string;
  readonly scope: HarnessScope;
  readonly methodRef: string;
  readonly methodVersion: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly directions: readonly CreativeDirection[];
  readonly decisions: readonly CreativeDecision[];
  readonly assets: readonly CreativeProjectAsset[];
  readonly executionHistory: readonly CreativeExecutionCheckpoint[];
  readonly unsupported: readonly {
    readonly stage: CreativeOutputStage;
    readonly reason: string;
    readonly recordedAt: string;
  }[];
}

export interface CreativeProjectRecord {
  readonly project: CreativeProjectState;
  readonly ref: PortableContentRef;
}

function nonEmpty(value: string, label: string, max = 10_000): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`${label} must be 1-${max} characters.`);
  }
  return normalized;
}

function iso(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO-compatible timestamp.`);
  }
  return value;
}

function validateEvidenceRef(
  ref: PortableContentRef | AssetRef,
  label: string,
): void {
  const portable = ref as Partial<PortableContentRef>;
  if (
    typeof portable.id === 'string'
    && typeof portable.path === 'string'
    && typeof portable.contentHash === 'string'
  ) {
    nonEmpty(portable.id, `${label}.id`, 240);
    nonEmpty(portable.path, `${label}.path`, 1000);
    nonEmpty(portable.contentHash, `${label}.contentHash`, 240);
    return;
  }
  const assetId = (ref as Partial<AssetRef>).assetId;
  if (typeof assetId !== 'string') {
    throw new Error(`${label} must identify portable content or an Asset.`);
  }
  nonEmpty(assetId, `${label}.assetId`, 240);
}

export function validateCreativeProject(project: CreativeProjectState): void {
  nonEmpty(project.id, 'Creative Project id', 160);
  nonEmpty(project.brief, 'Creative Project brief');
  validateHarnessScope(project.scope, `Creative Project ${project.id} scope`);
  nonEmpty(project.methodRef, 'Creative Project methodRef', 240);
  nonEmpty(project.methodVersion, 'Creative Project methodVersion', 80);
  iso(project.createdAt, 'Creative Project createdAt');
  iso(project.updatedAt, 'Creative Project updatedAt');
  const directionIds = new Set<string>();
  for (const direction of project.directions) {
    const id = nonEmpty(direction.id, 'Creative direction id', 160);
    if (directionIds.has(id)) {
      throw new Error(`Creative direction "${id}" is duplicated.`);
    }
    directionIds.add(id);
    nonEmpty(direction.title, `Creative direction ${id} title`, 240);
    nonEmpty(direction.rationale, `Creative direction ${id} rationale`);
    if (direction.criterionRefs.length === 0) {
      throw new Error(`Creative direction "${id}" requires criterion refs.`);
    }
  }
  for (const decision of project.decisions) {
    if (!directionIds.has(decision.directionId)) {
      throw new Error(
        `Creative decision references unknown direction "${decision.directionId}".`,
      );
    }
    nonEmpty(decision.reason, 'Creative decision reason');
    validateEvidenceRef(decision.evidenceRef, 'Creative decision evidence');
    iso(decision.decidedAt, 'Creative decision decidedAt');
  }
  for (const asset of project.assets) {
    if (asset.assetRef.kind !== asset.stage) {
      throw new Error(
        `Creative asset "${asset.assetRef.assetId}" kind must match stage `
        + `"${asset.stage}".`,
      );
    }
    requireAssetKind(asset.stage);
    nonEmpty(asset.assetRef.assetId, 'Creative asset id', 240);
    iso(asset.createdAt, 'Creative asset createdAt');
  }
  for (const checkpoint of project.executionHistory) {
    nonEmpty(checkpoint.runtimeId, 'Creative checkpoint Runtime', 160);
    nonEmpty(checkpoint.providerId, 'Creative checkpoint Provider', 160);
    nonEmpty(checkpoint.modelId, 'Creative checkpoint Model', 240);
    iso(checkpoint.changedAt, 'Creative checkpoint changedAt');
  }
  for (const unsupported of project.unsupported) {
    requireAssetKind(unsupported.stage);
    nonEmpty(unsupported.reason, 'Unsupported modality reason');
    iso(unsupported.recordedAt, 'Unsupported modality recordedAt');
  }
  assertNoSecretMaterial(project, `Creative Project ${project.id}`);
}

export function createCreativeProject(input: {
  readonly id: string;
  readonly brief: string;
  readonly scope: HarnessScope;
  readonly methodRef: string;
  readonly methodVersion: string;
  readonly runtimeId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly createdAt?: string;
}): CreativeProjectState {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const project: CreativeProjectState = {
    id: input.id,
    brief: input.brief,
    scope: input.scope,
    methodRef: input.methodRef,
    methodVersion: input.methodVersion,
    createdAt,
    updatedAt: createdAt,
    directions: [],
    decisions: [],
    assets: [],
    executionHistory: [{
      runtimeId: input.runtimeId,
      providerId: input.providerId,
      modelId: input.modelId,
      changedAt: createdAt,
    }],
    unsupported: [],
  };
  validateCreativeProject(project);
  return project;
}

export function addCreativeDirections(
  project: CreativeProjectState,
  directions: readonly CreativeDirection[],
  updatedAt = new Date().toISOString(),
): CreativeProjectState {
  if (directions.length < 2) {
    throw new Error('A creative comparison requires at least two directions.');
  }
  const rationales = new Set(
    directions.map((direction) => direction.rationale.trim().toLocaleLowerCase()),
  );
  if (rationales.size !== directions.length) {
    throw new Error('Creative directions require distinct rationales.');
  }
  const next = {
    ...project,
    updatedAt,
    directions: [...project.directions, ...directions],
  };
  validateCreativeProject(next);
  return next;
}

export function recordCreativeDecision(
  project: CreativeProjectState,
  decision: CreativeDecision,
): CreativeProjectState {
  const next = {
    ...project,
    updatedAt: decision.decidedAt,
    decisions: [...project.decisions, decision],
  };
  validateCreativeProject(next);
  return next;
}

export function attachCreativeAsset(
  project: CreativeProjectState,
  asset: CreativeProjectAsset,
): CreativeProjectState {
  const next = {
    ...project,
    updatedAt: asset.createdAt,
    assets: [...project.assets, asset],
  };
  validateCreativeProject(next);
  return next;
}

export function switchCreativeExecution(
  project: CreativeProjectState,
  checkpoint: CreativeExecutionCheckpoint,
): CreativeProjectState {
  const next = {
    ...project,
    updatedAt: checkpoint.changedAt,
    executionHistory: [...project.executionHistory, checkpoint],
  };
  validateCreativeProject(next);
  return next;
}

export function markCreativeStageUnsupported(
  project: CreativeProjectState,
  input: {
    readonly stage: CreativeOutputStage;
    readonly reason: string;
    readonly recordedAt?: string;
  },
): CreativeProjectState {
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  const next = {
    ...project,
    updatedAt: recordedAt,
    unsupported: [
      ...project.unsupported,
      { stage: input.stage, reason: input.reason, recordedAt },
    ],
  };
  validateCreativeProject(next);
  return next;
}

function projectPath(id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'creative-project';
  const suffix = crypto.createHash('sha256').update(id).digest('hex').slice(0, 10);
  return `state/creative-project/${slug}-${suffix}.json`;
}

function readCreativeProject(
  repository: FileHarnessRepository,
  ref: PortableContentRef,
): CreativeProjectState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(repository.read(ref.path).toString('utf8'));
  } catch {
    throw new Error(`Creative Project "${ref.id}" is not valid JSON.`);
  }
  const project = parsed as CreativeProjectState;
  validateCreativeProject(project);
  if (project.id !== ref.id) {
    throw new Error(
      `Creative Project ref "${ref.id}" does not match project id `
      + `"${project.id}".`,
    );
  }
  return project;
}

export function listCreativeProjects(
  repository: FileHarnessRepository,
): readonly CreativeProjectRecord[] {
  return repository.manifest.state.feedbackRefs
    .filter((ref) => ref.mediaType === CREATIVE_PROJECT_MEDIA_TYPE)
    .map((ref) => ({ project: readCreativeProject(repository, ref), ref }));
}

function replaceFeedbackRef(
  manifest: HarnessHomeManifest,
  ref: PortableContentRef,
): readonly PortableContentRef[] {
  const exists = manifest.state.feedbackRefs.some(
    (candidate) =>
      candidate.mediaType === CREATIVE_PROJECT_MEDIA_TYPE
      && candidate.id === ref.id,
  );
  return exists
    ? manifest.state.feedbackRefs.map((candidate) =>
      candidate.mediaType === CREATIVE_PROJECT_MEDIA_TYPE
      && candidate.id === ref.id
        ? ref
        : candidate)
    : [...manifest.state.feedbackRefs, ref];
}

export function writeCreativeProject(
  repository: FileHarnessRepository,
  input: {
    readonly project: CreativeProjectState;
    readonly sourceRef: string;
    readonly expectedContentHash?: string;
  },
): {
  readonly status: 'created' | 'updated' | 'unchanged';
  readonly generation: number;
  readonly record: CreativeProjectRecord;
  readonly transactionId?: string;
} {
  if (!repository.writable) {
    throw new Error('Harness repository is read-only.');
  }
  validateCreativeProject(input.project);
  const existing = listCreativeProjects(repository)
    .find((record) => record.project.id === input.project.id);
  const content = `${JSON.stringify(input.project, null, 2)}\n`;
  const contentHash = hashBytes(content);
  if (existing?.ref.contentHash === contentHash) {
    return {
      status: 'unchanged',
      generation: repository.manifest.generation,
      record: existing,
    };
  }
  if (existing && input.expectedContentHash !== existing.ref.contentHash) {
    throw new Error(
      `Creative Project "${input.project.id}" changed since it was read; `
      + `expectedContentHash must equal ${existing.ref.contentHash}.`,
    );
  }
  if (!existing && input.expectedContentHash) {
    throw new Error(
      `Creative Project "${input.project.id}" does not exist, so `
      + 'expectedContentHash must be omitted.',
    );
  }
  const refPath = existing?.ref.path ?? projectPath(input.project.id);
  const ref: PortableContentRef = {
    ...(existing?.ref ?? {}),
    id: input.project.id,
    methodRef: input.project.methodRef,
    methodVersion: input.project.methodVersion,
    path: refPath,
    contentHash,
    mediaType: CREATIVE_PROJECT_MEDIA_TYPE,
    provenance: {
      sourceKind: 'host_application',
      sourceRef: input.sourceRef,
      observedAt: input.project.updatedAt,
      methodRef: input.project.methodRef,
      contentHash,
      secretMaterial: 'absent',
    },
  };
  const manifest = repository.manifest;
  const nextManifest: HarnessHomeManifest = {
    ...manifest,
    generation: manifest.generation + 1,
    writtenAt: input.project.updatedAt,
    state: {
      ...manifest.state,
      feedbackRefs: replaceFeedbackRef(manifest, ref),
    },
  };
  const transaction = repository.commit({
    expectedGeneration: manifest.generation,
    manifest: nextManifest,
    writes: [{ path: refPath, content }],
  });
  return {
    status: existing ? 'updated' : 'created',
    generation: nextManifest.generation,
    transactionId: transaction.transactionId,
    record: { project: input.project, ref },
  };
}
