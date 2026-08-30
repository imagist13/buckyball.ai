import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get('status') || undefined;
    // Phase 3 Step 4 — `source` query param controls heartbeat
    // visibility. Default: hide the system-injected
    // `assistant_heartbeat` task so the user-facing Tasks list isn't
    // polluted with rows they didn't create.
    // `?source=assistant_heartbeat` returns only heartbeat history
    // (used by the Settings → Assistant "view heartbeat history" link).
    // `?source=all` shows everything (debugging).
    const sourceParam = request.nextUrl.searchParams.get('source');
    const { listScheduledTasks } = await import('@/lib/db');
    const allTasks = listScheduledTasks(status ? { status } : undefined);

    let tasks = allTasks;
    if (sourceParam === 'assistant_heartbeat') {
      tasks = allTasks.filter((t) => t.source === 'assistant_heartbeat');
    } else if (sourceParam !== 'all') {
      // Default user-facing path: hide heartbeat. Legacy rows with
      // undefined source default to 'user' per the DB DEFAULT, so
      // they aren't excluded.
      tasks = allTasks.filter((t) => t.source !== 'assistant_heartbeat');
    }

    return NextResponse.json({ tasks });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
