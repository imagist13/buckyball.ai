/**
 * mcp-sdk-adapter-poc.ts — AI SDK 7 Phase 4 ④: @ai-sdk/mcp adapter POC.
 *
 * EXPERIMENTAL — NOT WIRED INTO ANY RUNTIME. Entry points are exactly:
 *   (a) src/__tests__/unit/mcp-sdk-adapter-poc.test.ts
 *   (b) scripts/smoke-ai-sdk7-phase4-mcp-poc.ts
 * Application code has zero imports of this module (same isolation contract
 * as agent-loop-toolloop-poc.ts). The production MCP path
 * (mcp-connection-manager.ts + mcp-tool-adapter.ts, built directly on
 * @modelcontextprotocol/sdk) is untouched.
 *
 * What this POC probes: whether `@ai-sdk/mcp`'s `createMCPClient` +
 * `client.tools()` can replace the hand-rolled connection manager + adapter
 * pair while preserving CodePilot's observable MCP contract:
 *
 *   1. Tool naming — fully qualified `mcp__{serverName}__{toolName}` (this
 *      is what permission rules and the PERMISSION_SAFE_TOOLS allowlist key
 *      on; a rename would silently change permission behavior).
 *   2. Result extraction — MCP `{ content: [{type:'text',…}], isError? }`
 *      collapses to a plain string for the model, `Error: …` on isError,
 *      JSON.stringify fallback otherwise (mirrors mcp-tool-adapter.ts
 *      convertMcpTool byte-for-byte; a drift here changes what the model
 *      sees in tool_result).
 *   3. Permission semantics — the ToolSet is wrapped by the REAL production
 *      `wrapWithPermissions` (imported, not replicated), so external MCP
 *      tools keep the default-ask contract (permission-checker.ts:
 *      unmatched `mcp__*` → 'ask' in normal mode) and the same
 *      permission_request SSE + registry + approval-token flow.
 *
 * Known deltas vs production (recorded, not hidden):
 *   - @ai-sdk/mcp owns the JSON-RPC session (initialize handshake, retries);
 *     the production manager keeps a per-server client Map + reconnect
 *     logic. Lifecycle management (sync/dispose on config change) is NOT
 *     probed here — a Phase 5 concern if adoption proceeds.
 *   - @ai-sdk/mcp requires node >= 22 (already the project floor) and is a
 *     devDependency while experimental: the app bundle must not grow a
 *     dependency for a path users can't reach.
 */

import { dynamicTool, jsonSchema, type ToolSet } from 'ai';
import { createMCPClient, type MCPClient, type MCPTransport } from '@ai-sdk/mcp';
import { wrapWithPermissions } from '../agent-tools';

type PermissionContext = Parameters<typeof wrapWithPermissions>[1];

/** Connect an @ai-sdk/mcp client over any MCPTransport (stdio / in-memory). */
export async function connectMcpSdkClientPoc(transport: MCPTransport): Promise<MCPClient> {
  return createMCPClient({
    transport,
    name: 'codepilot-mcp-sdk-poc',
    onUncaughtError: (err) => {
      console.warn('[mcp-sdk-poc] uncaught MCP error:', err instanceof Error ? err.message : err);
    },
  });
}

/**
 * Mirror of mcp-tool-adapter.ts's MCP-result → string extraction. Kept as a
 * named export so the POC test can pin extraction parity on canned shapes.
 */
export function extractMcpResultText(result: unknown): string {
  if (result && typeof result === 'object' && 'content' in result) {
    const mcpResult = result as { content: Array<{ type: string; text?: string }>; isError?: boolean };
    const text = mcpResult.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    if (mcpResult.isError) {
      return `Error: ${text || 'MCP tool returned an error'}`;
    }

    return text || JSON.stringify(result);
  }

  return typeof result === 'string' ? result : JSON.stringify(result);
}

/**
 * Build a ToolSet from an @ai-sdk/mcp client with production-shaped names,
 * schemas, and result extraction (contract points 1–2 above).
 */
export async function buildMcpSdkToolSetPoc(
  client: MCPClient,
  serverName: string,
): Promise<ToolSet> {
  const listed = await client.listTools();
  const toolSet: ToolSet = {};

  for (const t of listed.tools) {
    const qualifiedName = `mcp__${serverName}__${t.name}`;
    const schema = {
      ...(t.inputSchema as Record<string, unknown>),
      type: 'object' as const,
      properties: ((t.inputSchema as Record<string, unknown>)?.properties as Record<string, unknown>) ?? {},
      additionalProperties: false,
    };
    toolSet[qualifiedName] = dynamicTool({
      description: t.description || `MCP tool: ${t.name}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: jsonSchema(schema as any),
      execute: async (args: unknown) => {
        const result = await client.callTool({
          name: t.name,
          arguments: (args ?? {}) as Record<string, unknown>,
        });
        return extractMcpResultText(result);
      },
    });
  }

  return toolSet;
}

/**
 * Wrap the POC ToolSet with the REAL production permission wrapper
 * (contract point 3). External `mcp__*` tools thereby keep default-ask,
 * permission_request SSE (incl. the Phase 4 ② approval token), registry
 * blocking, deny strings, and session-approval semantics — none of it
 * reimplemented here.
 */
export function wrapMcpSdkToolSetWithProductionPermissions(
  tools: ToolSet,
  ctx: PermissionContext,
): ToolSet {
  return wrapWithPermissions(tools, ctx);
}
