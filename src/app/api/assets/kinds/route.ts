import { NextResponse } from 'next/server';
import { listAssetKinds } from '@/lib/assets/kind-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    kinds: listAssetKinds().map((kind) => ({
      id: kind.id,
      displayName: kind.displayName,
    })),
  });
}
