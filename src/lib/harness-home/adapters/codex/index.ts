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
  listAdapterDirectories,
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

const ADAPTER_ID = 'codex';

function textAsset(input: {
  readonly id: string;
  readonly kind: 'rule' | 'skill';
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
      sourceKind: 'external_framework',
      sourceRef: input.sourcePath,
      contentHash: hashBytes(input.content),
    }),
  };
}

function discoverRoot(input: {
  readonly root: string;
  readonly prefix: string;
  readonly scope: string;
  readonly targetPrefix: string;
  readonly includeRootAgents?: boolean;
}, assets: DiscoveredHarnessAsset[], warnings: string[]): void {
  const add = (
    relativePath: string,
    kind: 'rule' | 'skill',
    id: string,
    targetPath: string,
    displayName: string,
  ) => {
    try {
      const file = readAdapterFile(input.root, relativePath);
      if (!file) return;
      assets.push(textAsset({
        id,
        kind,
        displayName,
        sourcePath: file.absolutePath,
        targetPath,
        content: file.content,
      }));
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  };

  add(
    input.includeRootAgents ? 'AGENTS.md' : path.join(input.prefix, 'AGENTS.md'),
    'rule',
    `${ADAPTER_ID}:rule:${input.scope}:agents`,
    `definition/rules/${input.targetPrefix}/AGENTS.md`,
    `${input.scope} AGENTS.md`,
  );

  for (const name of listAdapterDirectories(
    input.root,
    path.join(input.prefix, 'skills'),
  )) {
    add(
      path.join(input.prefix, 'skills', name, 'SKILL.md'),
      'skill',
      `${ADAPTER_ID}:skill:${input.scope}:${name}`,
      `definition/skills/${input.targetPrefix}/${safeAdapterSlug(name)}/SKILL.md`,
      name,
    );
  }
  for (const filename of listAdapterFiles(
    input.root,
    path.join(input.prefix, 'prompts'),
    '.md',
  )) {
    const name = filename.replace(/\.md$/, '');
    add(
      path.join(input.prefix, 'prompts', filename),
      'rule',
      `${ADAPTER_ID}:prompt:${input.scope}:${name}`,
      `definition/rules/${input.targetPrefix}/prompts/${safeAdapterSlug(filename)}`,
      name,
    );
  }

  const config = readAdapterFile(
    input.root,
    path.join(input.prefix, 'config.toml'),
  );
  if (config) {
    assets.push({
      id: `${ADAPTER_ID}:overlay:${input.scope}:config`,
      kind: 'runtime_overlay',
      displayName: `${input.scope} config.toml`,
      sourcePath: config.absolutePath,
      portable: false,
      provenance: createProvenance({
        sourceKind: 'external_framework',
        sourceRef: config.absolutePath,
        secretMaterial: 'stripped',
      }),
      unsupportedReason:
        'config.toml may mix Runtime, MCP and credential-bearing fields; '
        + 'the L1 adapter preserves only its existence until a field-safe parser is available.',
    });
  }
}

async function discover(input: DiscoverInput): Promise<DiscoveredHarnessAssets> {
  const assets: DiscoveredHarnessAsset[] = [];
  const warnings: string[] = [];
  discoverRoot({
    root: input.homeRoot,
    prefix: '.codex',
    scope: 'user',
    targetPrefix: 'codex/user',
  }, assets, warnings);
  if (input.projectRoot) {
    discoverRoot({
      root: input.projectRoot,
      prefix: '.codex',
      scope: 'project',
      targetPrefix: 'codex/project',
      includeRootAgents: true,
    }, assets, warnings);
  }
  return { adapterId: ADAPTER_ID, assets, warnings };
}

function selectedRefs(input: Parameters<NonNullable<HarnessAdapter['exportPlan']>>[0]) {
  return allPortableRefs(input.repository.manifest)
    .filter((ref) => !input.refIds || input.refIds.has(ref.id));
}

function mapTarget(
  ref: PortableContentRef,
  skillIds: ReadonlySet<string>,
  ruleIds: ReadonlySet<string>,
): string | undefined {
  if (skillIds.has(ref.id)) {
    return path.join('.codex', 'skills', safeAdapterSlug(ref.id), 'SKILL.md');
  }
  if (ruleIds.has(ref.id)) {
    return path.join('.codex', 'prompts', `${safeAdapterSlug(ref.id)}.md`);
  }
  return undefined;
}

export const codexHarnessAdapter: HarnessAdapter = {
  descriptor: {
    id: ADAPTER_ID,
    displayName: 'Codex',
    integrationLevels: ['discover', 'portable'],
    sourceKinds: ['rules', 'skills', 'runtime-overlay'],
    supportsExplicitExport: true,
  },
  discover,
  importPlan: buildAdapterImportPlan,
  async exportPlan(input) {
    const manifest = input.repository.manifest;
    const skillIds = new Set(manifest.definition.skillRefs.map((ref) => ref.id));
    const ruleIds = new Set(manifest.definition.ruleRefs.map((ref) => ref.id));
    return buildExportPlan({
      adapterId: ADAPTER_ID,
      targetRoot: input.targetRoot,
      refs: selectedRefs(input),
      read: (ref) => input.repository.read(ref.path),
      mapTarget: (ref) => mapTarget(ref, skillIds, ruleIds),
    });
  },
  project(input) {
    const portableIds = new Set([
      ...input.manifest.definition.ruleRefs,
      ...input.manifest.definition.skillRefs,
    ].map((ref) => ref.id));
    return buildProjectionOverlay({
      adapterId: ADAPTER_ID,
      manifest: input.manifest,
      runtimeId: input.runtimeId,
      supports: (ref) => portableIds.has(ref.id),
    });
  },
};
