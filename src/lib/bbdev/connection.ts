/**
 * bbdev/connection.ts — bbdev MCP 连接管理
 *
 * 把 buckyball 项目自带的 MCP 服务注册到 McpConnectionManager。
 * 服务端：buckyball 仓库根下的 `scripts/claude/run_mcp_server.sh`
 *         （内部：nix develop -c python3 bbdev/mcp/__main__.py）
 *
 * 平台差异：
 * - macOS / Linux：直接通过 stdio 启动 bash 脚本
 * - Windows：bash 脚本路径需要 Git Bash / WSL；否则建议走 remote 模式
 *
 * 本文件只负责组装 MCPServerConfig，不启动连接。连接由 McpConnectionManager
 * 调用 syncMcpConnections() 时统一管理生命周期。
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import type { MCPServerConfig } from '@/types';
import { getSetting } from '@/lib/db';
import type {
  BbdevConnectionConfig,
  BbdevConnectionState,
} from './types';

export const BBDEV_MCP_SERVER_NAME = 'bbdev';

/**
 * 默认启动脚本（buckyball 仓库标准布局）
 */
export const DEFAULT_BBDEV_MCP_SCRIPT = 'scripts/claude/run_mcp_server.sh';

/**
 * 检测当前平台是否支持本地 bbdev（需要 bash + nix 或脚本中指定的执行环境）
 */
export function canRunLocalBbdev(): { supported: boolean; reason?: string } {
  if (process.platform === 'win32') {
    return {
      supported: false,
      reason: 'Windows 本地 bbdev 需要 Git Bash / WSL；建议先在 macOS / Linux 上跑，或配置远程 bbdev 服务',
    };
  }
  return { supported: true };
}

/**
 * 从配置组装 MCPServerConfig。
 *
 * - local 模式：stdio，command=bash，args=[<scriptPath>]
 * - remote 模式：sse，url=<remoteUrl>，headers.Authorization=<token>（Phase 2+）
 *
 * repoRoot 校验：脚本路径必须真实存在，否则返回 null（上层不注册）。
 */
export function buildBbdevMcpServerConfig(
  config: BbdevConnectionConfig,
): MCPServerConfig | null {
  if (config.mode === 'remote') {
    if (!config.remoteUrl) return null;
    const headers: Record<string, string> = {};
    if (config.remoteToken) {
      headers.Authorization = `Bearer ${config.remoteToken}`;
    }
    return {
      type: 'sse',
      url: config.remoteUrl,
      headers,
      enabled: true,
    };
  }

  // local
  const repoRoot = config.repoRoot?.trim();
  if (!repoRoot) return null;
  if (!fs.existsSync(repoRoot)) return null;

  const scriptRel = config.mcpScriptPath?.trim() || DEFAULT_BBDEV_MCP_SCRIPT;
  const scriptAbs = path.isAbsolute(scriptRel)
    ? scriptRel
    : path.join(repoRoot, scriptRel);
  if (!fs.existsSync(scriptAbs)) return null;

  if (process.platform === 'win32') {
    // Windows 走 Git Bash（CodePilot 默认携带）；用户也可手动改 command
    return {
      command: 'bash',
      args: [scriptAbs],
      env: {
        // 让脚本能从任意 cwd 启动
        BUCKYBALL_REPO_ROOT: repoRoot,
      },
      type: 'stdio',
      enabled: true,
    };
  }

  return {
    command: 'bash',
    args: [scriptAbs],
    env: {
      NIX_QUIET: '1',
      BUCKYBALL_REPO_ROOT: repoRoot,
    },
    type: 'stdio',
    enabled: true,
  };
}

/**
 * 解析存储在 SettingsMap 中的 bbdev 配置 JSON
 */
export function parseBbdevConnectionConfig(raw: string | undefined): BbdevConnectionConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return normalizeBbdevConnectionConfig(parsed as Partial<BbdevConnectionConfig>);
  } catch {
    return null;
  }
}

export function normalizeBbdevConnectionConfig(
  raw: Partial<BbdevConnectionConfig>,
): BbdevConnectionConfig {
  return {
    mode: raw.mode === 'remote' ? 'remote' : 'local',
    repoRoot: raw.repoRoot?.trim() || '',
    mcpScriptPath: raw.mcpScriptPath?.trim() || undefined,
    chipName: raw.chipName?.trim() || 'toy',
    balldomain: raw.balldomain?.trim() || undefined,
    remoteUrl: raw.remoteUrl?.trim() || undefined,
    remoteToken: raw.remoteToken?.trim() || undefined,
    autoStartLocal: raw.autoStartLocal !== false,
  };
}

/**
 * 默认配置（首次启动时用）
 */
export function defaultBbdevConnectionConfig(): BbdevConnectionConfig {
  return {
    mode: 'local',
    repoRoot: '',
    mcpScriptPath: DEFAULT_BBDEV_MCP_SCRIPT,
    chipName: 'toy',
    balldomain: undefined,
    remoteUrl: '',
    remoteToken: '',
    autoStartLocal: true,
  };
}

/**
 * 把 BbdevConnectionConfig 序列化到 SettingsMap
 */
export function serializeBbdevConnectionConfig(config: BbdevConnectionConfig): string {
  return JSON.stringify(config);
}

/**
 * 探测本地默认 repoRoot（macOS/Linux 常见的开发路径）
 * 不会自动写入配置，只用于 UI 默认值。
 */
export function detectDefaultRepoRoot(): string {
  // 优先级：
  // 1. ~/buckyball
  // 2. ~/work/buckyball
  // 3. ~/code/buckyball
  // 4. ~/projects/buckyball
  const home = os.homedir();
  const candidates = ['buckyball', 'work/buckyball', 'code/buckyball', 'projects/buckyball'];
  for (const c of candidates) {
    const p = path.join(home, c);
    if (fs.existsSync(p) && fs.existsSync(path.join(p, 'bbdev', 'mcp'))) {
      return p;
    }
  }
  return '';
}

/**
 * 读取 SettingsMap 中的 bbdev 配置，返回 MCPServerConfig。
 * 返回 null 表示 bbdev 未配置（不注册）。
 */
export function getBbdevMcpServerConfig(): MCPServerConfig | null {
  const raw = getSetting('bbdev_connection');
  const config = parseBbdevConnectionConfig(raw);
  if (!config) return null;
  // 跳过未启用
  if (!config.autoStartLocal && config.mode === 'local') return null;
  return buildBbdevMcpServerConfig(config);
}

/**
 * 把 McpConnectionManager 的状态聚合成 BbdevConnectionState
 * （给 UI / sidebar 用）
 */
export function aggregateBbdevState(
  mcpStatus: Record<string, { status: string; tools: number; error?: string }>,
  config: BbdevConnectionConfig,
): BbdevConnectionState {
  const entry = mcpStatus[BBDEV_MCP_SERVER_NAME];
  const connected = entry?.status === 'connected';
  return {
    connected,
    serverName: BBDEV_MCP_SERVER_NAME,
    mode: config.mode,
    toolCount: entry?.tools ?? 0,
    error: connected ? undefined : entry?.error,
  };
}
