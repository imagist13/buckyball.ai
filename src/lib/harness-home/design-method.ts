import crypto from 'node:crypto';
import type {
  AssetRef,
  CreativeMethodDefinition,
  HarnessHomeManifest,
  HarnessScope,
  PortableContentRef,
  ProvenanceSourceKind,
} from './contracts';
import { hashBytes } from './repository/hash';
import { FileHarnessRepository } from './repository/file-repository';
import { harnessScopeApplies, type HarnessScopeContext } from './scope';
import {
  assertNoSecretMaterial,
  validateCreativeMethod,
} from './validation';

export const CREATIVE_METHOD_MEDIA_TYPE =
  'application/vnd.harness-home.creative-method+json';
export const CREATIVE_METHOD_GUIDE_MEDIA_TYPE =
  'text/vnd.harness-home.creative-method+markdown';

export interface CreativeMethodRecord {
  readonly definition: CreativeMethodDefinition;
  readonly definitionRef: PortableContentRef;
  readonly guideRef: PortableContentRef;
}

export interface WriteCreativeMethodInput {
  readonly id: string;
  readonly version: string;
  readonly status: CreativeMethodDefinition['status'];
  readonly title: string;
  readonly summary: string;
  readonly scope: HarnessScope;
  readonly triggers: readonly string[];
  readonly nonTriggers: readonly string[];
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly steps: readonly string[];
  readonly modalities: readonly string[];
  readonly referenceRefs: readonly AssetRef[];
  readonly counterexampleRefs: readonly AssetRef[];
  readonly critiqueCriteria: readonly string[];
  readonly changelog: CreativeMethodDefinition['changelog'];
  readonly overridePolicy: CreativeMethodDefinition['overridePolicy'];
  readonly confirmationEvidenceRef?: PortableContentRef | AssetRef;
  readonly confirmedAt?: string;
  readonly sourceKind?: ProvenanceSourceKind;
  readonly sourceRef: string;
  readonly observedAt?: string;
  readonly expectedContentHash?: string;
}

export type WriteCreativeMethodResult =
  | {
    readonly status: 'unchanged';
    readonly generation: number;
    readonly record: CreativeMethodRecord;
  }
  | {
    readonly status: 'created' | 'updated';
    readonly generation: number;
    readonly transactionId: string;
    readonly record: CreativeMethodRecord;
  };

export interface CreativeMethodSelection {
  readonly selected: readonly CreativeMethodRecord[];
  readonly rejected: readonly {
    readonly id: string;
    readonly reason:
      | 'candidate'
      | 'retired'
      | 'scope_mismatch'
      | 'evidence_unavailable'
      | 'non_trigger'
      | 'no_trigger'
      | 'unknown_explicit_id';
  }[];
}

function validateId(id: string): string {
  const value = id.trim();
  if (!value || value.length > 160 || /[\u0000-\u001f]/.test(value)) {
    throw new Error(
      'Creative Method id must be 1-160 characters without control characters.',
    );
  }
  return value;
}

function methodSlug(id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'method';
  const suffix = crypto.createHash('sha256').update(id).digest('hex').slice(0, 10);
  return `${slug}-${suffix}`;
}

function serializeDefinition(definition: CreativeMethodDefinition): string {
  return `${JSON.stringify(definition, null, 2)}\n`;
}

function assetBreadcrumb(ref: AssetRef): string {
  return `${ref.assetId}${ref.kind ? ` (${ref.kind})` : ''}`;
}

function renderProgressiveGuide(
  definition: Omit<CreativeMethodDefinition, 'progressiveDisclosureRef'>,
): string {
  const lines = [
    `# ${definition.title}`,
    '',
    `Method: ${definition.id}@${definition.version}`,
    `Status: ${definition.status}`,
    `Source: ${definition.source.sourceRef}`,
    '',
    definition.summary,
    '',
    '## Use when',
    ...definition.triggers.map((trigger) => `- ${trigger}`),
    '',
    '## Do not use when',
    ...(definition.nonTriggers.length > 0
      ? definition.nonTriggers.map((trigger) => `- ${trigger}`)
      : ['- No explicit non-trigger is recorded.']),
    '',
    '## Steps',
    ...definition.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## Critique criteria',
    ...definition.critiqueCriteria.map((criterion) => `- ${criterion}`),
  ];
  if (definition.referenceRefs.length > 0) {
    lines.push(
      '',
      '## References',
      ...definition.referenceRefs.map((ref) => `- ${assetBreadcrumb(ref)}`),
    );
  }
  if (definition.counterexampleRefs.length > 0) {
    lines.push(
      '',
      '## Counterexamples',
      ...definition.counterexampleRefs.map((ref) => `- ${assetBreadcrumb(ref)}`),
    );
  }
  lines.push(
    '',
    '## Override boundary',
    `- User editable: ${definition.overridePolicy.userEditable ? 'yes' : 'no'}`,
    `- Project override: ${definition.overridePolicy.projectOverride ? 'yes' : 'no'}`,
    '',
  );
  return lines.join('\n');
}

function refRole(ref: PortableContentRef): string {
  return typeof ref.role === 'string' ? ref.role : '';
}

function refMethodId(ref: PortableContentRef): string {
  return typeof ref.methodId === 'string' ? ref.methodId : '';
}

function readDefinition(
  repository: FileHarnessRepository,
  ref: PortableContentRef,
): CreativeMethodDefinition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(repository.read(ref.path).toString('utf8'));
  } catch {
    throw new Error(`Creative Method "${ref.id}" is not valid JSON.`);
  }
  assertNoSecretMaterial(parsed, `Creative Method ${ref.id}`);
  const definition = parsed as CreativeMethodDefinition;
  validateCreativeMethod(definition);
  if (definition.id !== refMethodId(ref)) {
    throw new Error(
      `Creative Method ref "${ref.id}" does not match definition id `
      + `"${definition.id}".`,
    );
  }
  return definition;
}

export function listCreativeMethods(
  repository: FileHarnessRepository,
): readonly CreativeMethodRecord[] {
  const refs = repository.manifest.definition.creativeMethodRefs;
  const guides = new Map(
    refs
      .filter((ref) => refRole(ref) === 'guide')
      .map((ref) => [refMethodId(ref), ref]),
  );
  return refs
    .filter((ref) =>
      ref.mediaType === CREATIVE_METHOD_MEDIA_TYPE
      && refRole(ref) === 'definition')
    .map((definitionRef) => {
      const definition = readDefinition(repository, definitionRef);
      const guideRef = guides.get(definition.id);
      if (!guideRef) {
        throw new Error(
          `Creative Method "${definition.id}" is missing its progressive guide.`,
        );
      }
      if (
        definition.progressiveDisclosureRef.path !== guideRef.path
        || definition.progressiveDisclosureRef.contentHash !== guideRef.contentHash
      ) {
        throw new Error(
          `Creative Method "${definition.id}" guide reference is stale.`,
        );
      }
      return { definition, definitionRef, guideRef };
    });
}

function comparableInput(input: WriteCreativeMethodInput): string {
  return JSON.stringify({
    id: input.id.trim(),
    version: input.version,
    status: input.status,
    title: input.title,
    summary: input.summary,
    scope: input.scope,
    triggers: input.triggers,
    nonTriggers: input.nonTriggers,
    inputs: input.inputs,
    outputs: input.outputs,
    steps: input.steps,
    modalities: input.modalities,
    referenceRefs: input.referenceRefs,
    counterexampleRefs: input.counterexampleRefs,
    critiqueCriteria: input.critiqueCriteria,
    changelog: input.changelog,
    overridePolicy: input.overridePolicy,
    confirmationEvidenceRef: input.confirmationEvidenceRef,
    confirmedAt: input.confirmedAt,
    sourceKind: input.sourceKind ?? 'host_application',
    sourceRef: input.sourceRef,
  });
}

function comparableDefinition(definition: CreativeMethodDefinition): string {
  return JSON.stringify({
    id: definition.id,
    version: definition.version,
    status: definition.status,
    title: definition.title,
    summary: definition.summary,
    scope: definition.scope,
    triggers: definition.triggers,
    nonTriggers: definition.nonTriggers,
    inputs: definition.inputs,
    outputs: definition.outputs,
    steps: definition.steps,
    modalities: definition.modalities,
    referenceRefs: definition.referenceRefs,
    counterexampleRefs: definition.counterexampleRefs,
    critiqueCriteria: definition.critiqueCriteria,
    changelog: definition.changelog,
    overridePolicy: definition.overridePolicy,
    confirmationEvidenceRef: definition.confirmationEvidenceRef,
    confirmedAt: definition.confirmedAt,
    sourceKind: definition.source.sourceKind,
    sourceRef: definition.source.sourceRef,
  });
}

function replaceMethodRefs(
  manifest: HarnessHomeManifest,
  methodId: string,
  refs: readonly PortableContentRef[],
): readonly PortableContentRef[] {
  return [
    ...manifest.definition.creativeMethodRefs.filter(
      (ref) => refMethodId(ref) !== methodId,
    ),
    ...refs,
  ];
}

export function writeCreativeMethod(
  repository: FileHarnessRepository,
  input: WriteCreativeMethodInput,
): WriteCreativeMethodResult {
  if (!repository.writable) {
    throw new Error('Harness repository is read-only.');
  }
  const id = validateId(input.id);
  if (!input.sourceRef.trim()) {
    throw new Error('Creative Method sourceRef must not be empty.');
  }
  const existing = listCreativeMethods(repository)
    .find((record) => record.definition.id === id);
  if (existing && comparableDefinition(existing.definition) === comparableInput({
    ...input,
    id,
  })) {
    return {
      status: 'unchanged',
      generation: repository.manifest.generation,
      record: existing,
    };
  }
  if (existing?.definitionRef.contentHash === input.expectedContentHash) {
    // Exact optimistic-concurrency match; continue to compare content.
  } else if (existing && input.expectedContentHash !== existing.definitionRef.contentHash) {
    throw new Error(
      `Creative Method "${id}" changed since it was read; `
      + `expectedContentHash must equal ${existing.definitionRef.contentHash}.`,
    );
  } else if (!existing && input.expectedContentHash) {
    throw new Error(
      `Creative Method "${id}" does not exist, so expectedContentHash must be omitted.`,
    );
  }
  const slug = methodSlug(id);
  const definitionPath =
    existing?.definitionRef.path ?? `definitions/method/${slug}.json`;
  const guidePath =
    existing?.guideRef.path ?? `definitions/method/${slug}.md`;
  const observedAt = input.observedAt ?? new Date().toISOString();
  const source = {
    sourceKind: input.sourceKind ?? 'host_application',
    sourceRef: input.sourceRef,
    observedAt,
    secretMaterial: 'absent' as const,
  };
  const withoutGuide: Omit<
    CreativeMethodDefinition,
    'progressiveDisclosureRef'
  > = {
    id,
    version: input.version,
    status: input.status,
    title: input.title,
    summary: input.summary,
    source,
    scope: input.scope,
    triggers: input.triggers,
    nonTriggers: input.nonTriggers,
    inputs: input.inputs,
    outputs: input.outputs,
    steps: input.steps,
    modalities: input.modalities,
    referenceRefs: input.referenceRefs,
    counterexampleRefs: input.counterexampleRefs,
    critiqueCriteria: input.critiqueCriteria,
    changelog: input.changelog,
    overridePolicy: input.overridePolicy,
    ...(input.confirmationEvidenceRef
      ? { confirmationEvidenceRef: input.confirmationEvidenceRef }
      : {}),
    ...(input.confirmedAt ? { confirmedAt: input.confirmedAt } : {}),
  };
  const guideContent = renderProgressiveGuide(withoutGuide);
  assertNoSecretMaterial(guideContent, `Creative Method ${id} guide`);
  const guideHash = hashBytes(guideContent);
  const guideRef: PortableContentRef = {
    id: `${id}:guide`,
    methodId: id,
    role: 'guide',
    path: guidePath,
    contentHash: guideHash,
    mediaType: CREATIVE_METHOD_GUIDE_MEDIA_TYPE,
    provenance: {
      ...source,
      contentHash: guideHash,
    },
  };
  const definition: CreativeMethodDefinition = {
    ...withoutGuide,
    progressiveDisclosureRef: guideRef,
  };
  validateCreativeMethod(definition);
  assertNoSecretMaterial(definition, `Creative Method ${id}`);
  const definitionContent = serializeDefinition(definition);
  const definitionHash = hashBytes(definitionContent);
  const definitionRef: PortableContentRef = {
    id: `${id}:definition`,
    methodId: id,
    role: 'definition',
    version: input.version,
    status: input.status,
    path: definitionPath,
    contentHash: definitionHash,
    mediaType: CREATIVE_METHOD_MEDIA_TYPE,
    provenance: {
      ...source,
      contentHash: definitionHash,
    },
  };
  const manifest = repository.manifest;
  const nextManifest: HarnessHomeManifest = {
    ...manifest,
    generation: manifest.generation + 1,
    writtenAt: observedAt,
    definition: {
      ...manifest.definition,
      creativeMethodRefs: replaceMethodRefs(
        manifest,
        id,
        [definitionRef, guideRef],
      ),
    },
  };
  const transaction = repository.commit({
    expectedGeneration: manifest.generation,
    manifest: nextManifest,
    writes: [
      { path: definitionPath, content: definitionContent },
      { path: guidePath, content: guideContent },
    ],
  });
  return {
    status: existing ? 'updated' : 'created',
    generation: nextManifest.generation,
    transactionId: transaction.transactionId,
    record: { definition, definitionRef, guideRef },
  };
}

function triggerMatches(prompt: string, trigger: string): boolean {
  return prompt.includes(trigger.trim().toLocaleLowerCase());
}

/**
 * Progressive disclosure selector. Candidate/retired methods never enter
 * turn context; non-triggers override positive triggers. Explicit selection
 * bypasses trigger matching, but never confirmation or scope boundaries.
 */
export function selectCreativeMethods(input: {
  readonly records: readonly CreativeMethodRecord[];
  readonly userPrompt: string;
  readonly scopeContext: HarnessScopeContext;
  readonly explicitMethodIds?: readonly string[];
  readonly unavailableEvidenceMethodIds?: ReadonlySet<string>;
}): CreativeMethodSelection {
  const prompt = input.userPrompt.toLocaleLowerCase();
  const explicitIds = new Set(input.explicitMethodIds ?? []);
  const rejected: CreativeMethodSelection['rejected'][number][] = [];
  const selected: CreativeMethodRecord[] = [];
  const knownIds = new Set(input.records.map((record) => record.definition.id));
  for (const id of explicitIds) {
    if (!knownIds.has(id)) {
      rejected.push({ id, reason: 'unknown_explicit_id' });
    }
  }
  for (const record of input.records) {
    const method = record.definition;
    if (method.status !== 'confirmed') {
      rejected.push({
        id: method.id,
        reason: method.status === 'candidate' ? 'candidate' : 'retired',
      });
      continue;
    }
    if (input.unavailableEvidenceMethodIds?.has(method.id)) {
      rejected.push({ id: method.id, reason: 'evidence_unavailable' });
      continue;
    }
    if (!harnessScopeApplies(method.scope, input.scopeContext)) {
      rejected.push({ id: method.id, reason: 'scope_mismatch' });
      continue;
    }
    const blocked = method.nonTriggers.some((trigger) =>
      triggerMatches(prompt, trigger));
    if (blocked) {
      rejected.push({ id: method.id, reason: 'non_trigger' });
      continue;
    }
    if (
      !explicitIds.has(method.id)
      && !method.triggers.some((trigger) => triggerMatches(prompt, trigger))
    ) {
      rejected.push({ id: method.id, reason: 'no_trigger' });
      continue;
    }
    selected.push(record);
  }
  return { selected, rejected };
}
