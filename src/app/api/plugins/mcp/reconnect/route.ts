import { NextRequest, NextResponse } from 'next/server';
import { BUILTIN_MCP_NAMES } from '@/lib/builtin-mcp-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/plugins/mcp/reconnect — Reconnect a specific MCP server.
 *
 * Phase 2D.2 (2026-04-30): added pre-flight checks so a missing or
 * built-in server fails fast with an explicit reason instead of silently
 * delegating to mcp-connection-manager (which throws an opaque error
 * deep in the SDK). The underlying reconnect path is still preview —
 * see the UI badge — but at least we don't bury "unknown server" inside
 * a 500.
 */
export async function POST(request: NextRequest) {
  try {
    const { serverName } = await request.json();

    if (!serverName || typeof serverName !== 'string') {
      return NextResponse.json({ error: 'serverName is required' }, { status: 400 });
    }

    // Built-in MCPs are in-process; reconnecting them via this endpoint
    // is a category error. Reject explicitly so the UI doesn't surface
    // a confusing "reconnect failed" toast for capabilities that have
    // no external connection in the first place.
    if (BUILTIN_MCP_NAMES.has(serverName)) {
      return NextResponse.json(
        { error: 'built-in MCP servers cannot be reconnected' },
        { status: 400 },
      );
    }

    // Verify the server actually exists in the merged config before we
    // ask mcp-connection-manager to do anything. Without this, a stale
    // UI (or a typo) hits the manager, which throws an opaque error.
    const { loadAllMcpServers } = await import('@/lib/mcp-loader');
    const all = loadAllMcpServers();
    if (!all || !(serverName in all)) {
      return NextResponse.json(
        { error: `MCP server "${serverName}" not found in config` },
        { status: 404 },
      );
    }

    const { reconnectServer } = await import('@/lib/mcp-connection-manager');
    await reconnectServer(serverName);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[mcp/reconnect] Failed to reconnect MCP server:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
