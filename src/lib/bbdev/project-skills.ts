/**
 * bbdev/project-skills.ts — 解析 buckyball 项目级 Skills 的发现根
 *
 * buckyball 仓库下挂着一组项目级 Skills（ball / ball-align / check /
 * chip-designer / debug / optimize / verify / waveform 等），位于
 * `<repoRoot>/.claude/skills/<name>/SKILL.md`。这些 Skills 不一定位于 chat
 * session 的 working directory 下；当 chat session 的 cwd 不在 buckyball 仓库
 * 根时，CodePilot 必须把 `<repoRoot>` 当作 fallback 目录，否则用户在前端
 * 选了 `/ball` 等 skill 后 `/api/chat` 会以 422 失败。
 *
 * 实现：buckyball 仓库根 = `bbdev_connection` setting 中的 `repoRoot` 字段。
 * 这样既复用了 settings 里已有的配置（用户已经在 bbdev 设置面板里填过），
 * 又避免引入新的 `buckyball_connection` setting。后续若需要拆分，再独立
 * 一个 setting；现阶段保持单一来源。
 *
 * 本文件只导出纯函数 + 一个带动态 require 的 helper，方便单元测试覆盖。
 */

import fs from 'fs';
import path from 'path';

const BBDEV_CONNECTION_SETTING_KEY = 'bbdev_connection';

/**
 * 解析 buckyball 仓库根路径：从 `bbdev_connection` setting 中读 `repoRoot`。
 * 未配置 / 路径不存在时返回 undefined，调用方应静默退化为「无 fallback」。
 *
 * 用 dynamic require 避免把 db 模块硬拉到 skill resolver 路径上（与
 * selected-skill-injection.ts 现有的 require('./db') 模式一致）。
 */
export function getBuckyballRepoRoot(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getSetting } = require('./../db') as { getSetting?: (key: string) => string | undefined };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { parseBbdevConnectionConfig } = require('./connection') as {
      parseBbdevConnectionConfig?: (raw: string | undefined) => { repoRoot?: string } | null;
    };
    const raw = getSetting?.(BBDEV_CONNECTION_SETTING_KEY);
    console.log(`[bbdev/project-skills] bbdev_connection raw=${raw === undefined ? 'undefined' : `"${raw.slice(0, 200)}"`}`);
    const config = parseBbdevConnectionConfig?.(raw);
    const repoRoot = config?.repoRoot?.trim();
    if (!repoRoot) {
      console.log('[bbdev/project-skills] repoRoot is empty after parsing; buckyball fallback disabled');
      return undefined;
    }
    if (!fs.existsSync(repoRoot)) {
      console.log(`[bbdev/project-skills] repoRoot does not exist on disk: ${repoRoot}; buckyball fallback disabled`);
      return undefined;
    }
    console.log(`[bbdev/project-skills] resolved buckyball repoRoot=${repoRoot}`);
    return repoRoot;
  } catch (error) {
    console.log(`[bbdev/project-skills] exception while resolving repoRoot: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * 返回 buckyball 项目级 skills 目录的绝对路径。
 * 仅用于在 list 路径下扫描；调用方应自行判断 cwd 与 repoRoot 关系后再扫。
 */
export function getBuckyballProjectSkillsDir(repoRoot: string): string {
  return path.join(repoRoot, '.claude', 'skills');
}
