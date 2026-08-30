import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/model — Switch model mid-session.
 *
 * The frontend updates the session record in DB before calling this endpoint.
 * Native Runtime reads the model from the session DB at each agent-loop start,
 * so the DB update is all that's needed — no SDK conversation object required.
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId, model } = await request.json();

    if (!sessionId || !model) {
      return NextResponse.json({ error: 'sessionId and model are required' }, { status: 400 });
    }

    // Model is persisted to DB by the frontend (PATCH /api/chat/sessions/:id).
    // The next agent-loop invocation reads it from the session record.
    // No runtime-specific action needed here.
    return NextResponse.json({ applied: true });
  } catch (error) {
    console.error('[model] Failed to set model:', error);
    return NextResponse.json({ applied: false, error: String(error) });
  }
}
