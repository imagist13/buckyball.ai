/**
 * bbdev/task-tracker.ts — 异步任务追踪器
 *
 * bbdev 工具是 submit-and-poll 模型：
 *   1. submit (e.g. bbdev_compiler_build) → 返回 trace_id
 *   2. 轮询 bbdev_task_status(trace_id) → success/failure
 *
 * 本模块维护一份活跃任务表（按 traceId 索引），并提供：
 * - recordSubmit() — 任务提交后登记
 * - recordPollResult() — 一次轮询结果落地
 * - subscribe() — UI / SSE 流订阅状态变化
 * - getActiveTasks() — 给 bbdev Panel 列出"当前活跃"
 *
 * 不持久化到 SQLite（任务生命周期短，重启清空即可；bbdev 自己的 trace_id 状态走
 * 它自己的后端存储，重启后我们重新拉一次 status 就拿到最终态）。
 */

import { EventEmitter } from 'events';
import type {
  BbdevTask,
  BbdevTaskStatus,
  BbdevToolName,
} from './types';

const MAX_LOGS_PER_TASK = 500;
const MAX_ACTIVE_TASKS = 200;

class BbdevTaskTracker extends EventEmitter {
  private tasks = new Map<string, BbdevTask>();

  /**
   * 登记一次新的 bbdev 提交（同步返回 traceId）
   */
  recordSubmit(input: {
    traceId: string;
    toolName: BbdevToolName;
    args: Record<string, unknown>;
    chip?: string;
  }): BbdevTask {
    const now = Date.now();
    const task: BbdevTask = {
      traceId: input.traceId,
      toolName: input.toolName,
      args: input.args,
      chip: input.chip,
      status: 'queued',
      logs: [],
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(input.traceId, task);
    this.evictIfNeeded();
    this.emit('change', task);
    return task;
  }

  /**
   * 把一次 bbdev_task_status 轮询结果落地
   * 只在状态字段相对上次有变化时触发 'change'
   */
  recordPollResult(
    traceId: string,
    status: BbdevTaskStatus,
    extras?: {
      progress?: number;
      log?: string;
      result?: BbdevTask['result'];
    },
  ): BbdevTask | undefined {
    const task = this.tasks.get(traceId);
    if (!task) return undefined;

    let changed = task.status !== status;
    task.status = status;

    if (extras?.progress !== undefined && extras.progress !== task.progress) {
      task.progress = extras.progress;
      changed = true;
    }
    if (extras?.log) {
      task.logs.push(extras.log);
      if (task.logs.length > MAX_LOGS_PER_TASK) {
        task.logs.splice(0, task.logs.length - MAX_LOGS_PER_TASK);
      }
      changed = true;
    }
    if (extras?.result) {
      task.result = extras.result;
      changed = true;
    }
    task.updatedAt = Date.now();

    if (changed) this.emit('change', task);
    if (status === 'success' || status === 'failure') {
      this.emit('terminal', task);
    }
    return task;
  }

  /**
   * 列出当前所有活跃任务（status != success/failure）
   * 按 updatedAt 倒序
   */
  getActiveTasks(): BbdevTask[] {
    const list: BbdevTask[] = [];
    for (const t of this.tasks.values()) {
      if (t.status !== 'success' && t.status !== 'failure') list.push(t);
    }
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * 最近 N 个任务（不限状态），给 Panel "Recent Tasks" 用
   */
  getRecentTasks(limit = 50): BbdevTask[] {
    const list = [...this.tasks.values()];
    return list.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }

  getTask(traceId: string): BbdevTask | undefined {
    return this.tasks.get(traceId);
  }

  clearTerminal(): void {
    for (const [id, t] of this.tasks) {
      if (t.status === 'success' || t.status === 'failure') {
        this.tasks.delete(id);
      }
    }
  }

  private evictIfNeeded(): void {
    if (this.tasks.size <= MAX_ACTIVE_TASKS) return;
    // 先清掉已经终态的
    for (const [id, t] of this.tasks) {
      if (t.status === 'success' || t.status === 'failure') {
        this.tasks.delete(id);
      }
    }
    // 还超过就按 updatedAt 升序淘汰最旧
    if (this.tasks.size > MAX_ACTIVE_TASKS) {
      const sorted = [...this.tasks.entries()].sort(
        ([, a], [, b]) => a.updatedAt - b.updatedAt,
      );
      const overflow = this.tasks.size - MAX_ACTIVE_TASKS;
      for (let i = 0; i < overflow; i++) {
        this.tasks.delete(sorted[i][0]);
      }
    }
  }
}

// 模块级单例（Hot reload 安全：放在 globalThis 上）
type GlobalWithTracker = typeof globalThis & {
  __bbdevTaskTracker?: BbdevTaskTracker;
};
const g = globalThis as GlobalWithTracker;
if (!g.__bbdevTaskTracker) {
  g.__bbdevTaskTracker = new BbdevTaskTracker();
}
export const bbdevTaskTracker = g.__bbdevTaskTracker;
