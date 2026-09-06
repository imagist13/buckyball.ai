import type {
  HarnessHomeManifest,
  PortableContentRef,
  Provenance,
} from '../contracts';
import type { HarnessImportPlan } from '../migration';
import type { FileHarnessRepository } from '../repository';
import type { HarnessAdapterDescriptor } from '../registry';

export type DiscoveredHarnessAssetKind =
  | 'identity'
  | 'rule'
  | 'memory'
  | 'skill'
  | 'mcp'
  | 'runtime_overlay';

export interface DiscoveredHarnessAsset {
  readonly id: string;
  readonly kind: DiscoveredHarnessAssetKind;
  readonly displayName: string;
  readonly sourcePath: string;
  readonly portable: boolean;
  readonly targetPath?: string;
  readonly content?: string | Buffer;
  readonly mediaType?: string;
  readonly provenance: Provenance;
  readonly unsupportedReason?: string;
}

export interface DiscoverInput {
  /** A fixtureable user-home root. Adapters append their own directories. */
  readonly homeRoot: string;
  readonly projectRoot?: string;
}

export interface DiscoveredHarnessAssets {
  readonly adapterId: string;
  readonly assets: readonly DiscoveredHarnessAsset[];
  readonly warnings: readonly string[];
}

export interface HarnessImportInput {
  readonly repository: FileHarnessRepository;
  readonly discovered: DiscoveredHarnessAssets;
}

export interface HarnessImportPlanResult {
  readonly plan: HarnessImportPlan;
  readonly unsupported: readonly DiscoveredHarnessAsset[];
}

export interface HarnessExportInput {
  readonly repository: FileHarnessRepository;
  readonly targetRoot: string;
  readonly refIds?: ReadonlySet<string>;
}

export interface HarnessExportPlanWrite {
  readonly refId: string;
  readonly targetPath: string;
  readonly content: Buffer;
  readonly action: 'create' | 'skip_same' | 'conflict' | 'unsupported';
  readonly expectedOldHash: string | null;
  readonly newHash: string;
  readonly reason: string;
}

export interface HarnessExportPlan {
  readonly adapterId: string;
  readonly targetRoot: string;
  readonly createdAt: string;
  readonly writes: readonly HarnessExportPlanWrite[];
  readonly canApply: boolean;
}

export interface HarnessProjectionOverlay {
  readonly adapterId: string;
  readonly runtimeId: string;
  readonly refs: readonly PortableContentRef[];
  readonly unsupportedReasons: readonly string[];
}

export interface HarnessAdapter {
  readonly descriptor: HarnessAdapterDescriptor;
  discover(input: DiscoverInput): Promise<DiscoveredHarnessAssets>;
  importPlan(input: HarnessImportInput): Promise<HarnessImportPlanResult>;
  exportPlan?(input: HarnessExportInput): Promise<HarnessExportPlan>;
  project(input: {
    readonly manifest: HarnessHomeManifest;
    readonly runtimeId: string;
  }): Promise<HarnessProjectionOverlay>;
}
