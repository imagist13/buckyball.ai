'use client';

import { SubagentModelIcon } from '@/components/chat/SubagentModelIcon';
import { useTranslation } from '@/hooks/useTranslation';
import type { AgentRunTab } from '@/lib/workspace-sidebar';
import type { TranslationKey } from '@/i18n';

export function AgentRunPanel({ tab }: { tab: AgentRunTab }) {
  const { t } = useTranslation();
  const { run } = tab;
  const model = run.effectiveModel || run.requestedModel;
  const result = run.structuredResult;
  const requestedRoute = routeLabel(run.requestedProviderId, run.requestedModel);
  const effectiveRoute = routeLabel(run.effectiveProviderId, run.effectiveModel);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-agent-run-panel>
      <header className="shrink-0 border-b border-border/60 px-4 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <SubagentModelIcon model={model} size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-foreground">{run.agentName}</h2>
            <p className="text-xs text-muted-foreground">
              {run.phase === 'settling'
                ? t('subagent.phase.settling' as TranslationKey)
                : t(`subagent.status.${run.status}` as TranslationKey)}
            </p>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {requestedRoute && (
            <>
              <dt className="text-muted-foreground">{t('subagent.details.requestedRoute' as TranslationKey)}</dt>
              <dd className="truncate text-foreground" title={requestedRoute}>{requestedRoute}</dd>
            </>
          )}
          <dt className="text-muted-foreground">{t('subagent.details.effectiveRoute' as TranslationKey)}</dt>
          <dd className="truncate text-foreground" title={effectiveRoute}>
            {effectiveRoute || t('subagent.model.unknown' as TranslationKey)}
          </dd>
          {run.runtime && (
            <>
              <dt className="text-muted-foreground">{t('subagent.details.runtime' as TranslationKey)}</dt>
              <dd className="text-foreground">{runtimeLabel(run.runtime)}</dd>
            </>
          )}
          {run.workflowId && (
            <>
              <dt className="text-muted-foreground">{t('subagent.details.workflow' as TranslationKey)}</dt>
              <dd className="truncate font-mono text-[11px] text-foreground" title={run.workflowId}>
                {run.workflowId}
              </dd>
            </>
          )}
          {run.taskKey && (
            <>
              <dt className="text-muted-foreground">{t('subagent.details.taskKey' as TranslationKey)}</dt>
              <dd className="truncate font-mono text-[11px] text-foreground" title={run.taskKey}>
                {run.taskKey}
              </dd>
            </>
          )}
          {run.dependencyTaskKeys.length > 0 && (
            <>
              <dt className="text-muted-foreground">{t('subagent.details.dependsOn' as TranslationKey)}</dt>
              <dd className="text-foreground">{run.dependencyTaskKeys.join(', ')}</dd>
            </>
          )}
          <dt className="text-muted-foreground">{t('subagent.details.logicalRunId' as TranslationKey)}</dt>
          <dd className="truncate font-mono text-[11px] text-foreground" title={run.id}>{run.id}</dd>
          <dt className="text-muted-foreground">{t('subagent.details.attemptId' as TranslationKey)}</dt>
          <dd className="truncate font-mono text-[11px] text-foreground" title={run.attemptId}>
            {run.attemptId}
          </dd>
          {run.currentActivity && (
            <>
              <dt className="text-muted-foreground">{t('subagent.details.activity' as TranslationKey)}</dt>
              <dd className="text-foreground">{run.currentActivity}</dd>
            </>
          )}
        </dl>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <TranscriptSection title={t('subagent.details.task' as TranslationKey)} text={run.prompt} />
        <TranscriptSection
          title={t('subagent.details.result' as TranslationKey)}
          text={run.result || t('subagent.details.waiting' as TranslationKey)}
          muted={!run.result}
        />
        {(result?.error || run.error) && (
          <TranscriptSection
            title={t('subagent.details.error' as TranslationKey)}
            text={formatError(result?.error || run.error!)}
          />
        )}
        {result?.warnings && result.warnings.length > 0 && (
          <ListSection
            title={t('subagent.details.warnings' as TranslationKey)}
            items={result.warnings.map(warning => `${warning.code}: ${warning.message}`)}
          />
        )}
        {result?.sources && result.sources.length > 0 && (
          <ListSection
            title={t('subagent.details.sources' as TranslationKey)}
            items={result.sources.map(source => [
              source.title,
              source.uri,
              source.trust,
            ].filter(Boolean).join(' · '))}
          />
        )}
        {result?.artifacts && result.artifacts.length > 0 && (
          <ListSection
            title={t('subagent.details.artifacts' as TranslationKey)}
            items={result.artifacts.map(artifact => (
              `${artifact.kind}: ${artifact.pathOrId}${artifact.persisted ? '' : ` (${t('subagent.details.notPersisted' as TranslationKey)})`}`
            ))}
          />
        )}
        {result?.usage && (
          <UsageSection
            title={t('subagent.details.usage' as TranslationKey)}
            usage={result.usage}
            label={(key) => t(`subagent.details.usage.${key}` as TranslationKey)}
          />
        )}
        {run.attempts && run.attempts.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('subagent.details.attempts' as TranslationKey)} · {run.attempts.length}
            </h3>
            <div className="space-y-2">
              {run.attempts.map(attempt => (
                <div key={attempt.id} className="rounded-lg border border-border/60 bg-card p-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">
                      {t('subagent.details.attemptNumber' as TranslationKey, { number: attempt.attemptNumber })}
                    </span>
                    <span className="text-muted-foreground">
                      {attempt.dispatchState === 'queued'
                        ? t('subagent.status.queued' as TranslationKey)
                        : attempt.phase === 'settling'
                        ? t('subagent.phase.settling' as TranslationKey)
                        : t(`subagent.status.${attempt.status}` as TranslationKey)}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={attempt.id}>
                    {attempt.id}
                  </div>
                  {(attempt.effectiveModel || attempt.requestedModel) && (
                    <div className="mt-1 text-muted-foreground">
                      {routeLabel(
                        attempt.effectiveProviderId || attempt.providerId,
                        attempt.effectiveModel || attempt.requestedModel,
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        {run.lifecycleEvents && run.lifecycleEvents.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('subagent.details.lifecycle' as TranslationKey)}
            </h3>
            <ol className="space-y-3 border-l border-border pl-3">
              {run.lifecycleEvents.map(event => (
                <li key={event.id} className="text-xs">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {t(`subagent.event.${event.type}` as TranslationKey)}
                    </span>
                    <time className="text-[10px] text-muted-foreground">
                      {formatEventTime(event.updatedAt)}
                    </time>
                  </div>
                  {(event.activity || event.toolName) && (
                    <p className="mt-0.5 text-muted-foreground">
                      {[event.activity, event.toolName].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}

function routeLabel(provider?: string, model?: string): string | undefined {
  if (!provider && !model) return undefined;
  return [provider, model].filter(Boolean).join(' / ');
}

function formatEventTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}

function formatError(error: { code: string; httpStatus?: number; retryable?: boolean }): string {
  return [
    error.code,
    typeof error.httpStatus === 'number' ? `HTTP ${error.httpStatus}` : undefined,
    typeof error.retryable === 'boolean' ? `retryable=${String(error.retryable)}` : undefined,
  ].filter(Boolean).join(' · ');
}

function runtimeLabel(runtime: NonNullable<AgentRunTab['run']['runtime']>): string {
  if (runtime === 'codepilot_runtime') return 'CodePilot Runtime';
  if (runtime === 'claude_code') return 'Claude Code Runtime';
  return 'Codex Runtime';
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul className="space-y-1 rounded-lg border border-border/60 bg-card p-3 text-xs text-foreground">
        {items.map((item, index) => <li key={`${index}:${item}`} className="break-words">• {item}</li>)}
      </ul>
    </section>
  );
}

function UsageSection({
  title,
  usage,
  label,
}: {
  title: string;
  usage: NonNullable<AgentRunTab['run']['structuredResult']>['usage'];
  label: (key: 'requests' | 'inputTokens' | 'outputTokens' | 'toolCalls' | 'costUsd') => string;
}) {
  if (!usage) return null;
  const entries = ([
    ['requests', usage.requests],
    ['inputTokens', usage.inputTokens],
    ['outputTokens', usage.outputTokens],
    ['toolCalls', usage.toolCalls],
    ['costUsd', usage.costUsd],
  ] as const).filter((entry): entry is [typeof entry[0], number] => typeof entry[1] === 'number');
  if (entries.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-card p-3 text-xs">
        {entries.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{label(key)}</dt>
            <dd className="text-right text-foreground">{key === 'costUsd' ? `$${value}` : value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function TranscriptSection({ title, text, muted = false }: { title: string; text: string; muted?: boolean }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <pre className={`whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-card p-3 font-sans text-xs leading-5 ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>
        {text}
      </pre>
    </section>
  );
}
