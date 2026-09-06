/**
 * GET /api/codex/rate-limits
 *
 * Phase 5 Phase 6 IA correction (2026-05-14) — surfaces the Codex
 * Account quota snapshot to the Providers' virtual Codex Account card.
 *
 * Wraps `account/rateLimits/read` on the shared app-server client.
 * Returns the narrowed `CodexRateLimitSnapshot` shape; UI renders:
 *
 *   - primary window:   "已用 X%, Y 后重置"  (typically the 5h bucket)
 *   - secondary window: "已用 X%, Y 后重置"  (typically the 7d bucket)
 *   - credits.balance:  optional, only when upstream returns it
 *   - planType:         echoed for display alongside account.planType
 *   - rateLimitReachedType: non-null = currently limited, render warning
 *
 * Non-throwing — when the app-server isn't ready, the user isn't
 * logged in, or upstream errors, returns `{ snapshot: null, error }`
 * so the Settings card can show a soft "Sign in to see your quota"
 * empty state instead of breaking the page.
 */

import { NextResponse } from 'next/server';
import { readCodexRateLimits } from '@/lib/codex/account';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snapshot = await readCodexRateLimits();
    return NextResponse.json({ snapshot });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ snapshot: null, error: reason }, { status: 200 });
  }
}
