/**
 * POST /api/bridge/feishu/register/cancel
 *
 * Cancel an in-progress Feishu App Registration session.
 * Removes the session from the server so a late browser confirmation
 * won't silently complete and leave an orphaned app tracked by CodePilot.
 */

import { NextResponse } from 'next/server';
import { cancelRegistration } from '@/lib/bridge/feishu-app-registration';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = body.session_id;
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
    }
    cancelRegistration(sessionId);
    return NextResponse.json({ cancelled: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to cancel' },
      { status: 500 },
    );
  }
}
