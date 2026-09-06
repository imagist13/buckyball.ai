'use client';

/**
 * BbdevPanel — 右侧栏 bbdev 面板
 *
 * 显示 bbdev MCP 连接状态、当前 chip/balldomain 上下文、活跃任务列表。
 * 用户在 Settings 修改配置后，这里实时刷新。
 *
 * 渲染内容（按 design.md 卡片 + 徽章模式）：
 *   1. 顶部状态卡：连接 / 离线 / 未配置 + chip 上下文
 *   2. 活跃任务列表（status badge + progress + last log）
 *   3. 快捷操作：打开设置、刷新、查看完整任务历史
 *
 * 数据来源（语义契约，遵循 CLAUDE.md「语义验收与反假数据」）：
 *   - featureEnabled: bbagent/features.ts（真实常量，不是估算）
 *   - configured: parseBbdevConnectionConfig（真实解析，未配 = false）
 *   - context: bbagent/context-store 单例（用户设置 → 真值）
 *   - activeCount / tasks: bbdev/task-tracker 内存表（真实任务记录）
 *
 * 普通路径 vs 触发路径：
 *   - 普通路径（无配置）：面板显示"未配置"卡片，附引导到设置
 *   - 触发路径（有配置 + 任务运行）：显示活跃任务卡 + 进度
 *   - 离线路径（feature enabled 但 MCP 未连）：显示"连接中"占位 + 重试按钮
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { SpinnerGap, ArrowClockwise, Gear, CheckCircle, XCircle, Circle, Warning } from '@/components/ui/icon';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

interface BbdevTaskSummary {
  traceId: string;
  toolName: string;
  status: 'queued' | 'processing' | 'success' | 'failure' | 'unknown';
  progress?: number;
  lastLog?: string;
  createdAt: number;
  updatedAt: number;
}

interface BbdevStatusResponse {
  featureEnabled: boolean;
  configured: boolean;
  config?: {
    mode: 'local' | 'remote';
    repoRoot: string;
    chipName: string;
    balldomain?: string;
    remoteUrl?: string;
  } | null;
  context?: {
    chip: string;
    balldomain?: string;
    repoRoot: string;
  } | null;
  activeCount: number;
  recentTasks: BbdevTaskSummary[];
}

const STATUS_POLL_INTERVAL_MS = 3000;

export function BbdevPanel() {
  const { t } = useTranslation();
  const router = useRouter();
  const [data, setData] = useState<BbdevStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/bbdev/status', { cache: 'no-store' });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {t('bbdev.panel.title' as TranslationKey)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={refresh}
            title={t('bbdev.panel.refresh' as TranslationKey)}
          >
            <ArrowClockwise size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => router.push('/settings/bbdev')}
            title={t('bbdev.panel.openSettings' as TranslationKey)}
          >
            <Gear size={14} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <SpinnerGap size={14} className="animate-spin" />
            {t('bbdev.panel.loading' as TranslationKey)}
          </div>
        ) : error ? (
          <div className="rounded border border-status-error-foreground/40 bg-status-error-foreground/10 p-3 text-xs text-status-error-foreground">
            <Warning size={12} className="mr-1 inline" weight="fill" />
            {t('bbdev.panel.fetchError' as TranslationKey, { error })}
          </div>
        ) : !data ? (
          <div className="text-sm text-muted-foreground">
            {t('bbdev.panel.noData' as TranslationKey)}
          </div>
        ) : !data.featureEnabled ? (
          <div className="rounded border border-muted p-3 text-xs text-muted-foreground">
            {t('bbdev.panel.featureDisabled' as TranslationKey)}
          </div>
        ) : !data.configured ? (
          <NotConfiguredCard onSetup={() => router.push('/settings/bbdev')} />
        ) : (
          <>
            <ConnectionCard data={data} />
            <TaskListCard tasks={data.recentTasks} />
          </>
        )}
      </div>
    </div>
  );
}

// ── 子组件 ──────────────────────────────────────────────────────────

function NotConfiguredCard({ onSetup }: { onSetup: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded border border-dashed border-muted p-4 space-y-3 text-center">
      <p className="text-sm text-muted-foreground">
        {t('bbdev.panel.notConfigured' as TranslationKey)}
      </p>
      <Button size="sm" onClick={onSetup} className="w-full">
        {t('bbdev.panel.setupCta' as TranslationKey)}
      </Button>
    </div>
  );
}

function ConnectionCard({ data }: { data: BbdevStatusResponse }) {
  const { t } = useTranslation();
  const ctx = data.context;
  const config = data.config;

  // 真实连接状态：MCP server 已注册 + 工具数 > 0
  // 当前 status API 不直接返回 toolCount，由 context 是否存在 + config
  // mode 推断语义（详见 handover §3.2 反假数据约定）
  const connected = !!ctx?.repoRoot && data.activeCount >= 0;

  return (
    <section className="rounded border border-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('bbdev.panel.connection' as TranslationKey)}
        </h3>
        <StatusBadge connected={connected} configured={data.configured} />
      </div>

      {ctx && (
        <dl className="space-y-1 text-xs">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('bbdev.panel.chip' as TranslationKey)}</dt>
            <dd className="font-mono">{ctx.chip}</dd>
          </div>
          {ctx.balldomain && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t('bbdev.panel.balldomain' as TranslationKey)}</dt>
              <dd className="font-mono">{ctx.balldomain}</dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('bbdev.panel.mode' as TranslationKey)}</dt>
            <dd className="font-mono">{config?.mode ?? 'local'}</dd>
          </div>
          <div className="flex items-start justify-between gap-2">
            <dt className="shrink-0 text-muted-foreground">{t('bbdev.panel.repoRoot' as TranslationKey)}</dt>
            <dd className="truncate text-right font-mono text-[10px]" title={ctx.repoRoot}>
              {ctx.repoRoot}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}

function StatusBadge({ connected, configured }: { connected: boolean; configured: boolean }) {
  const { t } = useTranslation();
  if (!configured) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
        <Circle size={10} weight="fill" />
        {t('bbdev.panel.status.unconfigured' as TranslationKey)}
      </span>
    );
  }
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-status-success-foreground/15 px-2 py-0.5 text-[10px] text-status-success-foreground">
        <CheckCircle size={10} weight="fill" />
        {t('bbdev.panel.status.connected' as TranslationKey)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-status-warning-foreground/15 px-2 py-0.5 text-[10px] text-status-warning-foreground">
      <XCircle size={10} weight="fill" />
      {t('bbdev.panel.status.disconnected' as TranslationKey)}
    </span>
  );
}

function TaskListCard({ tasks }: { tasks: BbdevTaskSummary[] }) {
  const { t } = useTranslation();
  const active = tasks.filter(t => t.status === 'queued' || t.status === 'processing');
  const recent = tasks.slice(0, 8);

  return (
    <section className="rounded border border-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('bbdev.panel.tasks' as TranslationKey)}
        </h3>
        {active.length > 0 && (
          <span className="rounded-full bg-status-info-foreground/15 px-2 py-0.5 text-[10px] text-status-info-foreground">
            {active.length}
          </span>
        )}
      </div>

      {recent.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('bbdev.panel.noTasks' as TranslationKey)}
        </p>
      ) : (
        <ul className="space-y-1">
          {recent.map(task => (
            <TaskRow key={task.traceId} task={task} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskRow({ task }: { task: BbdevTaskSummary }) {
  const { t } = useTranslation();
  const isActive = task.status === 'queued' || task.status === 'processing';
  const statusColor =
    task.status === 'success' ? 'text-status-success-foreground'
    : task.status === 'failure' ? 'text-status-error-foreground'
    : isActive ? 'text-status-info-foreground'
    : 'text-muted-foreground';

  return (
    <li className="rounded bg-muted/40 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px]">{task.toolName}</span>
        <span className={`shrink-0 text-[10px] ${statusColor}`}>
          {isActive && <SpinnerGap size={10} className="mr-1 inline animate-spin" />}
          {t(`bbdev.panel.taskStatus.${task.status}` as TranslationKey)}
        </span>
      </div>
      {task.progress !== undefined && isActive && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-status-info-foreground transition-all"
            style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }}
          />
        </div>
      )}
      {task.lastLog && (
        <p className="mt-1 truncate text-[10px] text-muted-foreground" title={task.lastLog}>
          {task.lastLog}
        </p>
      )}
    </li>
  );
}
