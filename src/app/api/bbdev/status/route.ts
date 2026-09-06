/**
 * GET /api/bbdev/status
 *
 * 聚合 bbdev 连接状态 + 配置 + 活跃任务数。
 * 给 BbdevPanel 顶部状态卡片用。
 */

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { getSetting } = await import('@/lib/db');
    const { parseBbdevConnectionConfig } = await import('@/lib/bbdev/connection');
    const { bbdevTaskTracker } = await import('@/lib/bbdev/task-tracker');
    const { isBbdevEnabled } = await import('@/lib/bbagent/features');
    const { bbContextStore } = await import('@/lib/bbagent/context-store');

    const raw = getSetting('bbdev_connection');
    const config = parseBbdevConnectionConfig(raw);
    const ctx = bbContextStore.getOrFallback();
    const activeTasks = bbdevTaskTracker.getActiveTasks();
    const recentTasks = bbdevTaskTracker.getRecentTasks(20);

    return NextResponse.json({
      featureEnabled: isBbdevEnabled(),
      configured: !!config,
      config: config ?? null,
      context: ctx,
      activeCount: activeTasks.length,
      recentTasks: recentTasks.map(t => ({
        traceId: t.traceId,
        toolName: t.toolName,
        status: t.status,
        progress: t.progress,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
