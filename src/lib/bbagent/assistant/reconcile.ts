/**
 * BB Assistant — Heartbeat Reconcile
 *
 * Reconciles file-owned desired state into a single derived scheduler row
 * for BB Assistant workspaces. Forked from CodePilot's
 * `lib/assistant-heartbeat.ts` and renamed to `BbAssistantHeartbeat*` per
 * [docs/exec-plans/active/assistant-merge-into-bbagent.md](../../../../docs/exec-plans/active/assistant-merge-into-bbagent.md)
 * Phase M1.5.
 *
 * Failure never rewrites the desired file; execution has an independent
 * pre-provider guard so a stale row cannot spend model quota.
 */

import fs from 'fs';
import path from 'path';
import type { ScheduledTask } from '@/types';
import { getHeartbeatTask, getSetting } from '@/lib/db';
import { getLocalDateString } from '@/lib/utils';
import { loadBbAssistantState, saveBbAssistantState } from './workspace';

export interface BbAssistantHeartbeatDesiredState {
  workspacePath: string | null;
  enabled: boolean;
  intervalHours: number;
}

export type BbAssistantHeartbeatDesiredRead =
  | { ok: true; desired: BbAssistantHeartbeatDesiredState }
  | { ok: false; workspacePath: string | null; reason: string };

export type BbAssistantHeartbeatReconcileResult =
  | { status: 'disabled'; desired: BbAssistantHeartbeatDesiredState; task: null }
  | { status: 'scheduled' | 'repaired'; desired: BbAssistantHeartbeatDesiredState; task: ScheduledTask }
  | { status: 'blocked'; desired: BbAssistantHeartbeatDesiredState | null; task: ScheduledTask | null; reason: string };

export function readBbAssistantHeartbeatDesiredState(): BbAssistantHeartbeatDesiredRead {
  const configured = getSetting('assistant_workspace_path')?.trim();
  if (!configured) {
    return {
      ok: true,
      desired: { workspacePath: null, enabled: false, intervalHours: 24 },
    };
  }

  const workspacePath = path.resolve(configured);
  try {
    const stat = fs.statSync(workspacePath);
    if (!stat.isDirectory()) {
      return { ok: false, workspacePath, reason: 'bb agent assistant workspace is not a directory' };
    }
    const raw = fs.readFileSync(path.join(workspacePath, '.assistant', 'state.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const enabled = parsed.heartbeatEnabled === true;
    const rawInterval = typeof parsed.heartbeatIntervalHours === 'number'
      ? parsed.heartbeatIntervalHours
      : 24;
    const intervalHours = Math.max(1, Math.floor(rawInterval));
    return { ok: true, desired: { workspacePath, enabled, intervalHours } };
  } catch (error) {
    return {
      ok: false,
      workspacePath,
      reason: error instanceof Error ? error.message : 'bb agent heartbeat desired state is unreadable',
    };
  }
}

/**
 * Reconcile the file-owned desired state into the single derived scheduler
 * row. Failure never rewrites the desired file; execution has an independent
 * pre-provider guard so a stale row cannot spend model quota.
 */
export async function reconcileBbAssistantHeartbeat(): Promise<BbAssistantHeartbeatReconcileResult> {
  const read = readBbAssistantHeartbeatDesiredState();
  const before = getHeartbeatTask() || null;
  if (!read.ok) {
    return { status: 'blocked', desired: null, task: before, reason: read.reason };
  }

  try {
    const { ensureHeartbeatTask, heartbeatCronForInterval, HEARTBEAT_TASK_PROMPT } = await import('@/lib/task-scheduler');
    const desired = read.desired;
    if (!desired.enabled) {
      await ensureHeartbeatTask({ enabled: false });
      return { status: 'disabled', desired, task: null };
    }

    const expectedCron = heartbeatCronForInterval(desired.intervalHours);
    const hadDrift = !before
      || before.schedule_value !== expectedCron
      || before.prompt !== HEARTBEAT_TASK_PROMPT
      || before.status !== 'active'
      || path.resolve(before.working_directory || '.') !== desired.workspacePath;
    const task = await ensureHeartbeatTask({
      enabled: true,
      intervalHours: desired.intervalHours,
      workspacePath: desired.workspacePath || undefined,
    });
    if (!task) {
      return { status: 'blocked', desired, task: null, reason: 'heartbeat task was not created' };
    }
    return { status: hadDrift ? 'repaired' : 'scheduled', desired, task };
  } catch (error) {
    return {
      status: 'blocked',
      desired: read.desired,
      task: getHeartbeatTask() || null,
      reason: error instanceof Error ? error.message : 'bb agent heartbeat reconciliation failed',
    };
  }
}

export function bbAssistantHeartbeatTaskMatchesDesired(
  task: ScheduledTask,
  read: BbAssistantHeartbeatDesiredRead = readBbAssistantHeartbeatDesiredState(),
): read is { ok: true; desired: BbAssistantHeartbeatDesiredState } {
  if (!read.ok || !read.desired.enabled || !read.desired.workspacePath) return false;
  return path.resolve(task.working_directory || '.') === read.desired.workspacePath;
}

export function recordBbAssistantHeartbeatOutcome(
  task: ScheduledTask,
  outcome: { kind: 'silent' | 'speak_up'; text: string },
): boolean {
  const read = readBbAssistantHeartbeatDesiredState();
  if (!bbAssistantHeartbeatTaskMatchesDesired(task, read)) return false;
  try {
    const state = loadBbAssistantState(read.desired.workspacePath!);
    state.lastHeartbeatDate = getLocalDateString();
    if (outcome.kind === 'speak_up') {
      state.lastHeartbeatText = outcome.text;
      state.lastHeartbeatSentAt = Date.now();
    }
    saveBbAssistantState(read.desired.workspacePath!, state);
    return true;
  } catch {
    return false;
  }
}
