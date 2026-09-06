import { NextRequest, NextResponse } from 'next/server';
import { restoreAsset } from '@/lib/assets/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const asset = restoreAsset(id);
    return NextResponse.json({ asset });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to restore Asset.',
        code: 'asset_restore_failed',
      },
      { status: 409 },
    );
  }
}
