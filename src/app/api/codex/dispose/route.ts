/**
 * POST /api/codex/dispose
 *
 * Phase 5 Phase 6 (2026-05-14) — Electron `before-quit` hook target.
 *
 * The Codex JSON-RPC app-server is spawned by the Next server process
 * (via `getCodexAppServer()` inside `/api/codex/*` routes). When
 * Electron tears down, it kills the Next server child; without an
 * explicit dispose step the Codex grandchild can outlive the parent
 * and orphan (the Rust binary doesn't have a parent-death signal
 * handler, only stdin EOF — which the Next server's hard-kill may
 * skip).
 *
 * This route invokes the cached app-server's graceful dispose so that
 * the stdin/stdout pipe closes cleanly and the binary exits its
 * request loop before Electron force-kills the Next server.
 *
 * The Electron main process should `fetch` this endpoint with a short
 * timeout (1.5–2s) before `killServer()`. A timeout / failure here is
 * not fatal — Electron should proceed to kill the server anyway; the
 * goal is "best-effort graceful" not "blocking ack required".
 */

import { NextResponse } from 'next/server';
import { disposeCodexAppServer } from '@/lib/codex/app-server-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await disposeCodexAppServer();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: reason }, { status: 200 });
  }
}
