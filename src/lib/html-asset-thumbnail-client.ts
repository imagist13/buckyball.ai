'use client';

export interface HtmlThumbnailInput {
  assetId: string;
  previewUrl: string;
}

export async function ensureHtmlAssetThumbnail({
  assetId,
  previewUrl,
}: HtmlThumbnailInput): Promise<string | null> {
  const capture = window.electronAPI?.asset?.captureHtmlThumbnail;
  if (!capture) return null;
  const result = await capture({
    previewUrl,
    width: 1280,
    height: 720,
  });
  if (result.error || !result.base64) return null;
  const response = await fetch(
    `/api/assets/${encodeURIComponent(assetId)}/thumbnail`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pngBase64: result.base64 }),
    },
  );
  if (!response.ok) return null;
  const payload = await response.json() as { thumbnailUrl?: unknown };
  return typeof payload.thumbnailUrl === 'string'
    ? payload.thumbnailUrl
    : null;
}
