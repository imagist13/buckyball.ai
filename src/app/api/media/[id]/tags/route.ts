import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  getAssetRecord,
  normalizeAssetTags,
  setAssetTags,
} from '@/lib/assets/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!Array.isArray(body.tags)) {
      return NextResponse.json(
        { error: 'Missing required field: tags (must be an array)' },
        { status: 400 }
      );
    }

    const db = getDb();

    // Verify the record exists
    const row = db.prepare('SELECT id FROM media_generations WHERE id = ?').get(id);
    if (!row) {
      return NextResponse.json(
        { error: 'Media generation not found' },
        { status: 404 }
      );
    }

    const tags = normalizeAssetTags(body.tags);
    const asset = getAssetRecord(id);
    if (asset && asset.lifecycle_state !== 'active') {
      return NextResponse.json(
        { error: 'Asset is not active.', code: 'asset_not_active' },
        { status: 409 },
      );
    }
    if (asset?.lifecycle_state === 'active') {
      setAssetTags(id, tags);
    } else {
      db.prepare('UPDATE media_generations SET tags = ? WHERE id = ?').run(
        JSON.stringify(tags),
        id,
      );
    }

    const updated = db.prepare('SELECT * FROM media_generations WHERE id = ?').get(id);
    return NextResponse.json({ ...(updated as object), tags });
  } catch (error) {
    console.error('[media/[id]/tags] PUT Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update tags' },
      { status: 500 }
    );
  }
}
