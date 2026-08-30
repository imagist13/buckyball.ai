/**
 * GET /api/codex/account
 *
 * Phase 5 Phase 2 (2026-05-13) — surface Codex account state to UI.
 * Returns the narrowed `CodexAccountState` discriminated union. The
 * Settings status card branches on `kind`:
 *
 *   - logged_out → show "Login to Codex" button (POSTs /api/codex/login)
 *   - logged_in  → show account email + plan + "Logout" button
 *   - unknown    → app-server not initialized yet; show retry hint
 *
 * Query param `refresh=1` forces a token refresh through Codex's
 * built-in refresh path. Default is cache-friendly read.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { logoutCodex, readCodexAccount } from '@/lib/codex/account';
import { logoutCodexAndInvalidateModels } from '@/lib/codex/account-transition';

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  try {
    const state = await readCodexAccount(refresh);
    return NextResponse.json({ state });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { state: { kind: 'unknown' as const }, error: reason },
      { status: 200 },
    );
  }
}

/**
 * DELETE body, split out so tests can drive the real handler while replacing
 * only the bottom JSON-RPC call. `perform` defaults to the real logout, so the
 * route export below binds production wiring.
 */
export async function handleAccountDelete(perform: () => Promise<void> = logoutCodex) {
  try {
    // Drops the model/list cache on success — the `cacheOnly` read path ignores
    // TTL, so without this the logged-out account's capability survives.
    await logoutCodexAndInvalidateModels(perform);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: reason }, { status: 500 });
  }
}

export async function DELETE() {
  return handleAccountDelete();
}
