import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  AssetInUseError,
  deleteAssetPermanently,
  deleteLegacyMediaGenerationPermanently,
  getAssetRecord,
} from '@/lib/assets/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = getDb();
    const row = db.prepare('SELECT * FROM media_generations WHERE id = ?').get(id);

    if (!row) {
      return NextResponse.json(
        { error: 'Media generation not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(row);
  } catch (error) {
    console.error('[media/[id]] GET Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get media generation' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = getDb();

    const row = db.prepare('SELECT * FROM media_generations WHERE id = ?').get(id) as {
      id: string;
      status: string;
    } | undefined;

    const asset = getAssetRecord(id);
    if (!row && !asset) {
      return NextResponse.json(
        { error: 'Asset not found', code: 'asset_not_found' },
        { status: 404 }
      );
    }
    if (!asset && row) {
      const deleted = deleteLegacyMediaGenerationPermanently(id);
      return NextResponse.json({
        success: true,
        permanent: true,
        recoverable: false,
        fileDeleted: deleted.deletedPaths.length > 0,
        retainedSharedPaths: deleted.retainedSharedPaths,
        retainedExternalPaths: deleted.retainedExternalPaths,
        sourceMediaGenerationDeleted: true,
      });
    }
    const deleted = deleteAssetPermanently(asset!.id);
    return NextResponse.json({
      success: true,
      permanent: true,
      recoverable: false,
      fileDeleted: deleted.deletedPaths.length > 0,
      retainedSharedPaths: deleted.retainedSharedPaths,
      sourceMediaGenerationDeleted: deleted.sourceMediaGenerationDeleted,
    });
  } catch (error) {
    if (error instanceof AssetInUseError) {
      return NextResponse.json(
        {
          error: error.message,
          code: 'asset_in_use',
          consumers: error.consumers,
        },
        { status: 409 },
      );
    }
    console.error('[media/[id]] DELETE Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete media generation' },
      { status: 500 }
    );
  }
}
