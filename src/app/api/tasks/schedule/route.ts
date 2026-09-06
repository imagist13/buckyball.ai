import { NextRequest, NextResponse } from 'next/server';
import { parseInterval, getNextCronTime, ensureSchedulerRunning } from '@/lib/task-scheduler';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      prompt,
      schedule_type,
      schedule_value,
      kind,
      priority,
      notify_on_complete,
      session_id,
      origin_session_id,
      working_directory,
    } = body;

    if (!name || !prompt || !schedule_type || !schedule_value) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Phase 3 Step 4 follow-up — guardrail: codepilot_schedule_task is
    // the only public surface that calls this route, and it MUST NOT
    // be able to create heartbeat-source tasks. `assistant_heartbeat`
    // is reserved for `ensureHeartbeatTask` (system-injected, single
    // row, special silent contract). Reject any explicit `source` in
    // the body — `createScheduledTask` would already coerce non-
    // 'assistant_heartbeat' values to 'user', but a 400 here makes
    // the contract loud + prevents silent ignored fields.
    if (body.source !== undefined) {
      return NextResponse.json(
        {
          error:
            'source field is not accepted on this route — it is reserved for the system-injected heartbeat task and is set internally.',
        },
        { status: 400 },
      );
    }

    // Phase 3 Step 3 — `kind` is required and validated server-side. We do
    // NOT default to 'ai_task' here: that would let an AI tool create a
    // "remind me" task without specifying kind and silently route it
    // through the model. The DB column has a default for migration of
    // legacy rows ONLY; new creations must specify.
    if (kind !== 'reminder' && kind !== 'ai_task') {
      return NextResponse.json(
        { error: "kind must be 'reminder' or 'ai_task'" },
        { status: 400 },
      );
    }

    // Calculate next_run
    let next_run: string;
    const now = new Date();

    if (schedule_type === 'once') {
      next_run = new Date(schedule_value).toISOString();
    } else if (schedule_type === 'interval') {
      const ms = parseInterval(schedule_value);
      next_run = new Date(now.getTime() + ms).toISOString();
    } else if (schedule_type === 'cron') {
      const cronNext = getNextCronTime(schedule_value);
      if (!cronNext) {
        return NextResponse.json({ error: `Cron expression "${schedule_value}" has no valid occurrence within 4 years` }, { status: 400 });
      }
      next_run = cronNext.toISOString();
    } else {
      return NextResponse.json({ error: 'Invalid schedule_type' }, { status: 400 });
    }

    // v7 fix — normalize `notify_on_complete` to 0/1 BEFORE handing it
    // to better-sqlite3. AI tool / external callers may POST `true` or
    // `false` (the natural JS shape); the column is INTEGER and
    // better-sqlite3 throws "SQLite3 can only bind numbers, strings,
    // bigints, buffers, and null" on raw booleans. Treat any of
    // (false, 0, '0') as 0; everything else (including undefined/null
    // and missing field) as 1 — that matches the historical default
    // "notify on complete" behavior.
    const notifyFlag: 0 | 1 =
      notify_on_complete === false || notify_on_complete === 0 || notify_on_complete === '0'
        ? 0
        : 1;

    const { createScheduledTask } = await import('@/lib/db');
    const task = createScheduledTask({
      name, prompt, schedule_type, schedule_value, kind, next_run,
      status: 'active',
      priority: priority || 'normal',
      notify_on_complete: notifyFlag,
      consecutive_errors: 0,
      permanent: 0,
      session_id: session_id || undefined,
      origin_session_id: origin_session_id || undefined,
      working_directory: working_directory || undefined,
    });

    // Ensure the scheduler is running
    ensureSchedulerRunning();

    return NextResponse.json({ task });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
