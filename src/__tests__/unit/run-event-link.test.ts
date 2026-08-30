/**
 * P1 fix (v6): `task_run_logs.notification_event_id` must be linked
 * after a fire so /api/tasks/[id]/runs can join through to delivery
 * details.
 *
 * Pre-fix: `sendTaskNotification` returned void; `executeDueTask` had
 * no event_id to write back. /runs joined on a NULL column → returned
 * `event=null` for every run → UI never saw the per-channel
 * delivery log.
 *
 * Post-fix:
 *   1. `sendNotification` returns `{ event_id, deliveries }`.
 *   2. `sendTaskNotification` propagates `event_id`.
 *   3. `executeDueTask` calls `updateTaskRunLog(runId, {
 *      notification_event_id: event_id })` after a successful notify.
 *
 * This test runs a reminder fire end-to-end and asserts:
 *   - The task_run_logs row carries a non-null notification_event_id.
 *   - The /api/tasks/[id]/runs response has `event` populated for the
 *     run (we don't actually invoke the route — we replay its join
 *     logic against the same DB, since route execution would require
 *     a Next.js server context).
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let tempDir: string;
let originalDataDir: string | undefined;

before(() => {
  originalDataDir = process.env.CLAUDE_GUI_DATA_DIR;
});

after(() => {
  if (originalDataDir === undefined) {
    delete process.env.CLAUDE_GUI_DATA_DIR;
  } else {
    process.env.CLAUDE_GUI_DATA_DIR = originalDataDir;
  }
});

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-runlink-test-'));
  process.env.CLAUDE_GUI_DATA_DIR = tempDir;
});

afterEach(async () => {
  try {
    const { closeDb } = await import('../../lib/db');
    closeDb();
  } catch { /* ignore */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).__codepilot_scheduler__;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).__codepilot_session_tasks__;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).__codepilot_notification_queue__;
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe('task_run_logs.notification_event_id link (Phase 3 Step 3 v6 fix)', () => {
  it('reminder fire writes event_id back to its run row + /runs join returns deliveries', async () => {
    const db = await import('../../lib/db');
    const past = new Date(Date.now() - 1000).toISOString();
    const task = db.createScheduledTask({
      name: 'Drink water',
      prompt: 'Stand up',
      kind: 'reminder',
      schedule_type: 'once',
      schedule_value: past,
      next_run: past,
      consecutive_errors: 0,
      status: 'active',
      priority: 'normal',
      notify_on_complete: 1,
      permanent: 0,
    });

    const { runScheduledTaskNow } = await import('../../lib/task-scheduler');
    const result = await runScheduledTaskNow(task.id);
    assert.equal(result.status, 'running');
    if (result.status !== 'running') return;
    const runId = result.runId;

    // Wait for the fire-and-forget execution to finish.
    await new Promise((r) => setTimeout(r, 300));

    const runs = db.listTaskRunLogs(task.id);
    const matching = runs.filter((r) => r.id === runId);
    assert.equal(matching.length, 1, 'one task_run_logs row per execution');
    assert.equal(matching[0].status, 'success');
    assert.ok(
      matching[0].notification_event_id,
      'task_run_logs.notification_event_id MUST be populated after a successful notify (v6 P1 fix)',
    );

    // Replay the /runs join logic: notification_event_id → events row → deliveries list.
    const event = db.getNotificationEvent(matching[0].notification_event_id!);
    assert.ok(event, 'getNotificationEvent must resolve the linked event row');
    assert.equal(event!.task_id, task.id);
    const deliveries = db.listNotificationDeliveries(event!.event_id);
    assert.ok(
      deliveries.length >= 1,
      'at least one notification_deliveries row per fire',
    );
    const channels = new Set(deliveries.map((d) => d.channel));
    assert.ok(channels.has('electron-native'), 'normal priority must produce an electron-native row');
    assert.ok(!channels.has('renderer-toast'), 'normal priority must not create a duplicate in-app toast');
  });

  it('failure path also links the failure notification to its run row', async () => {
    const db = await import('../../lib/db');
    const past = new Date(Date.now() - 1000).toISOString();
    const task = db.createScheduledTask({
      name: 'Failing AI task',
      prompt: 'Ignored — session points at a deleted provider',
      kind: 'ai_task',
      schedule_type: 'once',
      schedule_value: past,
      next_run: past,
      consecutive_errors: 0,
      status: 'active',
      priority: 'urgent',
      notify_on_complete: 1,
      permanent: 0,
    });
    // Codex P2 Phase 2 immunity gate — pre-create the task-bound
    // session pointing at a non-existent provider id so the runner's
    // `resolveProviderForSession` returns `invalidReason:
    // 'provider-missing'` and short-circuits to 'failed' BEFORE any
    // streamClaude / MCP load. This is the deterministic failure
    // trigger; the legacy "no provider configured at all" path lets
    // streamClaude env-fallback succeed silently, which is the same
    // silent-rerouting Phase 2 closed and the gate is supposed to
    // prevent.
    const sessionRow = db.createSession(
      '[Task] Failing AI task',
      undefined,
      undefined,
      undefined,
      'code',
      'definitely-not-a-real-provider',
      'default',
      'task',
    );
    db.updateScheduledTask(task.id, { session_id: sessionRow.id });

    const { runScheduledTaskNow } = await import('../../lib/task-scheduler');
    const result = await runScheduledTaskNow(task.id);
    if (result.status !== 'running') {
      assert.fail('expected runScheduledTaskNow to return running');
    }
    const runId = result.runId;

    // Provider-gate fail is fast (<50ms), but the scheduler then has
    // to dispatch sendTaskNotification → write notification_events
    // and notification_deliveries rows → updateTaskRunLog with the
    // event_id. Under DB contention from the parallel test workers
    // the multi-step linkback can stretch past a tight 400ms window,
    // so give it a comfortable margin. The path is still
    // synchronous-ish; we're not waiting for streamClaude.
    let row = db.listTaskRunLogs(task.id).find((candidate) => candidate.id === runId);
    const deadline = Date.now() + 5_000;
    while ((!row || !row.notification_event_id) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      row = db.listTaskRunLogs(task.id).find((candidate) => candidate.id === runId);
    }
    assert.ok(row);
    // Phase 3 Step 4 — new 5-state enum writes 'failed'. Legacy
    // 'error' is still accepted on read but new code paths produce
    // 'failed'. The test accepts either to stay tolerant during the
    // legacy-→-new transition (e.g. for code paths that still go
    // through the v6 fallback).
    assert.ok(
      row!.status === 'failed' || row!.status === 'error',
      `expected terminal failure status (failed | error), got ${row!.status}`,
    );
    assert.ok(
      row!.notification_event_id,
      'failure path also fires a notification — its event_id must link back to the run row so /runs surfaces the failure delivery log',
    );
  });
});
