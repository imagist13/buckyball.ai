import fs from 'node:fs';
import path from 'node:path';
import type {
  HarnessHomeManifest,
  PortableContentRef,
} from '../contracts';
import {
  planHarnessImport,
  type HarnessImportCandidate,
  type HarnessManifestIndex,
} from '../migration';
import { hashFile } from '../repository';
import type {
  DiscoveredHarnessAsset,
  HarnessExportPlan,
  HarnessExportPlanWrite,
  HarnessImportInput,
  HarnessImportPlanResult,
  HarnessProjectionOverlay,
} from './types';
import {
  assertExternalPathHasNoSymlink,
  safeResolveExternalPath,
} from './filesystem';

const INDEX_FOR_KIND: Partial<Record<
DiscoveredHarnessAsset['kind'],
HarnessManifestIndex
>> = {
  identity: 'identityRefs',
  rule: 'ruleRefs',
  memory: 'memoryRefs',
  skill: 'skillRefs',
  mcp: 'mcpRefs',
};

export async function buildAdapterImportPlan(
  input: HarnessImportInput,
): Promise<HarnessImportPlanResult> {
  const unsupported = input.discovered.assets.filter((asset) =>
    !asset.portable
    || !asset.targetPath
    || asset.content === undefined
    || !INDEX_FOR_KIND[asset.kind]);
  const candidates: HarnessImportCandidate[] = input.discovered.assets
    .filter((asset) => !unsupported.includes(asset))
    .map((asset) => ({
      id: asset.id,
      index: INDEX_FOR_KIND[asset.kind]!,
      targetPath: asset.targetPath!,
      content: asset.content!,
      mediaType: asset.mediaType,
      provenance: asset.provenance,
    }));
  return {
    plan: planHarnessImport(input.repository, candidates),
    unsupported,
  };
}

export function allPortableRefs(
  manifest: HarnessHomeManifest,
): readonly PortableContentRef[] {
  return [
    ...manifest.definition.identityRefs,
    ...manifest.definition.ruleRefs,
    ...manifest.definition.skillRefs,
    ...manifest.definition.mcpRefs,
    ...manifest.definition.creativeMethodRefs,
    ...manifest.state.memoryRefs,
    ...manifest.state.preferenceRefs,
    ...manifest.state.feedbackRefs,
  ];
}

export async function buildProjectionOverlay(input: {
  readonly adapterId: string;
  readonly manifest: HarnessHomeManifest;
  readonly runtimeId: string;
  readonly supports: (ref: PortableContentRef) => boolean;
}): Promise<HarnessProjectionOverlay> {
  const refs = allPortableRefs(input.manifest);
  const supported = refs.filter(input.supports);
  return {
    adapterId: input.adapterId,
    runtimeId: input.runtimeId,
    refs: supported,
    unsupportedReasons: refs
      .filter((ref) => !input.supports(ref))
      .map((ref) => `${ref.id} has no ${input.adapterId} portable mapping.`),
  };
}

export function buildExportPlan(input: {
  readonly adapterId: string;
  readonly targetRoot: string;
  readonly refs: readonly PortableContentRef[];
  readonly read: (ref: PortableContentRef) => Buffer;
  readonly mapTarget: (ref: PortableContentRef) => string | undefined;
}): HarnessExportPlan {
  const writes: HarnessExportPlanWrite[] = input.refs.map((ref) => {
    const content = input.read(ref);
    const targetPath = input.mapTarget(ref);
    if (!targetPath) {
      return {
        refId: ref.id,
        targetPath: '',
        content,
        action: 'unsupported',
        expectedOldHash: null,
        newHash: ref.contentHash,
        reason: `No ${input.adapterId} export mapping for ${ref.id}.`,
      };
    }
    const state = (() => {
      try {
        const absolute = safeResolveExternalPath(input.targetRoot, targetPath);
        const existingHash = hashFile(absolute);
        if (!existingHash) {
          return {
            action: 'create' as const,
            expectedOldHash: null,
            reason: 'External target does not exist.',
          };
        }
        if (existingHash === ref.contentHash) {
          return {
            action: 'skip_same' as const,
            expectedOldHash: existingHash,
            reason: 'External target already has the same content.',
          };
        }
        return {
          action: 'conflict' as const,
          expectedOldHash: existingHash,
          reason: 'External target differs and will not be overwritten.',
        };
      } catch (error) {
        return {
          action: 'conflict' as const,
          expectedOldHash: null,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    })();
    return {
      refId: ref.id,
      targetPath,
      content,
      action: state.action,
      expectedOldHash: state.expectedOldHash,
      newHash: ref.contentHash,
      reason: state.reason,
    };
  });
  return {
    adapterId: input.adapterId,
    targetRoot: path.resolve(input.targetRoot),
    createdAt: new Date().toISOString(),
    writes,
    canApply: !writes.some((write) =>
      write.action === 'conflict' || write.action === 'unsupported'),
  };
}

export interface AppliedExportResult {
  readonly createdPaths: readonly string[];
  readonly skippedPaths: readonly string[];
}

export function applyExplicitExportPlan(
  plan: HarnessExportPlan,
  input: { readonly confirmedByUser: boolean },
): AppliedExportResult {
  if (!input.confirmedByUser) {
    throw new Error('Harness export requires explicit user confirmation.');
  }
  if (!plan.canApply) {
    throw new Error('Harness export plan contains conflicts or unsupported refs.');
  }
  const creates = plan.writes.filter((write) => write.action === 'create');
  const created: string[] = [];
  try {
    for (const write of creates) {
      assertExternalPathHasNoSymlink(plan.targetRoot, write.targetPath);
      const target = safeResolveExternalPath(plan.targetRoot, write.targetPath);
      if (hashFile(target) !== write.expectedOldHash) {
        throw new Error(
          `External target ${write.targetPath} changed after dry-run.`,
        );
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temp = `${target}.codepilot-export.tmp`;
      fs.writeFileSync(temp, write.content, { flag: 'wx' });
      fs.renameSync(temp, target);
      created.push(target);
    }
  } catch (error) {
    for (const target of created.reverse()) {
      try {
        fs.unlinkSync(target);
      } catch {
        // Only files created by this apply are rolled back. Existing external
        // files are never removed.
      }
    }
    throw error;
  }
  return {
    createdPaths: created,
    skippedPaths: plan.writes
      .filter((write) => write.action === 'skip_same')
      .map((write) => safeResolveExternalPath(plan.targetRoot, write.targetPath)),
  };
}
