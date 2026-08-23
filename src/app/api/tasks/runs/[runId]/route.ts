/**
 * Phase 3 Step 4 — abandon-run endpoint.
 *
 * Used by the "Abandon" button in `<TaskWaitingForPermissionPanel />`
 * when the user enters a task-bound session whose latest run is in
 * `waiting_for_permission`. The action:
 *
 *   1. Flip `task_run_logs.status` from `waiting_for_permission` →
 *      `cancelled` (terminal state, idempotent so double-click won't
 *      re-process).
 *   2. Un-pause `scheduled_tasks.status` (back to `'active'`) so the
 *      scheduler resumes considering this task on its normal cadence.
 *
 * **No durable resume in v1.** The user's other option is "Re-run this
 * task" which goes through the existing `/api/tasks/{id}/run`
 * endpoint and creates a *new* runId from scratch — the old
 * `waiting_for_permission` row stays in history. This route handles
 * only the abandon case.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getTaskRunById,
  updateTaskRunLog,
  getScheduledTask,
  updateScheduledTask,
} from '@/lib/db';

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    const run = getTaskRunById(runId);
    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }
    // Only `running` and `waiting_for_permission` are valid abandon
    // sources. Already-terminal rows (succeeded / failed / cancelled)
    // are treated as no-ops so a double-click doesn't surface an
    // error to the user.
    if (run.status !== 'running' && run.status !== 'waiting_for_permission') {
      return NextResponse.json({ ok: true, status: run.status, noop: true });
    }
    updateTaskRunLog(runId, { status: 'cancelled' });

    // Un-pause the parent task so the scheduler resumes considering
    // it. If the task wasn't paused (rare — agent might have failed
    // to set status='paused' on the way to waiting_for_permission)
    // this is a no-op.
    const task = getScheduledTask(run.task_id);
    if (task && task.status === 'paused') {
      updateScheduledTask(task.id, { status: 'active' });
    }
    return NextResponse.json({ ok: true, status: 'cancelled' });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to cancel run' },
      { status: 500 },
    );
  }
}
