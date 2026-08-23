import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAssetRecord } from '@/lib/assets/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = getDb();

    const media = db.prepare(
      'SELECT favorited FROM media_generations WHERE id = ?',
    ).get(id) as { favorited: number } | undefined;
    const asset = getAssetRecord(id);
    if (!media && !asset) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const currentlyFavorited = media
      ? !!media.favorited
      : asset?.curation_state === 'selected';
    const newValue = currentlyFavorited ? 0 : 1;
    db.transaction(() => {
      if (media) {
        db.prepare(
          'UPDATE media_generations SET favorited = ? WHERE id = ?',
        ).run(newValue, id);
      }
      if (asset) {
        db.prepare(
          `UPDATE asset_records
           SET curation_state = ?, updated_at = datetime('now')
           WHERE id = ?`,
        ).run(newValue ? 'selected' : 'unreviewed', id);
      }
    })();

    return NextResponse.json({ favorited: newValue });
  } catch (error) {
    console.error('[media/favorite] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to toggle favorite' },
      { status: 500 },
    );
  }
}
