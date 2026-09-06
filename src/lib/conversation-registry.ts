import type { Query } from '@anthropic-ai/claude-agent-sdk';

/**
 * Registry entry: the live SDK Query handle plus the session-lock ownership
 * token (`lockId`) that registered it. `lockId` gates unregister so a late
 * teardown from a superseded turn cannot evict the Query owned by the turn
 * that took over. See I1 in the Phase 3 controlled-loop plan.
 */
interface ConversationEntry {
  query: Query;
  lockId?: string;
  abortController?: AbortController;
}

// V2: entry shape changed from `Query` to `{query, lockId?}`. Bump the
// globalThis key so a hot-reload (HMR) does not hand us a Map that still
// holds bare `Query` values from a previous module instance.
const globalKey = '__activeConversationsV2__' as const;

function getMap(): Map<string, ConversationEntry> {
  if (!(globalThis as Record<string, unknown>)[globalKey]) {
    (globalThis as Record<string, unknown>)[globalKey] = new Map<string, ConversationEntry>();
  }
  return (globalThis as Record<string, unknown>)[globalKey] as Map<string, ConversationEntry>;
}

export function registerConversation(
  sessionId: string,
  conversation: Query,
  lockId?: string,
  abortController?: AbortController,
): void {
  getMap().set(sessionId, { query: conversation, lockId, abortController });
}

/**
 * Remove the registered Query for `sessionId` — but only if `lockId` matches
 * the token that registered it. A late unregister from a superseded turn
 * (which carries the OLD lockId) is a no-op, so it cannot evict the Query the
 * new owning turn just registered. Passing no `lockId` matches only an entry
 * that was itself registered without one.
 */
export function unregisterConversation(sessionId: string, lockId?: string): void {
  const entry = getMap().get(sessionId);
  if (!entry) return;
  if (entry.lockId === lockId) {
    getMap().delete(sessionId);
  }
}

export function getConversation(sessionId: string): Query | undefined {
  return getMap().get(sessionId)?.query;
}

/**
 * Abort the application-owned turn signal for the currently registered SDK
 * conversation. Query.interrupt() alone asks Claude Code to stop its parent
 * turn, but the SDK can discard an in-flight MCP handler without resolving its
 * Promise. Managed children listen to this controller, so abort it explicitly
 * before sending the graceful Query interrupt.
 */
export function abortConversation(
  sessionId: string,
  reason: unknown = new Error('Parent turn stopped by the user.'),
): boolean {
  const controller = getMap().get(sessionId)?.abortController;
  if (!controller) return false;
  if (!controller.signal.aborted) controller.abort(reason);
  return true;
}
