export type AssetKindId = 'image' | 'video' | 'audio' | 'html_bundle';

export interface AssetKindDescriptor {
  readonly id: AssetKindId;
  readonly displayName: {
    readonly zh: string;
    readonly en: string;
  };
  readonly producers: readonly string[];
  readonly materializer: string;
  readonly validator: string;
  readonly previewConsumer: string;
  readonly inputConsumers: readonly string[];
  readonly trustPolicy: string;
  readonly conformanceSuite: string;
}

const image: AssetKindDescriptor = {
  id: 'image',
  displayName: { zh: '图片', en: 'Image' },
  producers: [
    'media-saver:base64',
    'media-saver:file-import',
    'image-generator',
    'codex-media-import',
    'legacy-media-backfill',
  ],
  materializer: 'src/lib/media-saver.ts',
  validator: 'validateMediaAssetFile(image/*)',
  previewConsumer: 'GalleryGrid/GalleryDetail/MediaPreview',
  inputConsumers: ['image generation reference', 'video generation reference', 'chat attachment'],
  trustPolicy: 'canonical-media-directory + content hash',
  conformanceSuite: 'asset-library-conformance.test.ts',
};

const video: AssetKindDescriptor = {
  id: 'video',
  displayName: { zh: '视频', en: 'Video' },
  producers: [
    'media-saver:base64',
    'media-saver:file-import',
    'xai-imagine-video',
    'codex-media-import',
    'legacy-media-backfill',
  ],
  materializer: 'src/lib/media-saver.ts',
  validator: 'validateMediaAssetFile(video/*)',
  previewConsumer: 'GalleryGrid/GalleryDetail/MediaPreview',
  inputConsumers: ['chat attachment', 'creative-method reference'],
  trustPolicy: 'canonical-media-directory + content hash + range-safe preview',
  conformanceSuite: 'asset-library-conformance.test.ts',
};

/**
 * Audio is registered only because the conformance suite provides an actual
 * WAV fixture through import → hash → Gallery/MediaPreview consumer → typed
 * reference → permanent delete. It was intentionally absent before that chain
 * existed.
 */
const audio: AssetKindDescriptor = {
  id: 'audio',
  displayName: { zh: '音频', en: 'Audio' },
  producers: [
    'media-saver:base64',
    'media-saver:file-import',
    'codex-media-import',
    'legacy-media-backfill',
  ],
  materializer: 'src/lib/media-saver.ts',
  validator: 'validateMediaAssetFile(audio/*)',
  previewConsumer: 'GalleryGrid/GalleryDetail/MediaPreview',
  inputConsumers: ['chat attachment', 'creative-method reference'],
  trustPolicy: 'canonical-media-directory + content hash + range-safe preview',
  conformanceSuite: 'asset-library-conformance.test.ts#wav-fixture',
};

const htmlBundle: AssetKindDescriptor = {
  id: 'html_bundle',
  displayName: { zh: '网页', en: 'Web page' },
  producers: [
    'html-bundle:workspace-materializer',
    'html-bundle:user-selected-inline',
  ],
  materializer: 'src/lib/assets/html-bundle-materializer.ts',
  validator: 'inspectHtmlBundle',
  previewConsumer: 'GalleryGrid/GalleryDetail → static PNG thumbnail',
  inputConsumers: ['creative-method reference', 'Harness AssetRef'],
  trustPolicy: 'stable bundle + aggregate hash + sandbox + strict CSP + source scope',
  conformanceSuite: 'html-bundle-conformance.test.ts',
};

const descriptors: AssetKindDescriptor[] = [image, video, audio, htmlBundle];

export function registerAssetKind(descriptor: AssetKindDescriptor): void {
  if (descriptors.some((entry) => entry.id === descriptor.id)) {
    throw new Error(`Asset kind "${descriptor.id}" is already registered.`);
  }
  if (
    descriptor.producers.length === 0
    || !descriptor.materializer
    || !descriptor.validator
    || !descriptor.previewConsumer
    || descriptor.inputConsumers.length === 0
    || !descriptor.trustPolicy
    || !descriptor.conformanceSuite
  ) {
    throw new Error(`Asset kind "${descriptor.id}" descriptor is incomplete.`);
  }
  descriptors.push(descriptor);
}

export function listAssetKinds(): readonly AssetKindDescriptor[] {
  return descriptors.slice();
}

export function getAssetKind(id: string): AssetKindDescriptor | undefined {
  return descriptors.find((descriptor) => descriptor.id === id);
}

export function requireAssetKind(id: string): AssetKindDescriptor {
  const descriptor = getAssetKind(id);
  if (!descriptor) throw new Error(`Asset kind "${id}" is not registered.`);
  return descriptor;
}

export function assertRegisteredAssetProducer(
  kind: string,
  producerId: string,
): AssetKindDescriptor {
  const descriptor = requireAssetKind(kind);
  if (!descriptor.producers.includes(producerId)) {
    throw new Error(
      `Producer "${producerId}" is not registered for Asset kind "${kind}".`,
    );
  }
  return descriptor;
}
