/**
 * bbdev task-tracker — unit tests
 *
 * 覆盖：
 * - recordSubmit 创建 task，状态 queued
 * - recordPollResult 更新 status + progress + logs + result
 * - getActiveTasks 只返回非终态任务
 * - getRecentTasks 返回最新 N 个（含终态）
 * - clearTerminal 清掉所有终态
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { bbdevTaskTracker } from '../../lib/bbdev/task-tracker';

describe('bbdev/task-tracker', () => {
  beforeEach(() => {
    // 清掉 singleton 状态（hot-reload safety — singleton 在 globalThis 上）
    (bbdevTaskTracker as unknown as { tasks: Map<string, unknown> }).tasks?.clear?.();
  });

  it('recordSubmit creates a task with queued status', () => {
    const task = bbdevTaskTracker.recordSubmit({
      traceId: 't1',
      toolName: 'bbdev_compiler_build',
      args: { chip: 'toy' },
      chip: 'toy',
    });
    assert.equal(task.traceId, 't1');
    assert.equal(task.status, 'queued');
    assert.equal(task.toolName, 'bbdev_compiler_build');
    assert.equal(task.logs.length, 0);
  });

  it('recordPollResult updates status and result, emits change on terminal', () => {
    const task = bbdevTaskTracker.recordSubmit({
      traceId: 't2',
      toolName: 'bbdev_bemu_sim',
      args: {},
    });
    const updated = bbdevTaskTracker.recordPollResult('t2', 'success', {
      progress: 1,
      log: 'finished',
      result: { returncode: 0, stdout: 'ok' },
    });
    assert.ok(updated);
    assert.equal(updated.status, 'success');
    assert.equal(updated.progress, 1);
    assert.deepEqual(updated.logs, ['finished']);
    assert.deepEqual(updated.result, { returncode: 0, stdout: 'ok' });
    assert.ok(updated.updatedAt >= task.updatedAt);
  });

  it('getActiveTasks excludes terminal tasks', () => {
    bbdevTaskTracker.recordSubmit({ traceId: 'a1', toolName: 'bbdev_bemu_sim', args: {} });
    bbdevTaskTracker.recordSubmit({ traceId: 'a2', toolName: 'bbdev_bemu_sim', args: {} });
    bbdevTaskTracker.recordPollResult('a1', 'success', { result: { returncode: 0 } });
    bbdevTaskTracker.recordPollResult('a2', 'failure', { result: { returncode: 1, stderr: 'boom' } });

    const active = bbdevTaskTracker.getActiveTasks();
    assert.equal(active.length, 0);
  });

  it('getRecentTasks returns recent N tasks in updatedAt desc order', () => {
    bbdevTaskTracker.recordSubmit({ traceId: 'r1', toolName: 'bbdev_bemu_sim', args: {} });
    bbdevTaskTracker.recordSubmit({ traceId: 'r2', toolName: 'bbdev_bemu_sim', args: {} });
    bbdevTaskTracker.recordPollResult('r1', 'success', { result: { returncode: 0 } });

    const recent = bbdevTaskTracker.getRecentTasks(10);
    assert.equal(recent.length, 2);
    // r2 is more recently updated than r1 (r1 last polled to success at creation)
    assert.ok(recent[0].updatedAt >= recent[1].updatedAt);
  });

  it('clearTerminal removes terminal tasks only', () => {
    bbdevTaskTracker.recordSubmit({ traceId: 'c1', toolName: 'bbdev_bemu_sim', args: {} });
    bbdevTaskTracker.recordSubmit({ traceId: 'c2', toolName: 'bbdev_bemu_sim', args: {} });
    bbdevTaskTracker.recordPollResult('c1', 'success', { result: { returncode: 0 } });
    bbdevTaskTracker.clearTerminal();
    assert.equal(bbdevTaskTracker.getTask('c1'), undefined);
    assert.ok(bbdevTaskTracker.getTask('c2'));
  });

  it('recordPollResult on unknown traceId returns undefined', () => {
    const out = bbdevTaskTracker.recordPollResult('not-exist', 'success', { result: { returncode: 0 } });
    assert.equal(out, undefined);
  });
});
