/**
 * bbagent/context-store.ts — 全局 BbContext 单例
 *
 * chip 选择 / 远程 URL 由用户在 Settings / bbdev Panel 设置，
 * 全局保存供三 Runtime 注入层（mcp-injector / skill-injector / prompt-injector）读取。
 *
 * 注入器不直接依赖 Settings 持久化层；只读这个单例。
 * bbdev Panel / Settings 页面负责 set / clear。
 */

import type { BbContext } from './types';

type Listener = (ctx: BbContext | null) => void;

class BbContextStore {
  private ctx: BbContext | null = null;
  private listeners = new Set<Listener>();

  /** 当前 context；可能为 null（用户未设置） */
  get(): BbContext | null {
    return this.ctx;
  }

  /**
   * 读取 context；未设置时尝试从 bbdev 连接配置推断 fallback。
   *
   * 失败返回 null——这是注入器降级到普通 chat 模式的入口点。
   */
  getOrFallback(): BbContext | null {
    if (this.ctx) return this.ctx;
    return inferContextFromBbdevConfig();
  }

  set(ctx: BbContext): void {
    this.ctx = ctx;
    for (const l of this.listeners) l(ctx);
  }

  clear(): void {
    this.ctx = null;
    for (const l of this.listeners) l(null);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/**
 * 兜底推断：从 bbdev 连接配置里读 repoRoot/chipName/balldomain/remoteUrl。
 *
 * 延后 import 避免循环依赖（bbdev/connection 也可能用 bbagent/types）。
 * 失败/未配置都返回 null，注入器收到 null 时跳过 BB 注入。
 */
function inferContextFromBbdevConfig(): BbContext | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../bbdev/connection') as {
      getBbdevMcpServerConfig?: () => {
        repoRoot?: string;
        chipName?: string;
        balldomain?: string;
        mode?: 'local' | 'remote';
        remoteUrl?: string;
      } | null;
    };
    const cfg = mod.getBbdevMcpServerConfig?.();
    if (!cfg?.repoRoot) return null;
    return {
      chip: cfg.chipName || 'toy',
      balldomain: cfg.balldomain,
      repoRoot: cfg.repoRoot,
      remoteUrl: cfg.mode === 'remote' ? cfg.remoteUrl : undefined,
    };
  } catch {
    return null;
  }
}

/** 全局单例 */
export const bbContextStore = new BbContextStore();