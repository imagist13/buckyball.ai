/**
 * GET  /api/bbdev/config  — 读取 bbdev 连接配置
 * POST /api/bbdev/config  — 更新配置（写 SettingsMap + 触发 Skill 重新注册）
 *
 * 设计原则：
 * - GET 返回 normalize 后的结构，UI 可以直接渲染
 * - POST 走同一个 SettingsMap key `bbdev_connection`，原子写入
 * - 写入成功后调用 applyBbSkillRegistration() 重写 SKILL.md
 *   （refresh 路径：内容相同则跳过写盘，由 skill-injector 内置 diff 保护）
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

const ConfigSchema = z.object({
  mode: z.enum(['local', 'remote']).default('local'),
  repoRoot: z.string().default(''),
  mcpScriptPath: z.string().optional(),
  chipName: z.string().default('toy'),
  balldomain: z.string().optional(),
  remoteUrl: z.string().optional(),
  remoteToken: z.string().optional(),
  autoStartLocal: z.boolean().default(true),
});

export async function GET() {
  try {
    const { getSetting } = await import('@/lib/db');
    const { parseBbdevConnectionConfig, defaultBbdevConnectionConfig } = await import('@/lib/bbdev/connection');

    const raw = getSetting('bbdev_connection');
    const config = parseBbdevConnectionConfig(raw) ?? defaultBbdevConnectionConfig();
    return NextResponse.json({ config });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = ConfigSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid config', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { setSetting } = await import('@/lib/db');
    const { serializeBbdevConnectionConfig } = await import('@/lib/bbdev/connection');
    const { refreshBbdevSkill, isBbdevSkillRegistered, registerBbdevSkill } = await import('@/lib/bbdev/skill-registry');
    const { bbContextStore } = await import('@/lib/bbagent/context-store');
    const fs = await import('fs');

    const config = parsed.data;

    // repoRoot 必须存在（如果指定）
    if (config.repoRoot && !fs.existsSync(config.repoRoot)) {
      return NextResponse.json(
        { error: `repoRoot does not exist: ${config.repoRoot}` },
        { status: 400 },
      );
    }

    // 写 SettingsMap
    setSetting('bbdev_connection', serializeBbdevConnectionConfig(config));

    // 更新 context-store（供三 Runtime 注入层读取）
    bbContextStore.set({
      chip: config.chipName,
      balldomain: config.balldomain,
      repoRoot: config.repoRoot,
      remoteUrl: config.mode === 'remote' ? config.remoteUrl : undefined,
    });

    // 触发 Skill 重写
    let skillRefreshed = false;
    if (config.repoRoot) {
      try {
        if (isBbdevSkillRegistered(config.repoRoot)) {
          skillRefreshed = refreshBbdevSkill(config);
        } else {
          registerBbdevSkill(config);
          skillRefreshed = true;
        }
      } catch (err) {
        // Skill 写盘失败不阻塞配置写入
        console.warn('[bbdev/config] skill refresh failed:', err);
      }
    }

    return NextResponse.json({ config, skillRefreshed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
