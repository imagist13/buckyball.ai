import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  getAssetRecord,
  normalizeAssetTags,
  parseStoredAssetTags,
  setAssetTags,
} from '@/lib/assets/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
) {
  const { id } = await params;
  const asset = getAssetRecord(id);
  if (asset && asset.lifecycle_state !== 'active') {
    return NextResponse.json(
      { error: 'Asset is not active.', code: 'asset_not_active' },
      { status: 409 },
    );
  }
  if (!asset) {
    const legacy = getDb().prepare(
      'SELECT tags FROM media_generations WHERE id = ?',
    ).get(id) as { tags: string } | undefined;
    if (legacy) {
      return NextResponse.json({
        tags: parseStoredAssetTags(legacy.tags),
        legacyOnly: true,
      });
    }
    return NextResponse.json(
      { error: 'Asset not found.', code: 'asset_not_found' },
      { status: 404 },
    );
  }
  return NextResponse.json({ tags: parseStoredAssetTags(asset.tags) });
}

export async function PUT(
  request: NextRequest,
  { params }: RouteParams,
) {
  try {
    const { id } = await params;
    const body = await request.json() as { tags?: unknown };
    if (!Array.isArray(body.tags)) {
      return NextResponse.json(
        { error: 'tags must be an array.', code: 'tags_invalid' },
        { status: 400 },
      );
    }
    const tags = normalizeAssetTags(body.tags as string[]);
    const asset = getAssetRecord(id);
    if (asset && asset.lifecycle_state !== 'active') {
      return NextResponse.json(
        { error: 'Asset is not active.', code: 'asset_not_active' },
        { status: 409 },
      );
    }
    if (asset?.lifecycle_state === 'active') {
      return NextResponse.json({ tags: setAssetTags(id, tags) });
    }
    const updated = getDb().prepare(
      'UPDATE media_generations SET tags = ? WHERE id = ?',
    ).run(JSON.stringify(tags), id);
    if (updated.changes === 0) {
      return NextResponse.json(
        { error: `Asset "${id}" does not exist.`, code: 'asset_not_found' },
        { status: 404 },
      );
    }
    return NextResponse.json({ tags, legacyOnly: true });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Failed to update Asset tags.';
    if (message.includes('does not exist')) {
      return NextResponse.json(
        { error: message, code: 'asset_not_found' },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: message, code: 'tags_invalid' },
      { status: 400 },
    );
  }
}
