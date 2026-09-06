import type { ContentHash, Provenance, ProvenanceSourceKind } from './contracts';

export interface CreateProvenanceInput {
  readonly sourceKind: ProvenanceSourceKind;
  readonly sourceRef: string;
  readonly contentHash?: ContentHash;
  readonly runtimeId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly sessionId?: string;
  readonly jobId?: string;
  readonly methodRef?: string;
  readonly secretMaterial?: 'absent' | 'stripped';
  readonly observedAt?: string;
}

export function createProvenance(input: CreateProvenanceInput): Provenance {
  if (!input.sourceRef.trim()) {
    throw new Error('Provenance sourceRef must not be empty.');
  }
  return {
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    observedAt: input.observedAt ?? new Date().toISOString(),
    secretMaterial: input.secretMaterial ?? 'absent',
    ...(input.contentHash ? { contentHash: input.contentHash } : {}),
    ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.methodRef ? { methodRef: input.methodRef } : {}),
  };
}

export function assertCompleteProvenance(
  provenance: Provenance,
  label = 'provenance',
): void {
  if (!provenance.sourceKind || !provenance.sourceRef) {
    throw new Error(`${label} must identify its source kind and source ref.`);
  }
  if (!Number.isFinite(Date.parse(provenance.observedAt))) {
    throw new Error(`${label}.observedAt must be an ISO-compatible timestamp.`);
  }
  if (
    provenance.secretMaterial !== 'absent'
    && provenance.secretMaterial !== 'stripped'
  ) {
    throw new Error(`${label}.secretMaterial must be absent or stripped.`);
  }
}
