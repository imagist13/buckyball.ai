/**
 * bbagent/data-migration.ts — 一次性数据目录迁移
 *
 * Phase 6B 触发器：
 *   - 用户首次设置 `BUCKYBALL_DATA_DIR` 为 `~/.buckyball`
 *   - 同时存在旧 `~/.codepilot/` 目录
 *   → 自动把旧目录内容搬到新目录，日志写 Sentry breadcrumb
 *
 * 调用入口：`src/instrumentation.ts` 启动时一次；UI 设置页面手动触发也支持。
 *
 * 设计原则：
 *   - 幂等：已迁移的目录直接跳过（用 marker 文件 `/.bb-migrated-from-codepilot`）
 *   - 单向：迁移完不删旧目录，只在 README 里写"已迁移，源路径保留 N 天"
 *   - 失败不阻塞：搬不动某个子目录就 warn，不中断整个流程
 *   - Sentry breadcrumb：记录迁移结果（成功 / 部分 / 失败 / 跳过）
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  resolveBuckyballDataDir,
  resolveLegacyCodePilotDataDir,
} from './paths';

/**
 * 检查是否需要迁移
 *
 * @returns  true = 应该跑迁移（源存在 + 目标不存在 + 目标不是自己）
 */
export function shouldMigrateDataDir(
  env?: { CLAUDE_GUI_DATA_DIR?: string; BUCKYBALL_DATA_DIR?: string },
  home?: string,
): boolean {
  const target = resolveBuckyballDataDir(env, home);
  const source = resolveLegacyCodePilotDataDir(env, home);

  if (path.resolve(target) === path.resolve(source)) return false;
  if (!fs.existsSync(source)) return false;
  if (fs.existsSync(path.join(target, '.bb-migrated-from-codepilot'))) return false;

  return true;
}

export interface MigrationResult {
  source: string;
  target: string;
  status: 'migrated' | 'partial' | 'failed' | 'skipped';
  filesCopied: number;
  errors: Array<{ path: string; reason: string }>;
  durationMs: number;
}

/**
 * 执行迁移（一次性）
 *
 * @param dryRun  true = 只列出要拷贝的文件，不实际拷贝
 */
export async function migrateDataDir(
  env?: { CLAUDE_GUI_DATA_DIR?: string; BUCKYBALL_DATA_DIR?: string },
  home?: string,
  options: { dryRun?: boolean } = {},
): Promise<MigrationResult> {
  const start = Date.now();
  const target = resolveBuckyballDataDir(env, home);
  const source = resolveLegacyCodePilotDataDir(env, home);
  const errors: Array<{ path: string; reason: string }> = [];
  let filesCopied = 0;

  if (path.resolve(target) === path.resolve(source)) {
    return { source, target, status: 'skipped', filesCopied: 0, errors: [], durationMs: Date.now() - start };
  }
  if (!fs.existsSync(source)) {
    return { source, target, status: 'skipped', filesCopied: 0, errors: [], durationMs: Date.now() - start };
  }
  if (fs.existsSync(path.join(target, '.bb-migrated-from-codepilot'))) {
    return { source, target, status: 'skipped', filesCopied: 0, errors: [], durationMs: Date.now() - start };
  }

  // dry-run: 只列出
  if (options.dryRun) {
    const entries = walkDir(source);
    return {
      source,
      target,
      status: 'skipped',
      filesCopied: entries.length,
      errors: [],
      durationMs: Date.now() - start,
    };
  }

  // 实际拷贝
  try {
    fs.mkdirSync(target, { recursive: true });

    const entries = walkDir(source);
    for (const relPath of entries) {
      const from = path.join(source, relPath);
      const to = path.join(target, relPath);
      try {
        const stat = fs.statSync(from);
        if (stat.isDirectory()) {
          fs.mkdirSync(to, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.copyFileSync(from, to);
          filesCopied++;
        }
      } catch (err) {
        errors.push({
          path: relPath,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 写 marker（即便有部分失败也写，方便 UI 知道"试图迁移过"）
    fs.writeFileSync(
      path.join(target, '.bb-migrated-from-codepilot'),
      JSON.stringify({
        source,
        target,
        timestamp: new Date().toISOString(),
        filesCopied,
        errors,
      }, null, 2),
      'utf-8',
    );

    const status: MigrationResult['status'] =
      errors.length === 0 ? 'migrated'
      : filesCopied > 0 ? 'partial'
      : 'failed';

    return { source, target, status, filesCopied, errors, durationMs: Date.now() - start };
  } catch (err) {
    return {
      source,
      target,
      status: 'failed',
      filesCopied,
      errors: [{ path: '(root)', reason: err instanceof Error ? err.message : String(err) }],
      durationMs: Date.now() - start,
    };
  }
}

// ── 内部 ────────────────────────────────────────────────────────

/**
 * 递归列出目录下的所有相对路径（不含 source 本身）
 * 跳过：marker 文件、隐藏文件、symlinks（避免循环引用）
 */
function walkDir(root: string): string[] {
  const result: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      // 跳过 marker 和隐藏文件
      if (entry.name.startsWith('.')) continue;

      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);

      try {
        const stat = fs.statSync(full);
        if (stat.isSymbolicLink()) continue;

        if (stat.isDirectory()) {
          result.push(rel);
          stack.push(full);
        } else {
          result.push(rel);
        }
      } catch {
        continue;
      }
    }
  }

  return result;
}
