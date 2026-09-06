import path from 'node:path';
import type { JsonObject, PortableContentRef, SecretRef } from '../../contracts';
import { createProvenance } from '../../provenance';
import { formatSecretRef } from '../../secret-ref';
import { assertNoSecretMaterial } from '../../validation';
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
import { hashBytes } from '../../repository';

const ADAPTER_ID = 'claude-code';

function discoveredTextAsset(input: {
  readonly id: string;
  readonly kind: DiscoveredHarnessAsset['kind'];
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
      secretMaterial: 'absent',
    }),
  };
}

function externalSecretRef(
  sourceKey: string,
  scope: string,
): SecretRef {
  return {
    scheme: 'secret',
    namespace: 'external-owned',
    key: `${ADAPTER_ID}/${sourceKey}`,
    scope,
    version: 1,
  };
}

function sanitizedUrl(
  raw: unknown,
  secretRefs: Record<string, string>,
  sourceKey: string,
): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.username || url.password) {
      secretRefs.urlCredentials = formatSecretRef(
        externalSecretRef(`${sourceKey}/url-credentials`, 'machine'),
      );
      url.username = '';
      url.password = '';
    }
    for (const key of Array.from(url.searchParams.keys())) {
      if (/token|key|secret|auth|password/i.test(key)) {
        secretRefs[`query:${key}`] = formatSecretRef(
          externalSecretRef(`${sourceKey}/query/${key}`, 'machine'),
        );
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function sanitizeMcpServer(
  name: string,
  raw: unknown,
  sourceKey: string,
): JsonObject {
  const server = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const secretRefs: Record<string, string> = {};
  const environmentRefs: Record<string, string> = {};
  const headerRefs: Record<string, string> = {};

  if (server.env && typeof server.env === 'object' && !Array.isArray(server.env)) {
    for (const key of Object.keys(server.env as Record<string, unknown>)) {
      environmentRefs[key] = formatSecretRef(
        externalSecretRef(`${sourceKey}/env/${key}`, 'machine'),
      );
    }
  }
  if (
    server.headers
    && typeof server.headers === 'object'
    && !Array.isArray(server.headers)
  ) {
    for (const key of Object.keys(server.headers as Record<string, unknown>)) {
      headerRefs[key] = formatSecretRef(
        externalSecretRef(`${sourceKey}/header/${key}`, 'machine'),
      );
    }
  }

  const url = sanitizedUrl(server.url, secretRefs, sourceKey);
  const sanitized: JsonObject = {
    schemaVersion: 1,
    id: `${ADAPTER_ID}:${name}`,
    displayName: name,
    transport: {
      ...(typeof server.type === 'string' ? { type: server.type } : {}),
      ...(typeof server.command === 'string' ? { command: server.command } : {}),
      ...(Array.isArray(server.args)
        ? { args: server.args.filter((arg): arg is string => typeof arg === 'string') }
        : {}),
      ...(url ? { url } : {}),
    },
    enabled: server.enabled !== false,
    environmentRefs,
    headerRefs,
    secretRefs,
  };
  assertNoSecretMaterial(sanitized, `MCP descriptor ${name}`);
  return sanitized;
}

function discoverMcpFile(input: {
  readonly root: string;
  readonly relativePath: string;
  readonly scopeLabel: string;
  readonly targetPrefix: string;
  readonly assets: DiscoveredHarnessAsset[];
  readonly warnings: string[];
}): void {
  const file = readAdapterFile(input.root, input.relativePath);
  if (!file) return;
  try {
    const parsed = JSON.parse(file.content) as Record<string, unknown>;
    const servers = parsed.mcpServers;
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return;
    for (const [name, server] of Object.entries(servers)) {
      try {
        const content = `${JSON.stringify(
          sanitizeMcpServer(
            name,
            server,
            `${input.scopeLabel}/${safeAdapterSlug(name)}`,
          ),
          null,
          2,
        )}\n`;
        input.assets.push({
          id: `${ADAPTER_ID}:mcp:${input.scopeLabel}:${name}`,
          kind: 'mcp',
          displayName: name,
          sourcePath: file.absolutePath,
          portable: true,
          targetPath:
            `definition/mcp/${input.targetPrefix}/${safeAdapterSlug(name)}.json`,
          content,
          mediaType: 'application/json',
          provenance: createProvenance({
            sourceKind: 'external_framework',
            sourceRef: `${file.absolutePath}#mcpServers.${name}`,
            contentHash: hashBytes(content),
            secretMaterial: 'stripped',
          }),
        });
      } catch (error) {
        input.warnings.push(
          `Skipped MCP server ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch {
    input.warnings.push(`Skipped malformed MCP config: ${file.absolutePath}`);
  }
}

function discoverClaudeRoot(
  input: {
    readonly root: string;
    readonly prefix: string;
    readonly scopeLabel: string;
    readonly targetPrefix: string;
  },
  assets: DiscoveredHarnessAsset[],
  warnings: string[],
): void {
  const addFile = (
    relativePath: string,
    kind: DiscoveredHarnessAsset['kind'],
    id: string,
    targetPath: string,
    displayName: string,
  ) => {
    try {
      const file = readAdapterFile(input.root, relativePath);
      if (!file) return;
      assets.push(discoveredTextAsset({
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

  addFile(
    path.join(input.prefix, 'CLAUDE.md'),
    'rule',
    `${ADAPTER_ID}:rule:${input.scopeLabel}:instructions`,
    `definition/rules/${input.targetPrefix}/instructions.md`,
    `${input.scopeLabel} instructions`,
  );

  for (const name of listAdapterDirectories(
    input.root,
    path.join(input.prefix, 'skills'),
  )) {
    addFile(
      path.join(input.prefix, 'skills', name, 'SKILL.md'),
      'skill',
      `${ADAPTER_ID}:skill:${input.scopeLabel}:${name}`,
      `definition/skills/${input.targetPrefix}/${safeAdapterSlug(name)}/SKILL.md`,
      name,
    );
  }
  for (const filename of listAdapterFiles(
    input.root,
    path.join(input.prefix, 'commands'),
    '.md',
  )) {
    const name = filename.replace(/\.md$/, '');
    addFile(
      path.join(input.prefix, 'commands', filename),
      'rule',
      `${ADAPTER_ID}:command:${input.scopeLabel}:${name}`,
      `definition/rules/${input.targetPrefix}/commands/${safeAdapterSlug(filename)}`,
      `/${name}`,
    );
  }
  discoverMcpFile({
    root: input.root,
    relativePath: path.join(input.prefix, 'settings.json'),
    scopeLabel: `${input.scopeLabel}:settings`,
    targetPrefix: `${input.targetPrefix}/settings`,
    assets,
    warnings,
  });
}

async function discover(input: DiscoverInput): Promise<DiscoveredHarnessAssets> {
  const assets: DiscoveredHarnessAsset[] = [];
  const warnings: string[] = [];
  discoverClaudeRoot({
    root: input.homeRoot,
    prefix: '.claude',
    scopeLabel: 'user',
    targetPrefix: 'claude-code/user',
  }, assets, warnings);
  discoverMcpFile({
    root: input.homeRoot,
    relativePath: '.claude.json',
    scopeLabel: 'user:config',
    targetPrefix: 'claude-code/user-config',
    assets,
    warnings,
  });

  if (input.projectRoot) {
    discoverClaudeRoot({
      root: input.projectRoot,
      prefix: '.claude',
      scopeLabel: 'project',
      targetPrefix: 'claude-code/project',
    }, assets, warnings);
    discoverMcpFile({
      root: input.projectRoot,
      relativePath: '.mcp.json',
      scopeLabel: 'project:file',
      targetPrefix: 'claude-code/project-file',
      assets,
      warnings,
    });
  }
  return { adapterId: ADAPTER_ID, assets, warnings };
}

function selectedRefs(input: Parameters<NonNullable<HarnessAdapter['exportPlan']>>[0]) {
  return allPortableRefs(input.repository.manifest)
    .filter((ref) => !input.refIds || input.refIds.has(ref.id));
}

function mapExportTarget(
  ref: PortableContentRef,
  manifest: ReturnType<typeof selectedManifest>,
): string | undefined {
  if (manifest.skillIds.has(ref.id)) {
    return path.join('.claude', 'skills', safeAdapterSlug(ref.id), 'SKILL.md');
  }
  if (manifest.ruleIds.has(ref.id)) {
    return path.join('.claude', 'commands', `${safeAdapterSlug(ref.id)}.md`);
  }
  return undefined;
}

function selectedManifest(repository: Parameters<NonNullable<HarnessAdapter['exportPlan']>>[0]['repository']) {
  const manifest = repository.manifest;
  return {
    skillIds: new Set(manifest.definition.skillRefs.map((ref) => ref.id)),
    ruleIds: new Set(manifest.definition.ruleRefs.map((ref) => ref.id)),
  };
}

export const claudeCodeHarnessAdapter: HarnessAdapter = {
  descriptor: {
    id: ADAPTER_ID,
    displayName: 'Claude Code',
    integrationLevels: ['discover', 'portable'],
    sourceKinds: ['rules', 'skills', 'commands', 'mcp'],
    supportsExplicitExport: true,
  },
  discover,
  importPlan: buildAdapterImportPlan,
  async exportPlan(input) {
    const manifestKinds = selectedManifest(input.repository);
    return buildExportPlan({
      adapterId: ADAPTER_ID,
      targetRoot: input.targetRoot,
      refs: selectedRefs(input),
      read: (ref) => input.repository.read(ref.path),
      mapTarget: (ref) => mapExportTarget(ref, manifestKinds),
    });
  },
  project(input) {
    const portableIds = new Set([
      ...input.manifest.definition.ruleRefs,
      ...input.manifest.definition.skillRefs,
      ...input.manifest.definition.mcpRefs,
    ].map((ref) => ref.id));
    return buildProjectionOverlay({
      adapterId: ADAPTER_ID,
      manifest: input.manifest,
      runtimeId: input.runtimeId,
      supports: (ref) => portableIds.has(ref.id),
    });
  },
};
