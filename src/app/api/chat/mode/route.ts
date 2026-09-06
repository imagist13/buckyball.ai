import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/mode — Switch mode (code/plan) mid-session.
 *
 * The frontend updates the session mode in DB before calling this endpoint.
 * Native Runtime reads the mode from the session at each agent-loop start
 * and passes it to the permission system. No SDK conversation object required.
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId, mode } = await request.json();

    if (!sessionId || !mode) {
      return NextResponse.json({ error: 'sessionId and mode are required' }, { status: 400 });
    }

    // Mode is persisted to DB by the frontend (PATCH /api/chat/sessions/:id).
    // The next agent-loop invocation reads it from the session record.
    // No runtime-specific action needed here.
    return NextResponse.json({ applied: true });
  } catch (error) {
    console.error('[mode] Failed to switch mode:', error);
    return NextResponse.json({ applied: false, error: String(error) });
  }
}
