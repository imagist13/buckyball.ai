import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/interrupt — Interrupt an active session.
 *
 * We don't know which runtime owns this session, so fan out best-effort to
 * EVERY interruptable runtime. One runtime erroring must not stop the others:
 * - Native:        AbortController-based interrupt
 * - Codex Runtime: turn/interrupt against the active Codex app-server turn
 *                  (codex-stop-recovery Phase 1 — previously missing, so a
 *                  Stop under Codex never reached the backend turn; the turn
 *                  kept running, the stream never closed, and the session lock
 *                  renewed forever → "Stop 后无法发送新指令")
 * - SDK:           conversation.interrupt() on the CLI subprocess
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    // Native + Codex runtimes share the registry import. Each is independently
    // try/caught so a missing/erroring runtime can't block the next one.
    const attempted: Record<string, boolean> = { native: false, codex_runtime: false, sdk: false };

    try {
      const { getRuntime } = await import('@/lib/runtime');

      // Try native runtime (AbortController)
      try {
        const nativeRt = getRuntime('native');
        if (nativeRt) {
          nativeRt.interrupt(sessionId);
          attempted.native = true;
        }
      } catch { /* native not available */ }

      // Try Codex runtime (turn/interrupt). interrupt() is best-effort and
      // no-ops when there's no active turn for this session (race against
      // turn/start resolving, or turn already finished).
      try {
        const codexRt = getRuntime('codex_runtime');
        if (codexRt) {
          codexRt.interrupt(sessionId);
          attempted.codex_runtime = true;
        }
      } catch { /* codex not available */ }
    } catch { /* runtime registry not available */ }

    // Try SDK runtime (conversation.interrupt)
    try {
      const { abortConversation, getConversation } = await import('@/lib/conversation-registry');
      const signalAborted = abortConversation(sessionId);
      const conversation = getConversation(sessionId);
      if (conversation) {
        await conversation.interrupt();
      }
      attempted.sdk = signalAborted || Boolean(conversation);
    } catch { /* SDK not available */ }

    // Durable child state must converge even when a Runtime abandons an
    // in-flight tool handler after Stop. Runtime aborts above own process/turn
    // termination; this barrier owns the user-visible/auditable run facts.
    try {
      const { cancelSubagentRunsForParentSession } = await import('@/lib/db');
      cancelSubagentRunsForParentSession(sessionId);
    } catch { /* DB unavailable — runtime abort remains best effort */ }

    // Diagnostic breadcrumb only — never logs prompt / files / credentials.
    console.debug('[interrupt] fan-out', { sessionId, attempted });

    // Interrupt/phase reconcile — return the backend's authoritative runtime_status so the
    // client can reconcile its stream phase (I2 / d-interrupt-returns-status). We
    // ONLY read chat_sessions.runtime_status here.
    //
    // We deliberately do NOT release or settle the session lock: this route only
    // carries a sessionId (no owner lockId), and a sessionId-wide release/settle
    // would clobber a newer turn that already took over the lock — killing an
    // already-reclaimed new owner (Codex I1 correction, d-interrupt-no-kill-
    // newowner). Real lock release + terminal-status write stay with the chat
    // route's lockId-scoped settleLock / watchdog.
    let runtime_status: string | null = null;
    try {
      const { getSession } = await import('@/lib/db');
      runtime_status = getSession(sessionId)?.runtime_status ?? null;
    } catch {
      // DB unavailable — return null; the client falls back to its force-abort
      // safety net rather than converging on an authoritative status.
    }

    return NextResponse.json({ interrupted: true, runtime_status });
  } catch (error) {
    console.error('[interrupt] Failed to interrupt:', error);
    return NextResponse.json({ interrupted: false, error: String(error) });
  }
}
