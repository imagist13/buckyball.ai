/**
 * bbagent/types.ts — bbagent 注入层的类型定义
 *
 * 所有 BB-specific 改动都通过这套类型与 Runtime 解耦。
 * Runtime 改造点只调用 `applyBbInjection(config)`，不接触 BB 细节。
 */

export type BbRuntimeKind = 'native' | 'claude_code' | 'codex';

/**
 * 当前 chip 的运行时上下文
 *
 * - chip: 当前选中的 chip 名（toy / pebble / ...）
 * - balldomain: 可选；ball domain 标识
 * - repoRoot: buckyball 仓库根（含 bbdev/mcp/、scripts/claude/run_mcp_server.sh）
 * - remoteUrl: SSE 远程模式时存在；local stdio 模式为 undefined
 */
export interface BbContext {
  chip: string;
  balldomain?: string;
  repoRoot: string;
  remoteUrl?: string;
}

/**
 * 注入配置：调用方传入 Runtime + 当前 context
 */
export interface BbInjectConfig {
  runtime: BbRuntimeKind;
  context: BbContext;
}

/**
 * 三种注入点
 */
export type BbInjectorKind = 'mcp' | 'skill' | 'prompt';

/**
 * 注入结果
 * - applied: 整体是否成功（false = 全部降级）
 * - failures: 单点失败列表（不影响其它注入点继续工作）
 *
 * 设计原则：单点失败 ≠ 整体失败。MCP 注入失败仍然可以保留 skill/prompt 注入。
 */
export interface BbInjectResult {
  applied: boolean;
  failures: Array<{
    injector: BbInjectorKind;
    reason: string;
  }>;
}

/**
 * 单个注入器的返回（mcp / skill / prompt 各自一个）
 */
export interface BbInjectorOutcome {
  ok: boolean;
  reason?: string;
}