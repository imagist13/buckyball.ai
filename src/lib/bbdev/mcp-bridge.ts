/**
 * bbdev/mcp-bridge.ts — bbdev MCP 调用桥接层
 *
 * Native Runtime 通过本模块调 bbdev：
 * - submit*()         提交异步任务，登记 traceId 到 task-tracker
 * - pollTask()        拉一次 bbdev_task_status 结果并落地
 * - callSync()        同步工具（validate 等）
 *
 * 同时为 Native Runtime 的 tool loop 提供 bbdev 工具的 JSON Schema 定义，
 * 这些定义会跟普通 MCP 工具一起注册。
 */

import {
  callMcpTool,
  getAllMcpTools,
} from '../mcp-connection-manager';
import { BBDEV_MCP_SERVER_NAME } from './connection';
import {
  BBDEV_TOOL_NAMES,
  type BbdevTask,
  type BbdevTaskStatus,
  type BbdevToolName,
} from './types';
import { bbdevTaskTracker } from './task-tracker';

// ── 工具分类 ─────────────────────────────────────────────────────

/**
 * 提交类工具：调用后立刻返回 trace_id，需要后续轮询
 * （来源：buckyball/scripts/claude/README.md "Server lifecycle"）
 */
export const SUBMIT_TOOLS: ReadonlySet<BbdevToolName> = new Set<BbdevToolName>([
  'bbdev_config_install',
  'bbdev_compiler_build',
  'bbdev_workload_build',
  'bbdev_workload_tohex',
  'bbdev_bemu_sim',
  'bbdev_bemu_batch',
  'bbdev_bebop_verilator_build',
  'bbdev_bebop_verilator_sim',
  'bbdev_bebop_verilator_run',
  'bbdev_bebop_verilator_batch',
  'bbdev_verilator_build',
  'bbdev_verilator_sim',
  'bbdev_verilator_run',
  'bbdev_vcs_build',
  'bbdev_vcs_sim',
  'bbdev_vcs_run',
  'bbdev_bebop_p2e_buildbitstream',
  'bbdev_bebop_p2e_runworkload',
  'bbdev_bebop_p2e_batch',
  'bbdev_uvm_build',
  'bbdev_uvm_run',
  'bbdev_yosys_run',
  'bbdev_yosys_synth',
  'bbdev_dc_verilog',
  'bbdev_firesim_enumeratefpgas',
  'bbdev_firesim_buildbitstream',
  'bbdev_firesim_infrasetup',
  'bbdev_firesim_runworkload',
  'bbdev_kernel_build',
]);

/**
 * 同步工具：调用后直接返回结果，不需要 trace_id
 */
export const SYNC_TOOLS: ReadonlySet<BbdevToolName> = new Set<BbdevToolName>([
  'validate',
  'bbdev_task_status',
  'bbdev_compiler_clean',
  'bbdev_workload_clean',
  'bbdev_bebop_verilator_clean',
  'bbdev_bebop_verilator_verilog',
  'bbdev_verilator_clean',
  'bbdev_verilator_verilog',
  'bbdev_vcs_clean',
  'bbdev_vcs_verilog',
  'bbdev_bebop_p2e_clean',
  'bbdev_bebop_p2e_verilog',
  'bbdev_uvm_verilog',
  'bbdev_yosys_verilog',
]);

// ── 提交与轮询 ───────────────────────────────────────────────────

export interface SubmitResult {
  traceId: string;
  accepted: boolean;
  processing: boolean;
  raw: unknown;
}

function extractTraceId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  // bbdev 的返回约定：{ accepted, processing, trace_id }
  // MCP 包了一层：可能是 { content: [{ type: 'text', text: '<json>' }] }
  if (typeof p.trace_id === 'string') return p.trace_id;
  if (Array.isArray(p.content)) {
    for (const part of p.content) {
      if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') {
        const text = (part as Record<string, unknown>).text as string;
        try {
          const inner = JSON.parse(text);
          if (inner && typeof inner === 'object' && typeof (inner as Record<string, unknown>).trace_id === 'string') {
            return (inner as Record<string, unknown>).trace_id as string;
          }
        } catch {
          // 忽略非 JSON 内容
        }
      }
    }
  }
  return null;
}

/**
 * 提交一个 bbdev 异步任务
 * 自动登记到 task-tracker，并触发一次 bbdev_task_status 轮询
 */
export async function submitBbdevTask(input: {
  toolName: BbdevToolName;
  args: Record<string, unknown>;
  chip?: string;
}): Promise<SubmitResult> {
  const result = await callMcpTool(BBDEV_MCP_SERVER_NAME, input.toolName, input.args);
  const traceId = extractTraceId(result);

  if (!traceId) {
    // 没有拿到 trace_id，说明服务端不是按约定返回的，直接当作失败抛出
    throw new BbdevBridgeError(
      `bbdev ${input.toolName} 未返回 trace_id`,
      'NO_TRACE_ID',
      result,
    );
  }

  bbdevTaskTracker.recordSubmit({
    traceId,
    toolName: input.toolName,
    args: input.args,
    chip: input.chip,
  });

  return {
    traceId,
    accepted: true,
    processing: true,
    raw: result,
  };
}

export interface PollResult {
  traceId: string;
  status: BbdevTaskStatus;
  progress?: number;
  log?: string;
  result?: BbdevTask['result'];
  raw: unknown;
}

/**
 * 拉一次 bbdev_task_status，结果会同时落到 task-tracker
 */
export async function pollBbdevTask(traceId: string): Promise<PollResult> {
  const raw = await callMcpTool(BBDEV_MCP_SERVER_NAME, 'bbdev_task_status', { trace_id: traceId });

  // bbdev 返回：{ success, failure, processing, queued, returncode, stdout, stderr, progress? }
  let status: BbdevTaskStatus = 'unknown';
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (r.success === true) status = 'success';
    else if (r.failure === true) status = 'failure';
    else if (r.processing === true) status = 'processing';
    else if (r.queued === true) status = 'queued';
  }

  const progress =
    raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).progress === 'number'
      ? ((raw as Record<string, unknown>).progress as number)
      : undefined;

  const log =
    raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).log === 'string'
      ? ((raw as Record<string, unknown>).log as string)
      : undefined;

  let result: BbdevTask['result'] | undefined;
  if (status === 'success' || status === 'failure') {
    const r = raw as Record<string, unknown>;
    result = {
      returncode: typeof r.returncode === 'number' ? r.returncode : undefined,
      stdout: typeof r.stdout === 'string' ? r.stdout : undefined,
      stderr: typeof r.stderr === 'string' ? r.stderr : undefined,
    };
  }

  bbdevTaskTracker.recordPollResult(traceId, status, { progress, log, result });

  return { traceId, status, progress, log, result, raw };
}

/**
 * 同步工具：validate / *_clean / *_verilog / bbdev_task_status
 */
export async function callBbdevSync(
  toolName: BbdevToolName,
  args: Record<string, unknown>,
): Promise<unknown> {
  return callMcpTool(BBDEV_MCP_SERVER_NAME, toolName, args);
}

// ── 给 Native Runtime 用的工具定义（聚合 bbdev + 其他 MCP） ────────

/**
 * Native Runtime 的 tool loop 应该用 getAllMcpTools()；
 * 本函数只暴露 bbdev 自己的工具，给 bbdev Panel UI / sidebar 用。
 */
export function getBbdevTools() {
  return getAllMcpTools().filter(t => t.serverName === BBDEV_MCP_SERVER_NAME);
}

/**
 * Native Runtime 调用 bbdev 工具的统一入口
 *  - submit 类：自动登记 + 返回 SubmitResult
 *  - sync 类：直接转发
 *  - bbdev_task_status：走 pollBbdevTask（确保 task-tracker 同步）
 */
export async function callBbdevTool(
  toolName: BbdevToolName,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!BBDEV_TOOL_NAMES.includes(toolName)) {
    throw new BbdevBridgeError(`未知 bbdev 工具: ${toolName}`, 'UNKNOWN_TOOL');
  }
  if (toolName === 'bbdev_task_status') {
    const traceId = typeof args.trace_id === 'string' ? args.trace_id : '';
    if (!traceId) throw new BbdevBridgeError('bbdev_task_status 缺少 trace_id', 'BAD_ARGS');
    const poll = await pollBbdevTask(traceId);
    return { status: poll.status, progress: poll.progress, log: poll.log, result: poll.result };
  }
  if (SUBMIT_TOOLS.has(toolName)) {
    return submitBbdevTask({ toolName, args });
  }
  return callBbdevSync(toolName, args);
}

// ── 错误类型 ──────────────────────────────────────────────────────

export type BbdevBridgeErrorCode =
  | 'NO_TRACE_ID'
  | 'UNKNOWN_TOOL'
  | 'BAD_ARGS'
  | 'NOT_CONNECTED'
  | 'INTERNAL';

export class BbdevBridgeError extends Error {
  readonly code: BbdevBridgeErrorCode;
  readonly detail?: unknown;
  constructor(message: string, code: BbdevBridgeErrorCode, detail?: unknown) {
    super(message);
    this.name = 'BbdevBridgeError';
    this.code = code;
    this.detail = detail;
  }
}
