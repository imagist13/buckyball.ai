import { NextRequest, NextResponse } from 'next/server';
import {
  getAssetLineage,
  getAssetRecord,
  listAssetConsumers,
  reconcileAssetIntegrity,
  toTypedAssetRef,
} from '@/lib/assets/service';
import { getHtmlBundlePreviewLocation } from '@/lib/assets/html-bundle-materializer';
import { buildHtmlPreviewUrl } from '@/lib/html-preview-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!getAssetRecord(id)) {
      return NextResponse.json(
        { error: 'Asset not found.', code: 'asset_not_found' },
        { status: 404 },
      );
    }
    const asset = reconcileAssetIntegrity(id);
    const lineage = getAssetLineage(id);
    const consumers = listAssetConsumers(id);
    let typedRef: ReturnType<typeof toTypedAssetRef> | null = null;
    try {
      typedRef = toTypedAssetRef(asset);
    } catch {
      typedRef = null;
    }
    let previewUrl: string | null = null;
    if (asset.kind === 'html_bundle' && asset.integrity_state === 'valid') {
      const location = getHtmlBundlePreviewLocation(asset);
      previewUrl = buildHtmlPreviewUrl(
        location.entryPath,
        { kind: 'workspace', baseDir: location.bundleRoot },
      );
    }
    return NextResponse.json({
      asset,
      lineage,
      consumers,
      typedRef,
      previewUrl,
    });
  } catch (error) {
    console.error('[assets/[id]] GET Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to read Asset.',
        code: 'asset_read_failed',
      },
      { status: 500 },
    );
  }
}
