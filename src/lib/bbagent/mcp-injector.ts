/**
 * bbagent/mcp-injector.ts — 三 Runtime 的 bbdev MCP 注入层
 *
 * 把 bbdev MCP 配置（来自 SettingsMap）按 runtime 注入到对应的 MCP 服务注册表。
 *
 * 设计原则：
 * - bbdev 是系统级注入（不依赖会话 mcpServers 配置），所以注入器总是尝试注入；
 *   若 SettingsMap 未配置或 feature flag 关闭则跳过，不影响普通会话
 * - 单点失败非阻塞：注入失败打 console.warn，不抛错（Runtime 仍能以普通 chat 模式运行）
 * - 注入器不感知 Runtime 内部细节；调用方提供要写入的容器
 *   （如 Native Runtime 的 serversToSync Record）
 *
 * 注入失败语义（与 handover §4 一致）：
 * - App 启动：警告但不阻塞，fork 路径降级为 prompt-only
 * - Native Runtime：UI 顶部 banner "bbdev 离线"（banner 由调用方负责），不影响 chat
 * - Claude / Codex：本模块预留接口，Runtime 改造点稍后接入
 */

import type { MCPServerConfig } from '@/types';
import { BBDEV_MCP_SERVER_NAME, getBbdevMcpServerConfig } from '../bbdev/connection';
import type {
  BbInjectConfig,
  BbInjectorOutcome,
  BbRuntimeKind,
} from './types';
import { isBbdevEnabled } from './features';

/**
 * Native Runtime 注入：把 bbdev 配置写入传入的 serversToSync 容器
 *
 * 调用方传 serversToSync（已经是 mcpServers 展开的 Record），注入器只追加 bbdev 一项。
 * 后续由 Runtime 调 syncMcpConnections(serversToSync) 完成实际连接。
 *
 * 注意：serversToSync 是可变对象（in-place 修改），避免重新分配让 Runtime 持有的引用
 * 与我们这里不同步。
 */
export function injectIntoNative(
  serversToSync: Record<string, MCPServerConfig>,
): BbInjectorOutcome {
  if (!isBbdevEnabled()) {
    return { ok: true, reason: 'bbdev feature disabled' };
  }
  try {
    const bbdevConfig = getBbdevMcpServerConfig();
    if (bbdevConfig) {
      serversToSync[BBDEV_MCP_SERVER_NAME] = bbdevConfig;
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `bbdev config read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Claude Code Runtime 注入：返回该会话要传给 Claude SDK 的 mcpServers map
 * （调用方负责把它写入 SDK options）
 *
 * 当前 Phase：接口已就位，claude-client.ts 改造点在 Phase 4.3.2 接入。
 */
export function injectIntoClaude(): BbInjectorOutcome {
  if (!isBbdevEnabled()) return { ok: true, reason: 'bbdev feature disabled' };
  // Phase 4.3.2：claude-client.ts 启动 fork 时调用，把 bbdev MCP 写入 session mcpServers
  return { ok: true, reason: 'pending Claude Runtime integration (Phase 4.3.2)' };
}

/**
 * Codex Runtime 注入：返回该 thread 要传给 turn/start 的 mcp_servers map
 *
 * 当前 Phase：接口已就位，codex/runtime.ts 改造点在 Phase 4.3.3 接入。
 */
export function injectIntoCodex(): BbInjectorOutcome {
  if (!isBbdevEnabled()) return { ok: true, reason: 'bbdev feature disabled' };
  // Phase 4.3.3：codex/runtime.ts turn/start 时 per-thread 注入
  return { ok: true, reason: 'pending Codex Runtime integration (Phase 4.3.3)' };
}

/**
 * 顶层入口：按 runtime 分发到对应的 MCP 注入器
 *
 * 调用方约定：
 * - Native: 提供 serversToSync Record，注入器原地追加 bbdev
 * - Claude / Codex: 调用方自行根据返回值（reason）决定是否降级
 */
export function applyBbMcpInjection(
  runtime: BbRuntimeKind,
  serversToSync?: Record<string, MCPServerConfig>,
): BbInjectorOutcome {
  switch (runtime) {
    case 'native':
      return injectIntoNative(serversToSync ?? {});
    case 'claude_code':
      return injectIntoClaude();
    case 'codex':
      return injectIntoCodex();
    default:
      return { ok: false, reason: `unknown runtime: ${runtime}` };
  }
}

/**
 * 兼容旧入口：bbagent 顶层统一接口，聚合 MCP 注入结果
 *
 * skill / prompt 注入器在其它文件实现；本模块只负责 MCP 注入。
 * 完整 applyBbInjection 在后续 Phase 4.7 聚合层（本文件可作为基础）。
 */
export function applyBbInjection(config: BbInjectConfig): {
  mcp: BbInjectorOutcome;
} {
  const mcp = applyBbMcpInjection(config.runtime);
  if (!mcp.ok) {
    console.warn(`[bbagent/mcp-injector] injection failed for ${config.runtime}: ${mcp.reason}`);
  }
  return { mcp };
}