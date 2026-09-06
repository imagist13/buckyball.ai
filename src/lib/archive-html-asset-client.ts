export type ArchiveHtmlAssetInput =
  | {
    sessionId: string;
    source: 'workspace';
    filePath: string;
    prompt?: string;
  }
  | {
    sessionId: string;
    source: 'inline';
    html: string;
    prompt?: string;
  };

export interface ArchivedHtmlAsset {
  id: string;
  kind: 'html_bundle';
  contentHash: string;
  lifecycleState: string;
  integrityState: string;
  previewUrl?: string;
  thumbnailUrl?: string;
}

export async function archiveHtmlAsset(
  input: ArchiveHtmlAssetInput,
): Promise<ArchivedHtmlAsset> {
  const response = await fetch('/api/assets/html-bundles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as {
    asset?: ArchivedHtmlAsset;
    error?: string;
  };
  if (!response.ok || !payload.asset) {
    throw new Error(payload.error || response.statusText || 'Archive failed.');
  }
  if (payload.asset.previewUrl && !payload.asset.thumbnailUrl) {
    try {
      const { ensureHtmlAssetThumbnail } = await import(
        '@/lib/html-asset-thumbnail-client'
      );
      payload.asset.thumbnailUrl = await ensureHtmlAssetThumbnail({
        assetId: payload.asset.id,
        previewUrl: payload.asset.previewUrl,
      }) || undefined;
    } catch {
      // Archiving the immutable bundle still succeeds. The Gallery retries
      // thumbnail generation for legacy or temporarily failed captures.
    }
  }
  return payload.asset;
}
