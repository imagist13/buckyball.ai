import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/plugins/mcp/toggle — Enable or disable an MCP server.
 *
 * Operates on the MCP connection manager directly. Changes take effect
 * immediately for disconnect, and on next message for re-connect
 * (syncMcpConnections runs at agent-loop start).
 */
export async function POST(request: NextRequest) {
  try {
    const { serverName, enabled } = await request.json();

    if (!serverName || typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'serverName and enabled (boolean) are required' }, { status: 400 });
    }

    const { connectServer, disconnectServer } = await import('@/lib/mcp-connection-manager');

    if (enabled) {
      // Read MCP config and reconnect immediately
      try {
        const { loadAllMcpServers } = await import('@/lib/mcp-loader');
        const allServers = loadAllMcpServers();
        const serverConfig = allServers?.[serverName];
        if (serverConfig) {
          await connectServer(serverName, serverConfig);
          return NextResponse.json({ success: true });
        }
      } catch { /* fall through to deferred */ }
      // Config not found or connect failed — will pick up on next message
      return NextResponse.json({ success: true, note: 'Will take effect on next message' });
    } else {
      await disconnectServer(serverName);
      return NextResponse.json({ success: true });
    }
  } catch (error) {
    console.error('[mcp/toggle] Failed to toggle MCP server:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
