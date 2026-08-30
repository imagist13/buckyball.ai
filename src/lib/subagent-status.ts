export type SubagentExecutionStatus =
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

/**
 * Internal persistence phase. `settling` deliberately remains separate from
 * the user-visible execution status: the child model has stopped producing
 * output, but CodePilot has not yet durably committed the result/provenance.
 */
export type SubagentRunPhase = 'running' | 'settling' | 'terminal';

/**
 * App-owned dispatch state. Unlike `status`, this distinguishes an accepted
 * workflow node that is waiting for dependencies from a child Runtime that is
 * already executing.
 */
export type SubagentDispatchState =
  | 'queued'
  | 'executing'
  | 'settling'
  | 'terminal';

export type SubagentStatusErrorCode =
  | 'AUTH_FORBIDDEN'
  | 'ENTITLEMENT'
  | 'RATE_LIMITED'
  | 'MODEL_UNAVAILABLE'
  | 'ROUTE_MISMATCH'
  | 'LOGICAL_RUN_STILL_RUNNING'
  | 'LOGICAL_RUN_ALREADY_COMPLETED'
  | 'INVALID_SUBAGENT_SPEC'
  | 'INVALID_DEPENDENCY_SPEC'
  | 'DEPENDENCY_DECLARATION_REQUIRED'
  | 'DEPENDENCY_NOT_FOUND'
  | 'DEPENDENCY_TIMEOUT'
  | 'DEPENDENCY_FAILED'
  | 'DUPLICATE_TASK_KEY'
  | 'CAPABILITY_UNAVAILABLE'
  | 'CONCURRENCY_LIMIT'
  | 'TIMEOUT'
  | 'MAX_TURNS'
  | 'MAX_BUDGET'
  | 'RUNTIME_ERROR'
  | 'EMPTY_RESULT';

export interface SubagentStatusError {
  code: SubagentStatusErrorCode;
  httpStatus?: number;
  retryable?: boolean;
}

export interface DelegatedAgentSource {
  title?: string;
  uri?: string;
  trust: 'external' | 'workspace' | 'runtime';
}

export interface DelegatedAgentArtifact {
  kind: string;
  pathOrId: string;
  persisted: boolean;
}

export interface DelegatedAgentWarning {
  code: string;
  message: string;
}

export interface DelegatedAgentUsage {
  requests?: number;
  inputTokens?: number;
  outputTokens?: number;
  toolCalls?: number;
  costUsd?: number;
}

export interface DelegatedAgentProvenance {
  logicalRunId: string;
  attemptId: string;
  attemptNumber: number;
  requestedProviderId?: string;
  requestedModel?: string;
  effectiveProviderId?: string;
  effectiveModel?: string;
  factSource: 'sqlite.subagent_runs';
}

/**
 * App-authored child result. Models may contribute `summary`, but route,
 * trust, artifact persistence and run identity are filled by CodePilot.
 */
export interface DelegatedAgentResult {
  status: Exclude<SubagentExecutionStatus, 'running'>;
  summary?: string;
  error?: SubagentStatusError;
  sources: DelegatedAgentSource[];
  artifacts: DelegatedAgentArtifact[];
  warnings: DelegatedAgentWarning[];
  usage?: DelegatedAgentUsage;
  provenance: DelegatedAgentProvenance;
}

export type SubagentLifecycleEventType =
  | 'started'
  | 'activity'
  | 'tool_started'
  | 'tool_completed'
  | 'permission_requested'
  | 'permission_resolved'
  | 'partial_result'
  | 'settling'
  | 'terminal'
  | 'route_warning';

export interface SubagentStatusMetadata {
  status: SubagentExecutionStatus;
  phase?: SubagentRunPhase;
  /** Legacy alias for attemptId, retained for existing transcripts. */
  taskId?: string;
  logicalRunId?: string;
  attemptId?: string;
  attemptNumber?: number;
  agentName?: string;
  requestedProviderId?: string;
  requestedModel?: string;
  effectiveProviderId?: string;
  effectiveModel?: string;
  /** Legacy display-model field. Prefer effectiveModel/requestedModel. */
  model?: string;
  runtime?: 'codepilot_runtime' | 'claude_code' | 'codex_runtime';
  currentActivity?: string;
  error?: SubagentStatusError;
}

const STATUS_PREFIX = '__CODEPILOT_SUBAGENT_STATUS__';
const LIFECYCLE_PREFIX = '__CODEPILOT_SUBAGENT_LIFECYCLE__';

/** Encode an SDK lifecycle event into the existing last-wins tool_result wire. */
export function encodeSubagentStatusResult(
  metadata: SubagentStatusMetadata,
  body = '',
): string {
  const terminal = metadata.status !== 'running';
  const lifecycle = terminal
    ? 'TERMINAL: the child has stopped; no background run remains. Consume this result now.'
    : 'RUNNING: this is a progress/launch receipt, not task completion.';
  return `${STATUS_PREFIX}${JSON.stringify({
    ...metadata,
    terminal,
  })}\n${LIFECYCLE_PREFIX}${lifecycle}\n${body}`;
}

export function parseSubagentStatusResult(result: string | undefined): {
  metadata?: SubagentStatusMetadata;
  body?: string;
} {
  if (!result?.startsWith(STATUS_PREFIX)) return { body: result };
  const newline = result.indexOf('\n');
  const raw = result.slice(STATUS_PREFIX.length, newline === -1 ? undefined : newline);
  try {
    const parsed = JSON.parse(raw) as Partial<SubagentStatusMetadata>;
    if (!isExecutionStatus(parsed.status)) return { body: result };
    const encodedBody = newline === -1 ? '' : result.slice(newline + 1);
    const lifecycleEnd = encodedBody.indexOf('\n');
    const body = encodedBody.startsWith(LIFECYCLE_PREFIX)
      ? lifecycleEnd === -1 ? '' : encodedBody.slice(lifecycleEnd + 1)
      : encodedBody;
    return {
      metadata: {
        status: parsed.status,
        ...(isRunPhase(parsed.phase) ? { phase: parsed.phase } : {}),
        ...(typeof parsed.taskId === 'string' ? { taskId: parsed.taskId } : {}),
        ...(typeof parsed.logicalRunId === 'string' ? { logicalRunId: parsed.logicalRunId } : {}),
        ...(typeof parsed.attemptId === 'string' ? { attemptId: parsed.attemptId } : {}),
        ...(Number.isSafeInteger(parsed.attemptNumber) && Number(parsed.attemptNumber) > 0
          ? { attemptNumber: Number(parsed.attemptNumber) }
          : {}),
        ...(typeof parsed.agentName === 'string' ? { agentName: parsed.agentName } : {}),
        ...(typeof parsed.requestedProviderId === 'string'
          ? { requestedProviderId: parsed.requestedProviderId }
          : {}),
        ...(typeof parsed.requestedModel === 'string' ? { requestedModel: parsed.requestedModel } : {}),
        ...(typeof parsed.effectiveProviderId === 'string'
          ? { effectiveProviderId: parsed.effectiveProviderId }
          : {}),
        ...(typeof parsed.effectiveModel === 'string' ? { effectiveModel: parsed.effectiveModel } : {}),
        ...(typeof parsed.model === 'string' ? { model: parsed.model } : {}),
        ...(isRuntime(parsed.runtime) ? { runtime: parsed.runtime } : {}),
        ...(typeof parsed.currentActivity === 'string'
          ? { currentActivity: parsed.currentActivity }
          : {}),
        ...(isStatusError(parsed.error) ? { error: parsed.error } : {}),
      },
      body,
    };
  } catch {
    return { body: result };
  }
}

/** Claude AgentOutput returns this receipt before a background child finishes. */
export function isAsyncSubagentLaunchResult(result: string | undefined): boolean {
  if (!result) return false;
  const normalized = result.toLowerCase();
  if (/async[_\s-]*launched|launched successfully|running in (?:the )?background|background (?:agent|task).*(?:launched|started|running)/i.test(result)) {
    return true;
  }
  try {
    const parsed = JSON.parse(result) as { status?: unknown };
    return typeof parsed.status === 'string'
      && ['async_launched', 'running', 'in_progress'].includes(parsed.status.toLowerCase());
  } catch {
    return normalized.includes('"status":"async_launched"')
      || normalized.includes('"status": "async_launched"');
  }
}

function isExecutionStatus(value: unknown): value is SubagentExecutionStatus {
  return value === 'running'
    || value === 'completed'
    || value === 'partial'
    || value === 'failed'
    || value === 'cancelled'
    || value === 'timed_out';
}

function isRuntime(value: unknown): value is NonNullable<SubagentStatusMetadata['runtime']> {
  return value === 'codepilot_runtime' || value === 'claude_code' || value === 'codex_runtime';
}

function isRunPhase(value: unknown): value is SubagentRunPhase {
  return value === 'running' || value === 'settling' || value === 'terminal';
}

function isStatusError(value: unknown): value is SubagentStatusError {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SubagentStatusError>;
  if (!isStatusErrorCode(candidate.code)) return false;
  if (candidate.httpStatus !== undefined && !Number.isInteger(candidate.httpStatus)) return false;
  return candidate.retryable === undefined || typeof candidate.retryable === 'boolean';
}

function isStatusErrorCode(value: unknown): value is SubagentStatusErrorCode {
  return value === 'AUTH_FORBIDDEN'
    || value === 'ENTITLEMENT'
    || value === 'RATE_LIMITED'
    || value === 'MODEL_UNAVAILABLE'
    || value === 'ROUTE_MISMATCH'
    || value === 'LOGICAL_RUN_STILL_RUNNING'
    || value === 'LOGICAL_RUN_ALREADY_COMPLETED'
    || value === 'INVALID_SUBAGENT_SPEC'
    || value === 'INVALID_DEPENDENCY_SPEC'
    || value === 'DEPENDENCY_DECLARATION_REQUIRED'
    || value === 'DEPENDENCY_NOT_FOUND'
    || value === 'DEPENDENCY_TIMEOUT'
    || value === 'DEPENDENCY_FAILED'
    || value === 'DUPLICATE_TASK_KEY'
    || value === 'CAPABILITY_UNAVAILABLE'
    || value === 'CONCURRENCY_LIMIT'
    || value === 'TIMEOUT'
    || value === 'MAX_TURNS'
    || value === 'MAX_BUDGET'
    || value === 'RUNTIME_ERROR'
    || value === 'EMPTY_RESULT';
}
