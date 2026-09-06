import { NextRequest, NextResponse } from 'next/server';

/**
 * Phase 3 Step 3 — task execution history.
 *
 * Returns the most-recent `task_run_logs` rows for this task, each
 * augmented with the linked `notification_events` umbrella + its
 * `notification_deliveries` per-channel rows so the UI can render
 * "this run notified renderer-toast: delivered, electron-native:
 * delivered, bridge-telegram: not_configured" in one shot.
 */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const {
      getScheduledTask,
      listTaskRunLogs,
      getNotificationEvent,
      listNotificationDeliveries,
    } = await import('@/lib/db');

    const task = getScheduledTask(id);
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const runs = listTaskRunLogs(id, 50).map((run) => {
      const event = run.notification_event_id
        ? getNotificationEvent(run.notification_event_id) ?? null
        : null;
      const deliveries = event
        ? listNotificationDeliveries(event.event_id)
        : [];
      return { ...run, event, deliveries };
    });

    return NextResponse.json({ runs });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
