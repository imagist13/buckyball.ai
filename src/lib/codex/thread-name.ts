/**
 * Best-effort mirror of CodePilot's canonical session title to the matching
 * Codex app-server thread.
 *
 * Codex exposes `thread/name/set`, but it does not expose an API that generates
 * a title. CodePilot therefore remains the sole title authority: this helper
 * only copies an already-committed local title to an existing Codex thread.
 * Nothing on this path may delay a chat completion or a manual rename.
 */

import { getRuntimeSessionRef } from '@/lib/runtime/session-store';

export type CodexThreadNameSyncOutcome = 'synced' | 'no-thread' | 'failed';

interface CodexThreadNameSyncDeps {
  getThreadId?: (chatSessionId: string) => string | null;
  setThreadName?: (threadId: string, name: string) => Promise<void>;
}

function defaultGetThreadId(chatSessionId: string): string | null {
  return getRuntimeSessionRef(chatSessionId, 'codex_runtime')?.token ?? null;
}

async function defaultSetThreadName(threadId: string, name: string): Promise<void> {
  const { getCodexAppServer } = await import('./app-server-manager');
  const { client } = await getCodexAppServer();
  await client.request('thread/name/set', { threadId, name });
}

/**
 * Mirror a title without logging the title or thread id. The optional seam is
 * intentionally tiny so the protocol contract can be tested without spawning
 * the user's real app-server or mutating their Codex history.
 */
export async function syncCodexThreadName(
  chatSessionId: string,
  title: string,
  deps: CodexThreadNameSyncDeps = {},
): Promise<CodexThreadNameSyncOutcome> {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return 'failed';

  const threadId = (deps.getThreadId ?? defaultGetThreadId)(chatSessionId);
  if (!threadId) return 'no-thread';

  try {
    await (deps.setThreadName ?? defaultSetThreadName)(threadId, normalizedTitle);
    console.info('[codex.thread-name] outcome=synced');
    return 'synced';
  } catch (error) {
    // Shape-only telemetry: never log the user-visible title or the thread id.
    const reason = error instanceof Error ? error.name : 'unknown';
    console.warn('[codex.thread-name] outcome=failed', { reason });
    return 'failed';
  }
}
