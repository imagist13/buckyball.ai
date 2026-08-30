/**
 * Codex dynamic tool-call bridge — Phase 8 Phase 5 (2026-05-27).
 *
 * When the model AUTONOMOUSLY calls a tool mid-turn, Codex's app-server
 * sends the CLIENT a server-originated `item/tool/call` request (a
 * "dynamic tool call", params `DynamicToolCallParams`) — NOT the
 * client→server `mcpServer/tool/call` our Phase 0 POC drove. Without a
 * handler, `CodexAppServerClient.routeServerRequest` answers
 * `-32601 method-not-found` and Codex marks the call rejected. That is
 * exactly why the Phase 5 login smoke saw the model call
 * `codepilot_memory.codepilot_memory_recent {}` and then get "rejected":
 * the MCP injection + the model's decision to call were already working;
 * only this client-side execution bridge was missing.
 *
 * This bridge forwards every namespaced dynamic tool call back to Codex's
 * own MCP manager via `mcpServer/tool/call`, then converts the MCP result
 * into the `DynamicToolCallResponse` shape Codex expects. Approval and
 * permission checks remain owned by Codex's elicitation / approval flow;
 * this transport bridge must not impose a second tool allowlist.
 *
 * Shapes mirror the live app-server schema (codex 0.133 v2):
 *   DynamicToolCallParams / DynamicToolCallResponse /
 *   DynamicToolCallOutputContentItem.
 */

export interface CodexDynamicToolCallParams {
  threadId: string;
  turnId: string;
  callId: string;
  /** MCP server name the tool belongs to. `null` for non-namespaced. */
  namespace: string | null;
  tool: string;
  arguments?: unknown;
}

export type DynamicToolCallOutputContentItem =
  | { type: 'inputText'; text: string }
  | { type: 'inputImage'; imageUrl: string };

export interface CodexDynamicToolCallResponse {
  contentItems: DynamicToolCallOutputContentItem[];
  success: boolean;
}

/** Minimal shape of an `mcpServer/tool/call` result. */
export interface McpToolCallResultLike {
  content?: ReadonlyArray<unknown>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface CodexDynamicToolRoute {
  forwardMcp: (req: {
    threadId: string;
    server: string;
    tool: string;
    arguments?: unknown;
  }) => Promise<McpToolCallResultLike>;
  localTools?: ReadonlyMap<
    string,
    (input: unknown, options: { toolCallId: string; abortSignal?: AbortSignal }) => Promise<unknown>
  >;
  abortSignal?: AbortSignal;
}

const DYNAMIC_TOOL_ROUTE_REGISTRY_KEY = Symbol.for(
  'codepilot.codex.dynamic-tool-route-registry.v1',
);

function getDynamicToolRouteRegistry(): Map<string, CodexDynamicToolRoute> {
  const holder = globalThis as typeof globalThis & {
    [DYNAMIC_TOOL_ROUTE_REGISTRY_KEY]?: Map<string, CodexDynamicToolRoute>;
  };
  if (!holder[DYNAMIC_TOOL_ROUTE_REGISTRY_KEY]) {
    holder[DYNAMIC_TOOL_ROUTE_REGISTRY_KEY] = new Map();
  }
  return holder[DYNAMIC_TOOL_ROUTE_REGISTRY_KEY]!;
}

/**
 * Register one live app-server thread. Identity-gated cleanup prevents an old
 * stream/HMR owner from deleting a newer turn's route for the same thread.
 */
export function registerCodexDynamicToolRoute(
  threadId: string,
  route: CodexDynamicToolRoute,
): () => void {
  const registry = getDynamicToolRouteRegistry();
  registry.set(threadId, route);
  return () => {
    if (registry.get(threadId) === route) registry.delete(threadId);
  };
}

function inputText(text: string): DynamicToolCallOutputContentItem {
  return { type: 'inputText', text };
}

/** Extract a plain-text rendering from an MCP tool result: prefer the
 *  `text` content items; fall back to structuredContent or the raw
 *  content as JSON so nothing is silently dropped. */
function resultToText(result: McpToolCallResultLike): string {
  const content = result?.content;
  if (Array.isArray(content)) {
    const texts = content
      .filter(
        (c): c is { type: 'text'; text: string } =>
          !!c &&
          typeof c === 'object' &&
          (c as { type?: unknown }).type === 'text' &&
          typeof (c as { text?: unknown }).text === 'string',
      )
      .map((c) => c.text);
    if (texts.length > 0) return texts.join('\n');
  }
  if (result?.structuredContent != null) return JSON.stringify(result.structuredContent);
  return JSON.stringify(content ?? null);
}

/**
 * Handle a Codex `item/tool/call` (dynamic tool call) by forwarding the
 * namespaced tool to Codex's MCP manager and shaping the response.
 * `forward` is `client.request('mcpServer/tool/call', ...)` in production;
 * tests inject a fake. NEVER throws — malformed input or a forward failure
 * becomes a graceful `success: false` response (throwing would surface as
 * `-32603` and Codex would treat the call as a hard error).
 */
export async function handleCodexDynamicToolCall(
  params: CodexDynamicToolCallParams,
  forward: (req: {
    threadId: string;
    server: string;
    tool: string;
    arguments?: unknown;
  }) => Promise<McpToolCallResultLike>,
): Promise<CodexDynamicToolCallResponse> {
  const namespace = params.namespace ?? '';
  if (!namespace || !params.tool) {
    return {
      success: false,
      contentItems: [
        inputText(
          `Dynamic MCP tool call is missing a namespace or tool name: "${namespace || '(none)'}.${params.tool || '(none)'}".`,
        ),
      ],
    };
  }
  try {
    const result = await forward({
      threadId: params.threadId,
      server: namespace,
      tool: params.tool,
      arguments: params.arguments,
    });
    return {
      success: result?.isError !== true,
      contentItems: [inputText(resultToText(result))],
    };
  } catch (err) {
    return {
      success: false,
      contentItems: [
        inputText(`MCP tool call failed: ${err instanceof Error ? err.message : String(err)}`),
      ],
    };
  }
}

function localToolResultToText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result === undefined) return '';
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/**
 * Stable process-wide dispatcher for app-server server requests.
 *
 * `CodexAppServerClient` permits only one handler per method. A handler
 * registered independently by every chat causes the newest turn to steal
 * `item/tool/call` from older live turns. The dispatcher instead resolves by
 * wire threadId, supporting concurrent parent chats and HMR safely.
 */
export async function dispatchCodexDynamicToolCall(
  params: CodexDynamicToolCallParams,
): Promise<CodexDynamicToolCallResponse> {
  const route = getDynamicToolRouteRegistry().get(params.threadId);
  if (!route) {
    return {
      success: false,
      contentItems: [inputText(
        `No active CodePilot dynamic-tool owner for Codex thread "${params.threadId}".`,
      )],
    };
  }

  if (params.namespace) {
    return handleCodexDynamicToolCall(params, route.forwardMcp);
  }

  const execute = route.localTools?.get(params.tool);
  if (!execute) {
    return {
      success: false,
      contentItems: [inputText(
        `Unknown non-namespaced CodePilot dynamic tool "${params.tool || '(none)'}".`,
      )],
    };
  }
  try {
    const result = await execute(params.arguments ?? {}, {
      toolCallId: params.callId,
      ...(route.abortSignal ? { abortSignal: route.abortSignal } : {}),
    });
    return {
      success: true,
      contentItems: [inputText(localToolResultToText(result))],
    };
  } catch (err) {
    return {
      success: false,
      contentItems: [inputText(
        `CodePilot dynamic tool call failed: ${err instanceof Error ? err.message : String(err)}`,
      )],
    };
  }
}

/**
 * Managed local dynamic tools already emit richer canonical events through
 * the durable built-in side channel. Suppress the app-server's mirrored
 * dynamicToolCall lifecycle for those exact names, otherwise one physical
 * call becomes two tool blocks (and may render duplicate capsules).
 */
export function isManagedLocalDynamicToolLifecycle(
  method: string,
  params: unknown,
  managedToolNames: ReadonlySet<string>,
): boolean {
  if (method !== 'item/started' && method !== 'item/completed') return false;
  if (!params || typeof params !== 'object') return false;
  const item = (params as { item?: unknown }).item;
  if (!item || typeof item !== 'object') return false;
  const candidate = item as {
    type?: unknown;
    namespace?: unknown;
    tool?: unknown;
  };
  return candidate.type === 'dynamicToolCall'
    && (candidate.namespace === null || candidate.namespace === undefined)
    && typeof candidate.tool === 'string'
    && managedToolNames.has(candidate.tool);
}
