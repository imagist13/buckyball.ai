import { NextRequest, NextResponse } from 'next/server';
import { getCachedAccountInfo, getCapabilityCacheAge } from '@/lib/agent-sdk-capabilities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const providerId = request.nextUrl.searchParams.get('providerId') || 'env';
    const account = getCachedAccountInfo(providerId);
    const cacheAge = getCapabilityCacheAge(providerId);
    const cachedAt = cacheAge === Infinity ? 0 : Date.now() - cacheAge;

    return NextResponse.json({ account, cached_at: cachedAt });
  } catch (error) {
    console.error('[account] Failed to get account info:', error);
    return NextResponse.json({ account: null, cached_at: 0, error: String(error) });
  }
}
