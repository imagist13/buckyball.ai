import { NextResponse } from 'next/server';
import { invalidateClaudeClientCache } from '@/lib/claude-client';
import { invalidateWingetCache } from '@/lib/platform';

/**
 * POST /api/claude-status/invalidate
 * Clears all cached Claude binary paths and install-type detection so the next
 * status check picks up freshly-installed binaries. Called by the install
 * wizard and upgrade flow on success.
 */
export async function POST() {
  invalidateClaudeClientCache();
  invalidateWingetCache();
  return NextResponse.json({ ok: true });
}
