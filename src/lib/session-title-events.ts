/**
 * Client-side title sync.
 *
 * The fallback title is written SERVER-side inside POST /api/chat, so the
 * client can't know it from the request it just made. Before this, nothing
 * told the UI: the sidebar happened to catch up via its 5-second poll, and
 * the top bar didn't catch up at all (`/chat/[id]` reads the title once on
 * mount and never subscribes) — so a fresh chat sat on "New Chat" up there
 * until a navigation.
 *
 * Why a targeted re-fetch and not an SSE frame: the title is committed
 * synchronously in the route handler BEFORE the streaming Response is
 * returned, so by the time `fetch('/api/chat')` resolves ok the row is
 * already final. That makes a single GET race-free and keeps the SSE frame
 * grammar (parsed in two places — `stream-session-manager` and `page.tsx`)
 * untouched.
 *
 * Reuses the existing `session-updated` event that manual rename already
 * emits, so every consumer needed exactly one listener rather than one per
 * title writer.
 */

/** Detail shape carried by `session-updated` when the title is known. */
export interface SessionUpdatedDetail {
  id: string;
  title: string;
}

/**
 * Announce a title the caller already holds FROM THE SERVER.
 *
 * Only ever pass a title read out of a response body. A rename PATCH
 * canonicalizes what it was sent (clamped to 50 graphemes, single-lined), so
 * broadcasting the request text instead would park the top bar and split view
 * on the raw input while the sidebar's re-fetch showed the canonical form —
 * three views, two titles.
 */
export function broadcastSessionTitle(sessionId: string, title: string): void {
  if (typeof window === 'undefined' || !sessionId || !title) return;
  window.dispatchEvent(
    new CustomEvent<SessionUpdatedDetail>('session-updated', {
      detail: { id: sessionId, title },
    }),
  );
}

/**
 * Read the canonical title out of a session API response body.
 * Returns `''` when the shape isn't what we expect, which callers treat as
 * "nothing to broadcast" rather than falling back to their own input.
 */
export function canonicalTitleFromResponse(data: unknown): string {
  const title = (data as { session?: { title?: unknown } } | null | undefined)?.session?.title;
  return typeof title === 'string' ? title : '';
}

/**
 * Rename a session and settle every view on the server's canonical title.
 *
 * Shared by the top bar and the sidebar: both used to PATCH inline and then
 * announce their own request text, which is how the two ended up showing
 * different titles for the same session after a long or multi-line rename.
 *
 * @returns the canonical title, or `''` if the rename didn't take (the caller
 *          then leaves its own state alone — fail-soft, as both call sites were).
 */
export async function renameSession(sessionId: string, title: string): Promise<string> {
  if (typeof window === 'undefined' || !sessionId) return '';
  try {
    const res = await fetch(`/api/chat/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) return '';
    const canonical = canonicalTitleFromResponse(await res.json());
    if (!canonical) return '';
    broadcastSessionTitle(sessionId, canonical);
    return canonical;
  } catch {
    return '';
  }
}

/**
 * Re-read a session's title and broadcast it. Fire-and-forget: a failure here
 * must never disturb a send that already succeeded — the sidebar poll remains
 * as the backstop.
 */
export async function refreshSessionTitle(sessionId: string): Promise<void> {
  if (typeof window === 'undefined' || !sessionId) return;
  try {
    const res = await fetch(`/api/chat/sessions/${sessionId}`);
    if (!res.ok) return;
    const title = canonicalTitleFromResponse(await res.json());
    if (!title) return;
    broadcastSessionTitle(sessionId, title);
  } catch {
    // Fail-soft by design.
  }
}

/**
 * Subscribe to title changes for one session.
 *
 * `session-updated` is also emitted WITHOUT a detail (delete, list refresh),
 * which is why `onTitle` only fires for a detail naming this session — a
 * detail-less event means "something changed, re-read if you care", and
 * callers that care pass `onUnknown`.
 *
 * @returns an unsubscribe function.
 */
export function subscribeSessionTitle(
  sessionId: string,
  onTitle: (title: string) => void,
  onUnknown?: () => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<Partial<SessionUpdatedDetail> | undefined>).detail;
    if (detail?.id && detail.id === sessionId && typeof detail.title === 'string' && detail.title) {
      onTitle(detail.title);
      return;
    }
    if (!detail?.id) onUnknown?.();
  };
  window.addEventListener('session-updated', handler);
  return () => window.removeEventListener('session-updated', handler);
}
