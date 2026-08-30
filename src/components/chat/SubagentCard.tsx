'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CodePilotIcon } from '@/components/ui/semantic-icon';
import { SubagentModelIcon } from './SubagentModelIcon';
import { useTranslation } from '@/hooks/useTranslation';
import { useWorkspaceSidebarOptional } from '@/hooks/useWorkspaceSidebar';
import {
  agentRunTabFromView,
  buildSubagentRunView,
  mergeSubagentRunDetails,
  shouldDisplaySubagentRun,
  type SubagentDurableEvidence,
  type SubagentRunView,
} from '@/lib/subagent-view';
import {
  getSubagentDetailInitialProbeDelay,
  recordSubagentDetailProbeFailure,
  recordSubagentDetailProbeSuccess,
  SUBAGENT_DETAIL_FAST_RETRY_MS,
} from '@/lib/subagent-detail-probe';
import { cn } from '@/lib/utils';
import type { TranslationKey } from '@/i18n';
import type { SubagentRunDetailsResponse } from '@/types';

interface SubagentCardProps {
  run?: SubagentRunView;
  id?: string;
  name?: string;
  input?: unknown;
  result?: string;
  isError?: boolean;
  sessionId?: string;
}

export function SubagentCard(props: SubagentCardProps) {
  const { t } = useTranslation();
  const workspace = useWorkspaceSidebarOptional();
  const transcriptRun = useMemo(() => props.run || buildSubagentRunView({
    id: props.id || 'unknown-subagent-run',
    name: props.name || 'Agent',
    toolInput: props.input,
    result: props.result,
    isError: props.isError,
  }), [props.id, props.input, props.isError, props.name, props.result, props.run]);
  const [details, setDetails] = useState<SubagentRunDetailsResponse | undefined>();
  // A parsed transcript view is not durable evidence: production history and
  // streaming renderers always pass `run`. Managed tools become visible only
  // after the read-only details API proves that startSubagentRun committed.
  const [durableEvidence, setDurableEvidence] = useState<SubagentDurableEvidence>('unknown');
  const run = useMemo(
    () => details?.logicalRunId === transcriptRun.id
      ? mergeSubagentRunDetails(transcriptRun, details)
      : transcriptRun,
    [details, transcriptRun],
  );
  const tab = useMemo(() => agentRunTabFromView(run), [run]);

  useEffect(() => {
    if (!props.sessionId || !transcriptRun.id) return;
    const detailKey = `${props.sessionId}:${transcriptRun.id}`;
    let eventCursor = 0;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleNext = (
      delayMs = SUBAGENT_DETAIL_FAST_RETRY_MS,
      durableEvidenceProbe = false,
    ) => {
      if (
        !disposed
        && (
          durableEvidenceProbe
          || transcriptRun.status === 'running'
          || transcriptRun.status === 'queued'
        )
      ) {
        timer = setTimeout(load, delayMs);
      }
    };
    const load = async () => {
      try {
        const response = await fetch(
          `/api/chat/sessions/${encodeURIComponent(props.sessionId!)}/subagent-runs?logical_run_id=${encodeURIComponent(transcriptRun.id)}&after_cursor=${eventCursor}`,
          { cache: 'no-store' },
        );
        if (response.ok) {
          recordSubagentDetailProbeSuccess(detailKey);
          if (!disposed) setDurableEvidence('found');
          const next = await response.json() as SubagentRunDetailsResponse;
          if (!disposed) {
            eventCursor = Math.max(eventCursor, next.nextEventCursor);
            setDetails(previous => {
              if (!previous || previous.logicalRunId !== next.logicalRunId) return next;
              const eventsById = new Map(
                previous.events.map(event => [event.id, event]),
              );
              for (const event of next.events) eventsById.set(event.id, event);
              const events = [...eventsById.values()]
                .sort((left, right) => left.cursor - right.cursor)
                .slice(-200);
              return {
                ...next,
                nextEventCursor: Math.max(
                  previous.nextEventCursor,
                  next.nextEventCursor,
                ),
                events,
              };
            });
          }
          const latest = next.attempts[next.attempts.length - 1];
          if (!disposed && latest && !latest.terminal) {
            timer = setTimeout(load, SUBAGENT_DETAIL_FAST_RETRY_MS);
          }
        } else if (response.status === 404) {
          // A short spawn race is possible, but legacy/mismatched transcript
          // ids may never acquire a durable row. Probe quickly for a bounded
          // burst, then cool down instead of permanently giving up. This keeps
          // late durable commits recoverable without a 1 Hz request flood.
          const decision = recordSubagentDetailProbeFailure(detailKey, 'not_found');
          if (!disposed && decision.burstExhausted) {
            setDurableEvidence('missing');
          }
          if (transcriptRun.requiresDurableEvidence || !decision.burstExhausted) {
            scheduleNext(decision.delayMs, true);
          }
        } else {
          // A 5xx is not evidence that the durable row is absent. Keep managed
          // terminal receipts hidden but retry with the same bounded/cooldown
          // policy so a transient API failure cannot erase a real run until
          // the user refreshes the whole page.
          const decision = recordSubagentDetailProbeFailure(detailKey, 'transient');
          if (transcriptRun.requiresDurableEvidence || !decision.burstExhausted) {
            scheduleNext(decision.delayMs, true);
          }
        }
      } catch {
        const decision = recordSubagentDetailProbeFailure(detailKey, 'transient');
        if (transcriptRun.requiresDurableEvidence || !decision.burstExhausted) {
          scheduleNext(decision.delayMs, true);
        }
      }
    };
    const initialDelay = getSubagentDetailInitialProbeDelay(detailKey);
    if (initialDelay > 0) {
      timer = setTimeout(load, initialDelay);
    } else {
      void load();
    }
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    props.sessionId,
    transcriptRun.id,
    transcriptRun.requiresDurableEvidence,
    transcriptRun.status,
  ]);

  // If the user is already inspecting this run, keep its live transcript in
  // sync without stealing focus when they have switched to another tab.
  useEffect(() => {
    if (durableEvidence !== 'found' || workspace?.state.activeTabId !== tab.id) return;
    const existing = workspace.state.tabs.find(candidate => candidate.id === tab.id);
    if (!existing || existing.kind !== 'agent-run') return;
    if (
      existing.run.status !== tab.run.status
      || existing.run.phase !== tab.run.phase
      || existing.run.attemptId !== tab.run.attemptId
      || existing.run.attemptCount !== tab.run.attemptCount
      || existing.run.agentName !== tab.run.agentName
      || existing.run.result !== tab.run.result
      || existing.run.effectiveModel !== tab.run.effectiveModel
      || existing.run.currentActivity !== tab.run.currentActivity
      || existing.run.lifecycleEvents?.length !== tab.run.lifecycleEvents?.length
    ) {
      workspace.openTab(tab);
    }
  }, [durableEvidence, tab, workspace]);

  if (!shouldDisplaySubagentRun(transcriptRun, durableEvidence)) {
    return null;
  }

  const statusLabel = t(`subagent.status.${run.status}` as TranslationKey);
  const displayedModel = run.effectiveModel || run.requestedModel;
  const modelKind = run.effectiveModel ? 'effective' : 'requested';

  return (
    <section
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-card px-2 py-1 align-middle"
      aria-label={t('subagent.cardLabel' as TranslationKey, { name: run.agentName })}
      data-subagent-card
      data-subagent-status={run.status}
      data-subagent-logical-run-id={run.id}
      data-subagent-attempt-count={run.attemptCount}
      title={run.currentActivity}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-foreground">
        <SubagentModelIcon model={displayedModel} size={16} />
      </span>
      <span className="max-w-40 truncate text-xs font-medium text-foreground">{run.agentName}</span>
      {run.attemptCount > 1 && (
        <span className="shrink-0 text-[10px] text-muted-foreground">
          ×{run.attemptCount}
        </span>
      )}
      <span className={cn(
        'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
        statusClass(run.status),
      )}>
        {statusLabel}
      </span>
      {workspace && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-5 shrink-0 rounded-full px-1.5 text-[10px]"
          onClick={() => workspace.openTab(tab)}
          aria-label={t('subagent.openDetailsNamed' as TranslationKey, { name: run.agentName })}
        >
          <CodePilotIcon name="panel_right" size="sm" aria-hidden />
          {t('subagent.openDetails' as TranslationKey)}
        </Button>
      )}
      {displayedModel && (
        <span
          className="inline-flex max-w-36 shrink items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
          title={t(`subagent.model.${modelKind}` as TranslationKey)}
        >
          <span className="truncate">{displayedModel}</span>
        </span>
      )}
    </section>
  );
}

function statusClass(status: SubagentRunView['status']): string {
  if (status === 'completed') return 'border-status-success-border bg-status-success-muted text-status-success-foreground';
  if (status === 'partial') return 'border-status-warning-border bg-status-warning-muted text-status-warning-foreground';
  if (status === 'failed' || status === 'timed_out') return 'border-status-error-border bg-status-error-muted text-status-error-foreground';
  if (status === 'cancelled') return 'border-border bg-muted text-muted-foreground';
  return 'border-status-info-border bg-status-info-muted text-status-info-foreground';
}
