/**
 * agent-loop-tool-error.ts — Native runtime `tool-error` → SSE `tool_result`.
 *
 * #49 (stability audit 2026-07-04). When a tool's `execute()` throws, the AI
 * SDK surfaces a `tool-error` part on `result.fullStream` — NOT a `tool-result`
 * part. Before this fix, agent-loop.ts's fullStream switch had no
 * `case 'tool-error'`, so the part fell to the `default: break` branch and was
 * silently swallowed: the frontend's `tool_use` bubble kept spinning with no
 * result and no error indication, and `collectStreamResponse` never persisted a
 * tool_result for that call.
 *
 * This pure builder maps a tool-error part to the SSE `tool_result` payload
 * with `is_error: true`, mirroring the `tool-result` branch's field names so
 * the frontend (`useSSEStream` onToolResult → ToolResultInfo.is_error) renders
 * the same error bubble a normally-failing tool would produce.
 *
 * Pure (no I/O) so the fix is unit-testable without driving the DB/streaming-
 * dependent agent loop — same extraction pattern as agent-loop-error-event.ts.
 */

export interface ToolErrorResultData {
  tool_use_id: string;
  content: string;
  is_error: true;
}

/**
 * Build the SSE `tool_result` data payload for a fullStream `tool-error` part.
 * `is_error` is always `true`; `content` is the human-readable error text.
 */
export function buildToolErrorResultData(part: {
  toolCallId: string;
  error: unknown;
}): ToolErrorResultData {
  return {
    tool_use_id: part.toolCallId,
    content: stringifyToolError(part.error),
    is_error: true,
  };
}

/** Extract a stable, human-readable message from an unknown thrown value. */
function stringifyToolError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
