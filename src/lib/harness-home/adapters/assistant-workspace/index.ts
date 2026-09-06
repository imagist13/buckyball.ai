import path from 'node:path';
import type { PortableContentRef } from '../../contracts';
import { createProvenance } from '../../provenance';
import { hashBytes } from '../../repository';
import {
  allPortableRefs,
  buildAdapterImportPlan,
  buildExportPlan,
  buildProjectionOverlay,
} from '../base';
import {
  listAdapterFiles,
  readAdapterFile,
  safeAdapterSlug,
} from '../filesystem';
import type {
  DiscoveredHarnessAsset,
  DiscoveredHarnessAssets,
  DiscoverInput,
  HarnessAdapter,
} from '../types';

const ADAPTER_ID = 'assistant-workspace';

const FILE_CANDIDATES = {
  soul: ['soul.md', 'Soul.md', 'SOUL.md'],
  user: ['user.md', 'User.md', 'USER.md', 'PROFILE.md'],
  rules: ['claude.md', 'Claude.md', 'CLAUDE.md', 'AGENTS.md'],
  memory: ['memory.md', 'Memory.md', 'MEMORY.md'],
} as const;

function firstExisting(
  root: string,
  candidates: readonly string[],
): { content: string; absolutePath: string; relativePath: string } | undefined {
  for (const relativePath of candidates) {
    const file = readAdapterFile(root, relativePath);
    if (file) return { ...file, relativePath };
  }
  return undefined;
}

function workspaceAsset(input: {
  readonly id: string;
  readonly kind: 'identity' | 'rule' | 'memory';
  readonly displayName: string;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly content: string;
}): DiscoveredHarnessAsset {
  return {
    ...input,
    portable: true,
    mediaType: 'text/markdown',
    provenance: createProvenance({
      sourceKind: 'user_file',
      sourceRef: input.sourcePath,
      contentHash: hashBytes(input.content),
    }),
  };
}

async function discover(input: DiscoverInput): Promise<DiscoveredHarnessAssets> {
  if (!input.projectRoot) {
    return {
      adapterId: ADAPTER_ID,
      assets: [],
      warnings: ['Assistant Workspace discovery requires projectRoot.'],
    };
  }
  const assets: DiscoveredHarnessAsset[] = [];
  const mappings = [
    {
      key: 'soul',
      kind: 'identity' as const,
      target: 'definition/identity/soul.md',
    },
    {
      key: 'user',
      kind: 'identity' as const,
      target: 'definition/identity/user.md',
    },
    {
      key: 'rules',
      kind: 'rule' as const,
      target: 'definition/rules/assistant-workspace.md',
    },
    {
      key: 'memory',
      kind: 'memory' as const,
      target: 'state/memory.md',
    },
  ] as const;
  for (const mapping of mappings) {
    const file = firstExisting(input.projectRoot, FILE_CANDIDATES[mapping.key]);
    if (!file) continue;
    assets.push(workspaceAsset({
      id: `${ADAPTER_ID}:${mapping.kind}:${mapping.key}`,
      kind: mapping.kind,
      displayName: file.relativePath,
      sourcePath: file.absolutePath,
      targetPath: mapping.target,
      content: file.content,
    }));
  }
  for (const filename of listAdapterFiles(
    input.projectRoot,
    path.join('memory', 'daily'),
    '.md',
  )) {
    const file = readAdapterFile(
      input.projectRoot,
      path.join('memory', 'daily', filename),
    );
    if (!file) continue;
    assets.push(workspaceAsset({
      id: `${ADAPTER_ID}:memory:daily:${filename.replace(/\.md$/, '')}`,
      kind: 'memory',
      displayName: `memory/daily/${filename}`,
      sourcePath: file.absolutePath,
      targetPath: `state/memory/daily/${safeAdapterSlug(filename)}`,
      content: file.content,
    }));
  }
  return { adapterId: ADAPTER_ID, assets, warnings: [] };
}

function selectedRefs(input: Parameters<NonNullable<HarnessAdapter['exportPlan']>>[0]) {
  return allPortableRefs(input.repository.manifest)
    .filter((ref) => !input.refIds || input.refIds.has(ref.id));
}

function mapTarget(
  ref: PortableContentRef,
  identityIds: ReadonlySet<string>,
  ruleIds: ReadonlySet<string>,
  memoryIds: ReadonlySet<string>,
): string | undefined {
  if (ref.id.endsWith(':identity:soul')) return 'soul.md';
  if (ref.id.endsWith(':identity:user')) return 'user.md';
  if (ruleIds.has(ref.id)) return 'AGENTS.md';
  if (ref.id.includes(':memory:daily:')) {
    return path.join('memory', 'daily', path.basename(ref.path));
  }
  if (memoryIds.has(ref.id)) return 'memory.md';
  if (identityIds.has(ref.id)) {
    return path.join('identity', `${safeAdapterSlug(ref.id)}.md`);
  }
  return undefined;
}

export const assistantWorkspaceHarnessAdapter: HarnessAdapter = {
  descriptor: {
    id: ADAPTER_ID,
    displayName: 'Assistant Workspace',
    integrationLevels: ['discover', 'portable'],
    sourceKinds: ['identity', 'rules', 'memory'],
    supportsExplicitExport: true,
  },
  discover,
  importPlan: buildAdapterImportPlan,
  async exportPlan(input) {
    const manifest = input.repository.manifest;
    const identityIds = new Set(manifest.definition.identityRefs.map((ref) => ref.id));
    const ruleIds = new Set(manifest.definition.ruleRefs.map((ref) => ref.id));
    const memoryIds = new Set(manifest.state.memoryRefs.map((ref) => ref.id));
    return buildExportPlan({
      adapterId: ADAPTER_ID,
      targetRoot: input.targetRoot,
      refs: selectedRefs(input),
      read: (ref) => input.repository.read(ref.path),
      mapTarget: (ref) => mapTarget(ref, identityIds, ruleIds, memoryIds),
    });
  },
  project(input) {
    const portableIds = new Set([
      ...input.manifest.definition.identityRefs,
      ...input.manifest.definition.ruleRefs,
      ...input.manifest.state.memoryRefs,
    ].map((ref) => ref.id));
    return buildProjectionOverlay({
      adapterId: ADAPTER_ID,
      manifest: input.manifest,
      runtimeId: input.runtimeId,
      supports: (ref) => portableIds.has(ref.id),
    });
  },
};
