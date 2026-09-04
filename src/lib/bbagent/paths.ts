/**
 * bbagent/paths.ts — buckyball.ai 持久化路径单一来源
 *
 * 替代 src/lib/codepilot-data-dir.ts 的实际工作；
 * 旧函数 `resolveCodePilotDataDir` 保留为薄壳（兼容两个 release 再删）。
 *
 * 旧 env `CLAUDE_GUI_DATA_DIR` 在本模块仍兼容，但新代码必须用 `BUCKYBALL_DATA_DIR`。
 */

import os from 'node:os';
import path from 'node:path';

export interface BbPathEnv {
  BUCKYBALL_DATA_DIR?: string;
  /** 旧 env，仅作兼容；优先度低于 BUCKYBALL_DATA_DIR */
  CLAUDE_GUI_DATA_DIR?: string;
}

/**
 * 解析 buckyball 数据根目录
 *
 * 优先级：
 *   1. BUCKYBALL_DATA_DIR（新，优先）
 *   2. CLAUDE_GUI_DATA_DIR（旧，兼容）
 *   3. ~/.codepilot（旧版默认，保持向后兼容）
 *
 * Phase 6A：默认路径仍是 `~/.codepilot`，避免破坏既有用户。
 * Phase 6B：迁移脚本就位后，默认值改为 `~/.buckyball`，并自动
 * 把 `~/.codepilot/` 一次性迁过去。详见执行计划 Phase 6.5。
 */
export function resolveBuckyballDataDir(
  env: BbPathEnv = process.env as BbPathEnv,
  homeDirectory: string = os.homedir(),
): string {
  const configured =
    env.BUCKYBALL_DATA_DIR?.trim() || env.CLAUDE_GUI_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(homeDirectory, '.codepilot');
}

/**
 * 媒体目录（旧 `~/.codepilot/.codepilot-media/` → `~/.buckyball/.buckyball-media/`）
 */
export function resolveBuckyballMediaDir(
  env?: BbPathEnv,
  home?: string,
): string {
  return path.join(resolveBuckyballDataDir(env, home), '.buckyball-media');
}

/**
 * 日志目录（旧 `~/.codepilot/logs/` → `~/.buckyball/.buckyball-logs/`）
 */
export function resolveBuckyballLogsDir(
  env?: BbPathEnv,
  home?: string,
): string {
  return path.join(resolveBuckyballDataDir(env, home), '.buckyball-logs');
}

/**
 * 个人助手目录（保留路径但默认不 seed）
 *
 * 旧 `~/.codepilot/.assistant/` → `~/.buckyball/.assistant/`
 */
export function resolveBuckyballAssistantDir(
  env?: BbPathEnv,
  home?: string,
): string {
  return path.join(resolveBuckyballDataDir(env, home), '.assistant');
}

/**
 * 旧 CodePilot 数据目录（仅作迁移 / 兼容判断，不用于新写）
 */
export function resolveLegacyCodePilotDataDir(
  env: BbPathEnv = process.env as BbPathEnv,
  homeDirectory: string = os.homedir(),
): string {
  // 旧版 env 优先度高于新 env 的反回，避免破坏旧用户脚本
  const legacy = env.CLAUDE_GUI_DATA_DIR?.trim();
  return legacy ? path.resolve(legacy) : path.join(homeDirectory, '.codepilot');
}