import crypto from 'node:crypto';
import type {
  HarnessHomeManifest,
  PortableContentRef,
  Provenance,
} from '../contracts';
import { FileHarnessRepository } from '../repository/file-repository';
import { hashBytes } from '../repository/hash';
import { assertNoSecretMaterial } from '../validation';

export type CanonicalDefinitionKind = 'skill' | 'mcp';

export interface WriteCanonicalDefinitionInput {
  readonly kind: CanonicalDefinitionKind;
  readonly id: string;
  readonly content: string;
  /**
   * Required to replace an existing definition with different bytes. This
   * prevents a stale editor from silently overwriting a newer generation.
   */
  readonly expectedContentHash?: string;
  readonly observedAt?: string;
  readonly sourceRef?: string;
}

export type WriteCanonicalDefinitionResult =
  | {
    readonly status: 'unchanged';
    readonly generation: number;
    readonly ref: PortableContentRef;
  }
  | {
    readonly status: 'created' | 'updated';
    readonly generation: number;
    readonly ref: PortableContentRef;
    readonly transactionId: string;
  };

function validateId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 160) {
    throw new Error('Canonical definition id must be 1-160 characters.');
  }
  if (/[\u0000-\u001f]/.test(trimmed)) {
    throw new Error('Canonical definition id contains control characters.');
  }
  return trimmed;
}

function validateContent(kind: CanonicalDefinitionKind, content: string): void {
  if (!content.trim()) {
    throw new Error('Canonical definition content must not be empty.');
  }
  if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) {
    throw new Error('Canonical definition exceeds the 1 MiB limit.');
  }
  assertNoSecretMaterial(content, `Canonical ${kind} definition`);
  if (kind === 'mcp') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('Canonical MCP definition must be valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Canonical MCP definition must be a JSON object.');
    }
    assertNoSecretMaterial(parsed, 'Canonical MCP definition');
  }
}

function definitionPath(kind: CanonicalDefinitionKind, id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'definition';
  const suffix = crypto.createHash('sha256').update(id).digest('hex').slice(0, 10);
  return `definitions/${kind}/${slug}-${suffix}.${kind === 'mcp' ? 'json' : 'md'}`;
}

function refsFor(
  manifest: HarnessHomeManifest,
  kind: CanonicalDefinitionKind,
): readonly PortableContentRef[] {
  return kind === 'skill'
    ? manifest.definition.skillRefs
    : manifest.definition.mcpRefs;
}

function replaceRefs(
  manifest: HarnessHomeManifest,
  kind: CanonicalDefinitionKind,
  refs: readonly PortableContentRef[],
): HarnessHomeManifest['definition'] {
  return kind === 'skill'
    ? { ...manifest.definition, skillRefs: refs }
    : { ...manifest.definition, mcpRefs: refs };
}

/**
 * Canonical creation/update boundary for Harness Home definitions.
 *
 * It writes only the selected canonical repository. Exporting to an external
 * framework remains a separate, explicit adapter action.
 */
export function writeCanonicalDefinition(
  repository: FileHarnessRepository,
  input: WriteCanonicalDefinitionInput,
): WriteCanonicalDefinitionResult {
  if (!repository.writable) {
    throw new Error('Harness repository is read-only.');
  }
  const id = validateId(input.id);
  validateContent(input.kind, input.content);
  const manifest = repository.manifest;
  const refs = refsFor(manifest, input.kind);
  const existing = refs.find((ref) => ref.id === id);
  const contentHash = hashBytes(input.content);
  if (existing?.contentHash === contentHash) {
    return {
      status: 'unchanged',
      generation: manifest.generation,
      ref: existing,
    };
  }
  if (existing && input.expectedContentHash !== existing.contentHash) {
    throw new Error(
      `Canonical ${input.kind} "${id}" changed since it was read; `
      + `expectedContentHash must equal ${existing.contentHash}.`,
    );
  }
  if (!existing && input.expectedContentHash) {
    throw new Error(
      `Canonical ${input.kind} "${id}" does not exist, so `
      + 'expectedContentHash must be omitted.',
    );
  }

  const refPath = existing?.path ?? definitionPath(input.kind, id);
  const provenance: Provenance = {
    sourceKind: 'host_application',
    sourceRef: input.sourceRef ?? 'api:harness-home/definitions',
    observedAt: input.observedAt ?? new Date().toISOString(),
    contentHash,
    secretMaterial: 'absent',
  };
  const nextRef: PortableContentRef = {
    ...(existing ?? {}),
    id,
    path: refPath,
    contentHash,
    mediaType: input.kind === 'mcp'
      ? 'application/json'
      : 'text/markdown',
    provenance,
  };
  const nextRefs = existing
    ? refs.map((ref) => ref.id === id ? nextRef : ref)
    : [...refs, nextRef];
  const nextManifest: HarnessHomeManifest = {
    ...manifest,
    generation: manifest.generation + 1,
    writtenAt: new Date().toISOString(),
    definition: replaceRefs(manifest, input.kind, nextRefs),
  };
  const transaction = repository.commit({
    expectedGeneration: manifest.generation,
    manifest: nextManifest,
    writes: [{ path: refPath, content: input.content }],
  });
  return {
    status: existing ? 'updated' : 'created',
    generation: nextManifest.generation,
    ref: nextRef,
    transactionId: transaction.transactionId,
  };
}
