import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import {
  consolidateHeartbeatTasksAndEnsureUniqueIndex,
  getAllSessions,
  getHeartbeatTask,
  listTaskRunLogs,
  removeHeartbeatTask,
  setSetting,
  updateScheduledTask,
} from '@/lib/db';
import { initializeWorkspace, loadState, saveState } from '@/lib/assistant-workspace';
import { reconcileAssistantHeartbeat } from '@/lib/assistant-heartbeat';
import { runScheduledAgentTask } from '@/lib/agent-task-runner';
import { setProviderCallPolicyObserverForTests } from '@/lib/provider-call-policy';

describe('assistant heartbeat reconciliation', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-heartbeat-'));
    initializeWorkspace(workspace);
    setSetting('assistant_workspace_path', workspace);
    removeHeartbeatTask();
  });

  afterEach(() => {
    setProviderCallPolicyObserverForTests(null);
    removeHeartbeatTask();
    setSetting('assistant_workspace_path', '');
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('creates exactly one row, preserves unchanged next_run, and applies cadence changes in place', async () => {
    const state = loadState(workspace);
    state.heartbeatEnabled = true;
    state.heartbeatIntervalHours = 24;
    saveState(workspace, state);

    const first = await reconcileAssistantHeartbeat();
    assert.equal(first.status, 'repaired');
    const task = getHeartbeatTask()!;
    const fixedFuture = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    updateScheduledTask(task.id, { next_run: fixedFuture });

    const unchanged = await reconcileAssistantHeartbeat();
    assert.equal(unchanged.status, 'scheduled');
    assert.equal(getHeartbeatTask()!.id, task.id);
    assert.equal(getHeartbeatTask()!.next_run, fixedFuture);

    const changedState = loadState(workspace);
    changedState.heartbeatIntervalHours = 1;
    saveState(workspace, changedState);
    await reconcileAssistantHeartbeat();
    assert.equal(getHeartbeatTask()!.id, task.id);
    assert.equal(getHeartbeatTask()!.schedule_value, '0 */1 * * *');
    assert.notEqual(getHeartbeatTask()!.next_run, fixedFuture);
  });

  it('removes the derived row when desired state is disabled', async () => {
    const state = loadState(workspace);
    state.heartbeatEnabled = true;
    saveState(workspace, state);
    await reconcileAssistantHeartbeat();
    assert.ok(getHeartbeatTask());

    const disabled = loadState(workspace);
    disabled.heartbeatEnabled = false;
    saveState(workspace, disabled);
    const result = await reconcileAssistantHeartbeat();
    assert.equal(result.status, 'disabled');
    assert.equal(getHeartbeatTask(), undefined);
  });

  it('skips empty content before session/provider work', async () => {
    const state = loadState(workspace);
    state.heartbeatEnabled = true;
    saveState(workspace, state);
    fs.writeFileSync(path.join(workspace, 'HEARTBEAT.md'), '# Heartbeat\n\n- [ ]\n', 'utf-8');
    await reconcileAssistantHeartbeat();
    const task = getHeartbeatTask()!;
    const sessionCount = getAllSessions().length;
    let providerBoundaryHits = 0;
    setProviderCallPolicyObserverForTests(() => { providerBoundaryHits += 1; });

    const result = await runScheduledAgentTask(task);
    assert.equal(result.status, 'skipped_empty');
    assert.equal(providerBoundaryHits, 0);
    assert.equal(getAllSessions().length, sessionCount);
    assert.equal(listTaskRunLogs(task.id, 1)[0]?.status, 'skipped_empty');
  });

  it('blocks a stale active row after disable before session/provider work', async () => {
    const state = loadState(workspace);
    state.heartbeatEnabled = true;
    saveState(workspace, state);
    await reconcileAssistantHeartbeat();
    const staleTask = getHeartbeatTask()!;

    const disabled = loadState(workspace);
    disabled.heartbeatEnabled = false;
    saveState(workspace, disabled);
    let providerBoundaryHits = 0;
    setProviderCallPolicyObserverForTests(() => { providerBoundaryHits += 1; });

    const result = await runScheduledAgentTask(staleTask);
    assert.equal(result.status, 'skipped_reconcile_drift');
    assert.equal(providerBoundaryHits, 0);
  });
});

describe('heartbeat uniqueness migration', () => {
  it('re-links run/event history before deleting duplicate system rows', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE scheduled_tasks (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE TABLE task_run_logs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL);
      CREATE TABLE notification_events (id TEXT PRIMARY KEY, task_id TEXT);
    `);
    db.prepare('INSERT INTO scheduled_tasks VALUES (?, ?, ?, ?)').run('keeper', 'assistant_heartbeat', 'active', '2026-08-03 10:00:00');
    db.prepare('INSERT INTO scheduled_tasks VALUES (?, ?, ?, ?)').run('duplicate', 'assistant_heartbeat', 'disabled', '2026-08-03 09:00:00');
    db.prepare('INSERT INTO scheduled_tasks VALUES (?, ?, ?, ?)').run('user-task', 'user', 'active', '2026-08-03 11:00:00');
    db.prepare('INSERT INTO task_run_logs VALUES (?, ?)').run('run-1', 'duplicate');
    db.prepare('INSERT INTO notification_events VALUES (?, ?)').run('event-1', 'duplicate');

    consolidateHeartbeatTasksAndEnsureUniqueIndex(db);

    assert.deepEqual(
      db.prepare("SELECT id FROM scheduled_tasks WHERE source='assistant_heartbeat'").all(),
      [{ id: 'keeper' }],
    );
    assert.equal((db.prepare("SELECT task_id FROM task_run_logs WHERE id='run-1'").get() as { task_id: string }).task_id, 'keeper');
    assert.equal((db.prepare("SELECT task_id FROM notification_events WHERE id='event-1'").get() as { task_id: string }).task_id, 'keeper');
    assert.ok(db.prepare("SELECT id FROM scheduled_tasks WHERE id='user-task'").get());
    assert.throws(() => {
      db.prepare('INSERT INTO scheduled_tasks VALUES (?, ?, ?, ?)').run('second', 'assistant_heartbeat', 'active', '2026-08-03 12:00:00');
    });
    db.close();
  });
});
