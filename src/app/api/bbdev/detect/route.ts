/**
 * GET /api/bbdev/detect
 *
 * 探测本机默认 buckyball 仓库根目录（macOS / Linux 常见路径）。
 * 不会自动写入配置，只用于 BbdevSettings "检测默认值" 按钮。
 */

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { detectDefaultRepoRoot } = await import('@/lib/bbdev/connection');
    const repoRoot = detectDefaultRepoRoot();
    return NextResponse.json({ repoRoot });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
