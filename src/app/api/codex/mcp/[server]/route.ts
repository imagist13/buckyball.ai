/**
 * CodePilot built-in MCP servers — streamable-HTTP route for Codex.
 *
 * Phase 8 #31. Generalizes the Phase 1 memory-only route: Codex connects to
 * `/api/codex/mcp/<serverName>` (e.g. codepilot_memory, codepilot_widget),
 * and we serve the matching in-process built-in MCP over the SDK's
 * web-standard streamable-HTTP transport — reusing the exact `createSdkMcpServer`
 * the ClaudeCode path uses (no duplicated tool logic).
 *
 * Stateless: a fresh server + transport per request. Per-server auth policy
 * lives in `builtin-mcp-servers.ts` (memory scopes to the configured
 * assistant workspace; widget is static read-only text).
 */

import { type NextRequest } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { MEMORY_MCP_WORKSPACE_HEADER, MEMORY_MCP_SESSION_HEADER } from '@/lib/codex/mcp-config';
import { getBuiltinMcpServer } from '@/lib/codex/builtin-mcp-servers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonRpcError(code: number, message: string, status: number): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ server: string }> },
): Promise<Response> {
  const { server } = await params;
  const entry = getBuiltinMcpServer(server);
  if (!entry) {
    return jsonRpcError(-32601, `Unknown built-in MCP server: ${server}`, 404);
  }

  const ctx = {
    workspacePath: request.headers.get(MEMORY_MCP_WORKSPACE_HEADER) ?? '',
    sessionId: request.headers.get(MEMORY_MCP_SESSION_HEADER) ?? '',
  };
  const auth = entry.authorize(ctx);
  if (!auth.ok) {
    return jsonRpcError(-32600, auth.message, auth.status);
  }

  try {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — one request, one response
      enableJsonResponse: true, // buffered JSON, no SSE stream to keep open
    });
    const instance = entry.create(ctx);
    await instance.connect(transport);
    return await transport.handleRequest(request);
  } catch (err) {
    return jsonRpcError(
      -32603,
      `Built-in MCP route error (${server}): ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }
}
