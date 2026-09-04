/**
 * bbdev/skill-registry.ts — 注册/反注册 bbdev SkillDefinition
 *
 * Skill 生成 → 写盘 → invalidateSkillCache → skill-discovery 重新扫描
 *
 * 写盘位置：<repoRoot>/.claude/skills/bbdev/SKILL.md
 * skill-discovery 通过 name dedup（同名 Skill 合并），所以多个 repo 里的 bbdev Skill
 * 会被视为同一个（按 name 匹配），但 filePath 不同。真正的多 chip 隔离靠
 * SKILL.md 里的 chip/balldomain 上下文字符串实现。
 */

import path from 'path';
import fs from 'fs';
import {
  generateBbdevSkillDefinition,
  renderBbdevSkillMarkdown,
  BBDEV_SKILL_NAME,
  BBDEV_SKILL_FILENAME,
} from './skill-generator';
import type { BbdevConnectionConfig } from './types';
import { invalidateSkillCache } from '../skill-discovery';

const CLAUDE_SKILL_DIR = '.claude';
const CODEX_SKILL_DIR = '.agents';
const SKILLS_SUBDIR = 'skills';

/**
 * SKILL.md 写盘位置清单。
 * - `.claude/skills/bbdev/SKILL.md` — Claude Code / Native Runtime
 * - `.agents/skills/bbdev/SKILL.md` — Codex / 通用 agents 兼容
 *
 * 两份内容相同，由 Claude Code 与 Codex 各自读取。
 */
const SKILL_WRITE_LOCATIONS = [
  path.join(CLAUDE_SKILL_DIR, SKILLS_SUBDIR),
  path.join(CODEX_SKILL_DIR, SKILLS_SUBDIR),
] as const;

// ── 写盘 ────────────────────────────────────────────────────────

/**
 * 把 bbdev SKILL.md 同时写到 <repoRoot>/.claude/skills/bbdev/ 和
 * <repoRoot>/.agents/skills/bbdev/，返回写入路径列表。
 */
function writeSkillMarkdown(repoRoot: string, config: BbdevConnectionConfig): string[] {
  const markdown = renderBbdevSkillMarkdown(config);
  const written: string[] = [];

  for (const subdir of SKILL_WRITE_LOCATIONS) {
    const skillDir = path.join(repoRoot, subdir, BBDEV_SKILL_NAME);
    const skillFile = path.join(skillDir, BBDEV_SKILL_FILENAME);

    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }

    fs.writeFileSync(skillFile, markdown, 'utf-8');
    written.push(skillFile);
  }

  return written;
}

/**
 * 删除所有位置上的 bbdev SKILL.md（如果存在）
 */
function removeSkillMarkdown(repoRoot: string): string[] {
  const removed: string[] = [];

  for (const subdir of SKILL_WRITE_LOCATIONS) {
    const skillFile = path.join(repoRoot, subdir, BBDEV_SKILL_NAME, BBDEV_SKILL_FILENAME);
    if (fs.existsSync(skillFile)) {
      fs.unlinkSync(skillFile);
      removed.push(skillFile);
    }
    // 尝试删除空目录（忽略错误）
    try {
      const skillDir = path.join(repoRoot, subdir, BBDEV_SKILL_NAME);
      if (fs.existsSync(skillDir) && fs.readdirSync(skillDir).length === 0) {
        fs.rmdirSync(skillDir);
      }
    } catch { /* ignore */ }
    try {
      const skillsDir = path.join(repoRoot, subdir);
      if (fs.existsSync(skillsDir) && fs.readdirSync(skillsDir).length === 0) {
        fs.rmdirSync(skillsDir);
      }
    } catch { /* ignore */ }
  }

  return removed;
}

// ── 公共 API ────────────────────────────────────────────────────

/**
 * 注册 bbdev Skill（生成 + 写盘 + 刷新缓存）
 *
 * 幂等：重复调用会覆盖旧的 SKILL.md（chip/balldomain 更新后需要重新注册）。
 *
 * @param config  当前 bbdev 连接配置（决定 chip/balldomain 上下文）
 * @returns 注册后的 SkillDefinition 对象（可用于调试或测试）
 */
export function registerBbdevSkill(config: BbdevConnectionConfig): {
  skillFiles: string[];
  definition: ReturnType<typeof generateBbdevSkillDefinition>;
} {
  const repoRoot = config.repoRoot?.trim();
  if (!repoRoot) {
    throw new Error('[bbdev/skill-registry] repoRoot is required to register bbdev skill');
  }
  if (!fs.existsSync(repoRoot)) {
    throw new Error(`[bbdev/skill-registry] repoRoot does not exist: ${repoRoot}`);
  }

  const skillFiles = writeSkillMarkdown(repoRoot, config);
  invalidateSkillCache();

  const definition = generateBbdevSkillDefinition(config);

  console.log(`[bbdev/skill-registry] Registered bbdev skill at ${skillFiles.join(', ')}`);
  return { skillFiles, definition };
}

/**
 * 反注册 bbdev Skill（删除 SKILL.md + 刷新缓存）
 *
 * @param repoRoot  buckyball 仓库根目录
 */
export function unregisterBbdevSkill(repoRoot: string): void {
  const root = repoRoot?.trim() || '';
  if (!root) return;

  removeSkillMarkdown(root);
  invalidateSkillCache();

  console.log(`[bbdev/skill-registry] Unregistered bbdev skill from ${root}`);
}

/**
 * 检查 bbdev Skill 是否已注册（任一位置 SKILL.md 文件存在）
 *
 * @param repoRoot  buckyball 仓库根目录
 */
export function isBbdevSkillRegistered(repoRoot: string): boolean {
  const root = repoRoot?.trim() || '';
  if (!root) return false;
  return SKILL_WRITE_LOCATIONS.some(subdir =>
    fs.existsSync(path.join(root, subdir, BBDEV_SKILL_NAME, BBDEV_SKILL_FILENAME)),
  );
}

/**
 * 读取已注册的 bbdev SKILL.md 内容（任一位置，用于比对 chip/balldomain 是否变化）
 *
 * @param repoRoot  buckyball 仓库根目录
 * @returns 文件内容，不存在返回 null
 */
export function readBbdevSkillMarkdown(repoRoot: string): string | null {
  const root = repoRoot?.trim() || '';
  if (!root) return null;
  for (const subdir of SKILL_WRITE_LOCATIONS) {
    const skillFile = path.join(root, subdir, BBDEV_SKILL_NAME, BBDEV_SKILL_FILENAME);
    if (fs.existsSync(skillFile)) {
      try {
        return fs.readFileSync(skillFile, 'utf-8');
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * 强制重新注册（对比现有内容，有变化才写盘 + invalidate）
 * 用于 bbdev 配置变更后增量刷新。
 *
 * @param config  当前 bbdev 连接配置
 * @returns true 表示发生了写盘，false 表示内容相同无需更新
 */
export function refreshBbdevSkill(config: BbdevConnectionConfig): boolean {
  const repoRoot = config.repoRoot?.trim();
  if (!repoRoot) return false;

  const newMarkdown = renderBbdevSkillMarkdown(config);
  const existingMarkdown = readBbdevSkillMarkdown(repoRoot);

  if (existingMarkdown === newMarkdown) {
    return false; // 内容相同，无需刷新
  }

  registerBbdevSkill(config);
  return true;
}
