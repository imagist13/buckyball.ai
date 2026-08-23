import { NextRequest, NextResponse } from 'next/server';
import { refreshMcpStatus, getCachedMcpStatus, getCapabilityCacheAge } from '@/lib/agent-sdk-capabilities';
import { getSession } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    // Accept explicit providerId, or resolve from session's stored provider_id
    let providerId = request.nextUrl.searchParams.get('providerId');

    if (!providerId && sessionId) {
      const session = getSession(sessionId);
      providerId = session?.provider_id || 'env';
    }

    providerId = providerId || 'env';

    let servers;
    if (sessionId) {
      servers = await refreshMcpStatus(sessionId, providerId);
    } else {
      servers = getCachedMcpStatus(providerId);
    }

    const cacheAge = getCapabilityCacheAge(providerId);
    const cachedAt = cacheAge === Infinity ? null : Date.now() - cacheAge;

    return NextResponse.json({ servers, cached_at: cachedAt });
  } catch (error) {
    console.error('[mcp/status] Failed to get MCP status:', error);
    return NextResponse.json({ servers: [], cached_at: null, error: String(error) });
  }
}
