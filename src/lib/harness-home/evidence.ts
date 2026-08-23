import { getAssetRecord } from '@/lib/assets/service';
import type {
  AssetRef,
  PortableContentRef,
} from './contracts';
import { FileHarnessRepository } from './repository/file-repository';
import { hashBytes } from './repository/hash';

function allPortableRefs(
  repository: FileHarnessRepository,
): readonly PortableContentRef[] {
  const manifest = repository.manifest;
  return [
    ...manifest.definition.identityRefs,
    ...manifest.definition.ruleRefs,
    ...manifest.definition.skillRefs,
    ...manifest.definition.mcpRefs,
    ...manifest.definition.creativeMethodRefs,
    ...manifest.state.memoryRefs,
    ...manifest.state.preferenceRefs,
    ...manifest.state.feedbackRefs,
    ...Object.values(manifest.runtimeOverlays).flatMap((overlay) => [
      ...overlay.definitionRefs,
      ...overlay.stateRefs,
    ]),
  ];
}

/**
 * Active application writes must point at evidence that is already real.
 * Portable imports can still preserve unresolved refs at the repository
 * layer, but the local API cannot mint a new preference/method from a made-up
 * Asset id or an unindexed file path.
 */
export function assertEvidenceRefResolvable(
  repository: FileHarnessRepository,
  ref: PortableContentRef | AssetRef,
  label = 'Evidence',
): void {
  const assetId = (ref as Partial<AssetRef>).assetId;
  if (typeof assetId === 'string' && assetId.trim()) {
    const asset = getAssetRecord(assetId);
    if (!asset) {
      throw new Error(`${label} Asset "${assetId}" does not exist.`);
    }
    if (ref.kind && asset.kind !== ref.kind) {
      throw new Error(
        `${label} Asset "${assetId}" is "${asset.kind}", not "${ref.kind}".`,
      );
    }
    if (ref.contentHash && asset.content_hash !== ref.contentHash) {
      throw new Error(`${label} Asset "${assetId}" content hash changed.`);
    }
    return;
  }

  const portable = ref as Partial<PortableContentRef>;
  if (
    typeof portable.id !== 'string'
    || typeof portable.path !== 'string'
    || typeof portable.contentHash !== 'string'
  ) {
    throw new Error(`${label} must be a PortableContentRef or AssetRef.`);
  }
  const indexed = allPortableRefs(repository).find(
    (candidate) =>
      candidate.id === portable.id
      && candidate.path === portable.path
      && candidate.contentHash === portable.contentHash,
  );
  if (!indexed) {
    throw new Error(`${label} portable content is not indexed by Harness Home.`);
  }
  const actualHash = hashBytes(repository.read(indexed.path));
  if (actualHash !== indexed.contentHash) {
    throw new Error(`${label} portable content hash changed.`);
  }
}
