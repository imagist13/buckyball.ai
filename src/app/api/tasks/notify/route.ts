import { NextRequest, NextResponse } from 'next/server';

/**
 * POST: Receive a notification from MCP tools / task scheduler and queue it.
 * GET:  Frontend polls this to drain queued notifications for toast display.
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, body: notifBody, priority } = body as { title: string; body: string; priority?: string };

    if (!title) {
      return NextResponse.json({ error: 'Missing title' }, { status: 400 });
    }

    const { sendNotification } = await import('@/lib/notification-manager');
    const result = await sendNotification({
      title,
      body: notifBody || '',
      priority: (priority as 'low' | 'normal' | 'urgent') || 'normal',
    });

    // Phase 3 Step 3: sendNotification's return shape is now
    // { event_id, deliveries: [{channel, status}, …] }. The
    // `sent` array (channel names that "fired") is reconstructed
    // from non-queued deliveries so external callers / tests that
    // historically read `result.sent` keep working.
    const sent = result.deliveries
      .filter((d) => d.status === 'delivered' || d.status === 'queued')
      .map((d) => d.channel);
    return NextResponse.json({
      success: true,
      sent,
      event_id: result.event_id,
      deliveries: result.deliveries,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'Destructive notification drain retired; use channel-scoped POST claim.' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}
