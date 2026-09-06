import { NextRequest, NextResponse } from 'next/server';

/**
 * Phase 3 Step 3 — "Run Now" controlled execution.
 *
 * Behavior:
 *   - Calls `runScheduledTaskNow(id)` which atomically takes the
 *     `last_status='running'` lock, inserts a `task_run_logs` row with
 *     status='running', and fires the work fire-and-forget.
 *   - Returns `{ status: 'running', runId }` immediately so the UI can
 *     pivot without waiting for the actual execution.
 *   - Concurrent runs (poll-cycle + manual press racing) cooperate via
 *     the row-lock; the loser gets `{ status: 'already_running', runId }`
 *     pointing at the in-flight row.
 *
 * Replaces the old "set next_run = now and wait for next poll" pattern,
 * which gave the UI a 10-second lag and could write a duplicate
 * task_run_logs row on race.
 */
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { runScheduledTaskNow, ensureSchedulerRunning } = await import('@/lib/task-scheduler');

    // Make sure the scheduler is alive — runScheduledTaskNow only
    // covers this one shot, but we still need the poll loop running
    // for the next scheduled fire.
    ensureSchedulerRunning();

    const result = await runScheduledTaskNow(id);
    if (result.status === 'not_found') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
