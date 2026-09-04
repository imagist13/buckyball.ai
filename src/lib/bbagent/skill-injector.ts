/**
 * bbagent/skill-injector.ts — bbdev Skill 注入层
 *
 * 把 bbdev Skill 写入目标 repo 的 .claude/skills/bbdev/ + .agents/skills/bbdev/，
 * 并在 skill-registry 刷新后触发 skill-discovery 缓存失效。
 *
 * 设计原则（与 mcp-injector 对齐）：
 * - Skill 注入是幂等写盘操作，失败只打 console.error 不阻塞 Runtime
 * - Skill 注册在 bbdev 连接建立后自动触发（repoRoot 已确认存在）
 * - 用户在 Settings 改了 chip/balldomain → refreshBbdevSkill() 增量更新
 * - Skill 反注册在 bbdev 连接断开时调用
 *
 * 注入失败语义（与 handover §5 一致）：
 * - App 启动：警告但不阻塞，fork 路径降级为"无法使用 bbdev skill"
 * - Native / Claude / Codex：Skill 不存在 → 模型走普通 chat，错误路径
 *   （不同于 MCP 注入的"bbdev 工具不可用"），这是 Skill 系统 vs MCP 工具的语义差异
 */

import type { BbRuntimeKind, BbInjectorOutcome } from './types';
import { isBbdevEnabled } from './features';
import { bbContextStore } from './context-store';
import {
  registerBbdevSkill,
  unregisterBbdevSkill,
  refreshBbdevSkill,
  isBbdevSkillRegistered,
} from '../bbdev/skill-registry';
import type { BbdevConnectionConfig } from '../bbdev/types';

/**
 * 获取当前注入配置所需的 repoRoot（来自 context-store 或 bbdev 连接配置）
 */
function getRepoRoot(): string {
  const ctx = bbContextStore.getOrFallback();
  return ctx?.repoRoot ?? '';
}

// ── 注入操作 ────────────────────────────────────────────────────

/**
 * 注入 bbdev Skill（写盘 + invalidate）
 *
 * 幂等：refreshBbdevSkill 对比内容，相同则跳过写盘。
 * 失败打 console.error，不抛错（Skill 不存在不影响 Runtime 继续运行）。
 */
export function injectBbdevSkill(): BbInjectorOutcome {
  if (!isBbdevEnabled()) {
    return { ok: true, reason: 'bbdev feature disabled' };
  }

  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    return { ok: false, reason: 'repoRoot not configured — bbdev skill not injected' };
  }

  try {
    // 动态 import 避免循环依赖（bbdev/connection 导入本模块的场景）
    const { parseBbdevConnectionConfig } = require('../bbdev/connection') as {
      parseBbdevConnectionConfig?: (raw?: string) => BbdevConnectionConfig | null;
    };
    const { getSetting } = require('../db') as {
      getSetting?: (key: string) => string | undefined;
    };

    let config: BbdevConnectionConfig = {
      mode: 'local',
      repoRoot,
      chipName: 'toy',
      autoStartLocal: true,
    };

    // 尝试从 SettingsMap 读取 chipName / balldomain
    if (parseBbdevConnectionConfig && getSetting) {
      const raw = getSetting('bbdev_connection');
      const parsed = parseBbdevConnectionConfig(raw);
      if (parsed) {
        config = { ...config, ...parsed };
      }
    }

    const changed = refreshBbdevSkill(config);
    if (!changed) {
      return { ok: true, reason: 'skill content unchanged — no write' };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `skill injection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 反注册 bbdev Skill（删除 SKILL.md + invalidate）
 */
export function ejectBbdevSkill(): BbInjectorOutcome {
  if (!isBbdevEnabled()) return { ok: true, reason: 'bbdev feature disabled' };

  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    return { ok: true, reason: 'repoRoot not configured — nothing to eject' };
  }

  try {
    unregisterBbdevSkill(repoRoot);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `skill eject failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 刷新 bbdev Skill（当用户在 Settings 改了 chip/balldomain 时调用）
 * 对比内容，相同则跳过写盘。
 */
export function refreshBbdevSkillInjection(): BbInjectorOutcome {
  return injectBbdevSkill();
}

// ── Runtime 分发（占位）──────────────────────────────────────────

/**
 * Native Runtime：Skill 在 repo 目录写盘后由 skill-discovery 自动扫描。
 * agent-loop 通过 getSkill('bbdev') 发现 Skill，skill-executor 走 fork 模式。
 * 本函数目前是 no-op 预留，未来可扩展 Native 的 skill-in-memory 注入。
 */
export function injectSkillIntoNative(): BbInjectorOutcome {
  if (!isBbdevEnabled()) return { ok: true, reason: 'bbdev feature disabled' };
  // Skill 已经在写盘阶段完成注入；Native Runtime 通过 skill-discovery 读盘发现
  return { ok: true, reason: 'skill injected at registration time' };
}

/**
 * Claude Code Runtime：Skill 写盘后由 Claude Code SDK 扫描 .claude/skills/ 自动发现。
 * 无需额外操作。
 */
export function injectSkillIntoClaude(): BbInjectorOutcome {
  if (!isBbdevEnabled()) return { ok: true, reason: 'bbdev feature disabled' };
  // Claude Code SDK 启动时扫描 .claude/skills/ — SKILL.md 已在 injectBbdevSkill() 写盘
  return { ok: true, reason: 'skill injected at registration time' };
}

/**
 * Codex Runtime：Skill 写盘后由 Codex 扫描 .agents/skills/ 自动发现。
 * 无需额外操作。
 */
export function injectSkillIntoCodex(): BbInjectorOutcome {
  if (!isBbdevEnabled()) return { ok: true, reason: 'bbdev feature disabled' };
  // Codex 启动时扫描 .agents/skills/ — SKILL.md 已在 injectBbdevSkill() 写盘
  return { ok: true, reason: 'skill injected at registration time' };
}

// ── 顶层入口 ────────────────────────────────────────────────────

/**
 * 按 runtime 分发 Skill 注入
 */
export function applyBbSkillInjection(runtime: BbRuntimeKind): BbInjectorOutcome {
  switch (runtime) {
    case 'native':
      return injectSkillIntoNative();
    case 'claude_code':
      return injectSkillIntoClaude();
    case 'codex':
      return injectSkillIntoCodex();
    default:
      return { ok: false, reason: `unknown runtime: ${runtime}` };
  }
}

/**
 * 统一入口：同时注入 MCP + Skill + Prompt（三注入点聚合）
 *
 * Skill 和 MCP 的注册在 repoRoot 确定后触发一次；
 * Prompt 注入在每次 agent-loop 启动时实时拼装。
 * 本函数只负责 Skill（和 MCP 由 applyBbMcpInjection 负责，Prompt 在 agent-loop 内部拼）。
 *
 * 调用时机（对应 Phase 4.7）：
 * - App 启动后，bbdev 连接配置就绪 → injectBbdevSkill()
 * - 用户在 Settings 改了 chip/balldomain → refreshBbdevSkillInjection()
 * - bbdev 连接断开 / repoRoot 变空 → ejectBbdevSkill()
 */
export function applyBbSkillRegistration(): BbInjectorOutcome {
  return injectBbdevSkill();
}

/**
 * 检查 bbdev Skill 当前是否已注册
 */
export function isBbdevSkillInjected(): boolean {
  const repoRoot = getRepoRoot();
  if (!repoRoot) return false;
  return isBbdevSkillRegistered(repoRoot);
}
