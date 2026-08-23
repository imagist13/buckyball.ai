import fs from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import { getAssetRecord } from '@/lib/assets/service';
import {
  getHtmlBundleThumbnailPath,
  storeHtmlBundleThumbnail,
} from '@/lib/assets/html-bundle-materializer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BASE64_LENGTH = 12 * 1024 * 1024;

function assetNotFound() {
  return NextResponse.json(
    { error: 'HTML Asset not found.', code: 'asset_not_found' },
    { status: 404 },
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const asset = getAssetRecord(id);
    if (!asset || asset.kind !== 'html_bundle') return assetNotFound();
    const previewPath = getHtmlBundleThumbnailPath(asset);
    if (!previewPath) {
      return NextResponse.json(
        { error: 'HTML thumbnail has not been generated.', code: 'thumbnail_missing' },
        { status: 404 },
      );
    }
    const bytes = fs.readFileSync(previewPath);
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[assets/[id]/thumbnail] GET Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to read HTML thumbnail.',
        code: 'thumbnail_read_failed',
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const asset = getAssetRecord(id);
    if (!asset || asset.kind !== 'html_bundle') return assetNotFound();
    const body = await request.json() as { pngBase64?: unknown };
    if (
      typeof body.pngBase64 !== 'string'
      || !body.pngBase64
      || body.pngBase64.length > MAX_BASE64_LENGTH
    ) {
      return NextResponse.json(
        { error: 'A bounded PNG payload is required.', code: 'thumbnail_invalid' },
        { status: 400 },
      );
    }
    const bytes = Buffer.from(body.pngBase64, 'base64');
    storeHtmlBundleThumbnail(id, bytes);
    return NextResponse.json({
      thumbnailUrl: `/api/assets/${encodeURIComponent(id)}/thumbnail`,
    });
  } catch (error) {
    console.warn(
      '[assets/[id]/thumbnail] capture rejected:',
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to store HTML thumbnail.',
        code: 'thumbnail_invalid',
      },
      { status: 400 },
    );
  }
}
