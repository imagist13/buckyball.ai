/**
 * GET /api/bbdev/tasks
 *
 * 返回 bbdev 活跃 + 最近任务列表（按 updatedAt 倒序）。
 * 给 BbdevPanel 任务列表渲染用。
 *
 * Query params:
 *   - limit: 最多返回几个（默认 50）
 *   - activeOnly: 只返回活跃任务（默认 false）
 */

import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200);
    const activeOnly = searchParams.get('activeOnly') === 'true';

    const { bbdevTaskTracker } = await import('@/lib/bbdev/task-tracker');

    const tasks = activeOnly
      ? bbdevTaskTracker.getActiveTasks().slice(0, limit)
      : bbdevTaskTracker.getRecentTasks(limit);

    return NextResponse.json({
      tasks: tasks.map(t => ({
        traceId: t.traceId,
        toolName: t.toolName,
        args: t.args,
        chip: t.chip,
        status: t.status,
        progress: t.progress,
        logCount: t.logs.length,
        lastLog: t.logs.length > 0 ? t.logs[t.logs.length - 1] : undefined,
        result: t.result,
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
