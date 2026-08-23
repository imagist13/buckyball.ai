import type {
  HarnessHomeManifest,
  PortableContentRef,
  Provenance,
  TasteMemoryEvidence,
} from './contracts';
import {
  FileHarnessRepository,
  hashBytes,
  hashFile,
  resolveRepositoryPath,
} from './repository';
import type { RepositoryTransactionJournal } from './repository';
import { TASTE_MEMORY_MEDIA_TYPE } from './taste-memory';
import {
  assertNoSecretMaterial,
  validateTasteMemoryEvidence,
} from './validation';

export type HarnessManifestIndex =
  | keyof HarnessHomeManifest['definition']
  | keyof HarnessHomeManifest['state'];

const DEFINITION_INDEXES = new Set<HarnessManifestIndex>([
  'identityRefs',
  'ruleRefs',
  'skillRefs',
  'mcpRefs',
  'creativeMethodRefs',
]);

const STATE_INDEXES = new Set<HarnessManifestIndex>([
  'memoryRefs',
  'preferenceRefs',
  'feedbackRefs',
]);

export interface HarnessImportCandidate {
  readonly id: string;
  readonly index: HarnessManifestIndex;
  readonly targetPath: string;
  readonly content: string | Buffer;
  readonly mediaType?: string;
  readonly provenance: Provenance;
}

export type HarnessImportAction = 'create' | 'skip_same' | 'conflict';

export interface HarnessImportPlanItem {
  readonly candidate: HarnessImportCandidate;
  readonly action: HarnessImportAction;
  readonly contentHash: string;
  readonly existingHash: string | null;
  readonly reason: string;
}

export interface HarnessImportPlan {
  readonly harnessId: string;
  readonly baseGeneration: number;
  readonly items: readonly HarnessImportPlanItem[];
  readonly canApply: boolean;
}

function assertKnownIndex(index: HarnessManifestIndex): void {
  if (!DEFINITION_INDEXES.has(index) && !STATE_INDEXES.has(index)) {
    throw new Error(`Unknown Harness manifest index: ${index}`);
  }
}

function validateCandidateSemantics(candidate: HarnessImportCandidate): void {
  if (
    candidate.index !== 'preferenceRefs'
    || candidate.mediaType !== TASTE_MEMORY_MEDIA_TYPE
  ) {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.isBuffer(candidate.content)
        ? candidate.content.toString('utf8')
        : candidate.content,
    );
  } catch {
    throw new Error(`Taste Memory import "${candidate.id}" is not valid JSON.`);
  }
  validateTasteMemoryEvidence(parsed as TasteMemoryEvidence);
  if ((parsed as TasteMemoryEvidence).id !== candidate.id) {
    throw new Error(
      `Taste Memory import ref "${candidate.id}" does not match evidence id `
      + `"${(parsed as TasteMemoryEvidence).id}".`,
    );
  }
}

function currentRef(
  manifest: HarnessHomeManifest,
  index: HarnessManifestIndex,
  id: string,
): PortableContentRef | undefined {
  assertKnownIndex(index);
  const refs = DEFINITION_INDEXES.has(index)
    ? manifest.definition[index as keyof HarnessHomeManifest['definition']]
    : manifest.state[index as keyof HarnessHomeManifest['state']];
  return (refs as readonly PortableContentRef[]).find((ref) => ref.id === id);
}

export function planHarnessImport(
  repository: FileHarnessRepository,
  candidates: readonly HarnessImportCandidate[],
): HarnessImportPlan {
  const manifest = repository.manifest;
  const seenTargets = new Set<string>();
  const seenIds = new Set<string>();
  const items = candidates.map((candidate): HarnessImportPlanItem => {
    assertKnownIndex(candidate.index);
    if (seenTargets.has(candidate.targetPath) || seenIds.has(`${candidate.index}:${candidate.id}`)) {
      throw new Error(`Import candidate duplicates target or identity: ${candidate.id}`);
    }
    seenTargets.add(candidate.targetPath);
    seenIds.add(`${candidate.index}:${candidate.id}`);
    assertNoSecretMaterial(candidate.content, `Import candidate ${candidate.id}`);
    validateCandidateSemantics(candidate);

    const contentHash = hashBytes(candidate.content);
    const existingRef = currentRef(manifest, candidate.index, candidate.id);
    const existingHash = hashFile(
      resolveRepositoryPath(repository.root, candidate.targetPath),
    );

    if (
      existingRef?.contentHash === contentHash
      && existingRef.path === candidate.targetPath
      && existingHash === contentHash
    ) {
      return {
        candidate,
        action: 'skip_same',
        contentHash,
        existingHash,
        reason: 'Canonical content and identity already match.',
      };
    }
    if (existingRef || (existingHash && existingHash !== contentHash)) {
      return {
        candidate,
        action: 'conflict',
        contentHash,
        existingHash,
        reason: existingRef
          ? 'The canonical identity already points to different content.'
          : 'The target path already contains different content.',
      };
    }
    return {
      candidate,
      action: 'create',
      contentHash,
      existingHash,
      reason: 'New canonical content.',
    };
  });
  return {
    harnessId: manifest.harnessId,
    baseGeneration: manifest.generation,
    items,
    canApply: !items.some((item) => item.action === 'conflict'),
  };
}

function appendRef(
  manifest: HarnessHomeManifest,
  index: HarnessManifestIndex,
  ref: PortableContentRef,
): HarnessHomeManifest {
  if (DEFINITION_INDEXES.has(index)) {
    const key = index as keyof HarnessHomeManifest['definition'];
    return {
      ...manifest,
      definition: {
        ...manifest.definition,
        [key]: [
          ...(manifest.definition[key] as readonly PortableContentRef[]),
          ref,
        ],
      },
    };
  }
  const key = index as keyof HarnessHomeManifest['state'];
  return {
    ...manifest,
    state: {
      ...manifest.state,
      [key]: [
        ...(manifest.state[key] as readonly PortableContentRef[]),
        ref,
      ],
    },
  };
}

export function applyHarnessImportPlan(
  repository: FileHarnessRepository,
  plan: HarnessImportPlan,
): RepositoryTransactionJournal | undefined {
  const current = repository.manifest;
  if (current.harnessId !== plan.harnessId || current.generation !== plan.baseGeneration) {
    throw new Error('Harness import plan is stale; run dry-run again.');
  }
  if (!plan.canApply) {
    throw new Error('Harness import plan contains conflicts and cannot be applied.');
  }

  const creates = plan.items.filter((item) => item.action === 'create');
  if (creates.length === 0) return undefined;

  let next: HarnessHomeManifest = {
    ...current,
    generation: current.generation + 1,
    writtenAt: new Date().toISOString(),
  };
  for (const item of creates) {
    next = appendRef(next, item.candidate.index, {
      id: item.candidate.id,
      path: item.candidate.targetPath,
      contentHash: item.contentHash,
      ...(item.candidate.mediaType ? { mediaType: item.candidate.mediaType } : {}),
      provenance: item.candidate.provenance,
    });
  }

  return repository.commit({
    expectedGeneration: current.generation,
    manifest: next,
    writes: creates.map((item) => ({
      path: item.candidate.targetPath,
      content: item.candidate.content,
      expectedOldHash: null,
    })),
  });
}
