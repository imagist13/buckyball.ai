/**
 * bbagent/prompt-injector.ts — Native Runtime 的 BB system prompt fragment
 *
 * 把当前 bbdev 上下文（chip / balldomain / 工具可用性）拼到 system prompt 上，
 * 让 Native Runtime 的模型第一次知道自己在哪个 chip 工作、能用哪些工具。
 *
 * 设计要点：
 * - 短小（≤ 200 tokens）；超过会浪费上下文窗口
 * - 条件注入：bbdev 关闭 / repoRoot 为空 → 不拼（不引入假 0 / unsupported 文本）
 * - 来源清晰：每段都有 source breadcrumb（来自 context-store / bbdev_connection）
 * - 不重复 SKILL.md body（避免重复注入）
 * - Claude Code / Codex Runtime 各自 SDK 有自己的 system prompt 机制，不走本模块
 *
 * 注入点：Native Runtime 的 agent-loop.ts 在 effectiveSystemPrompt 拼装时调用。
 * Phase 4.7 改造点就在那里加一行。
 */

import type { BbInjectorOutcome } from './types';
import { isBbdevEnabled } from './features';
import { bbContextStore } from './context-store';
import { BBDEV_MCP_SERVER_NAME } from '../bbdev/connection';

const PROMPT_FRAGMENT_HEADER = `[buckyball.ai bbdev context]`;

/**
 * 构建 BB system prompt fragment
 *
 * 返回：
 * - `null` — bbdev 关闭 / 未配置 → 不注入（普通 chat 模式）
 * - `string` — 拼到 system prompt 末尾（agent-loop 内已有 [filter(Boolean).join('\n\n')] 处理）
 *
 * 故意不返回空字符串：返回 null 是显式信号，让 agent-loop 区分
 * "没注入" vs "注入了但内容为空"。
 */
export function buildBbPromptFragment(): string | null {
  if (!isBbdevEnabled()) return null;

  const ctx = bbContextStore.getOrFallback();
  if (!ctx) return null;
  if (!ctx.repoRoot) return null;

  const chipLine = `Current chip: **${ctx.chip}**`;
  const balldomainLine = ctx.balldomain ? `\nActive balldomain: \`${ctx.balldomain}\`` : '';
  const modeLine = ctx.remoteUrl
    ? `\nMode: remote bbdev server at \`${ctx.remoteUrl}\``
    : `\nMode: local bbdev (repo at \`${ctx.repoRoot}\`)`;
  const toolsLine = `\nAvailable MCP server: \`${BBDEV_MCP_SERVER_NAME}\` (validate, compiler, workloads, BEMU / Verilator / VCS / UVM sim, Yosys / DC synth, FireSim, kernel build)`;

  const submitPollRule =
    `\n\nAll \`mcp__${BBDEV_MCP_SERVER_NAME}__*\` tools are submit-and-poll: ` +
    `the call returns a \`trace_id\`, then poll \`mcp__${BBDEV_MCP_SERVER_NAME}__bbdev_task_status\` ` +
    `until it reports success/failure. The synchronous exception is \`validate\`, which returns its verdict inline.`;

  const skillHint =
    `\n\nFor complex multi-step hardware operations, use the \`bbdev\` skill (fork sub-agent) ` +
    `so the parent chat context stays clean.`;

  return [
    PROMPT_FRAGMENT_HEADER,
    chipLine + balldomainLine,
    modeLine,
    toolsLine,
    submitPollRule,
    skillHint,
  ].join('');
}

/**
 * Injector 形态的入口（与 mcp-injector / skill-injector 形态对齐）
 */
export function injectBbPrompt(): BbInjectorOutcome {
  if (!isBbdevEnabled()) return { ok: true, reason: 'bbdev feature disabled' };
  // 实际拼装在 agent-loop 里（buildBbPromptFragment 返回 string 由调用方拼到 systemPrompt）
  // 这里只验证 context 是否就绪
  const ctx = bbContextStore.getOrFallback();
  if (!ctx) {
    return { ok: false, reason: 'bbdev context unavailable — prompt fragment skipped' };
  }
  if (!ctx.repoRoot) {
    return { ok: false, reason: 'repoRoot missing — prompt fragment skipped' };
  }
  return { ok: true };
}

/**
 * 给 agent-loop 用的便捷入口：直接返回拼好的 fragment，null 表示不注入
 *
 * 这是 Native Runtime 改造点的接口：
 * ```ts
 * const fragment = getBbPromptFragmentForAgentLoop();
 * if (fragment) {
 *   effectiveSystemPrompt = [effectiveSystemPrompt, fragment].filter(Boolean).join('\n\n');
 * }
 * ```
 */
export function getBbPromptFragmentForAgentLoop(): string | null {
  return buildBbPromptFragment();
}
