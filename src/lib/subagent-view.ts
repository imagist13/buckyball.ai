import { dynamicTabId, type AgentRunTab } from './workspace-sidebar';
import {
  isAsyncSubagentLaunchResult,
  parseSubagentStatusResult,
  type DelegatedAgentResult,
  type SubagentDispatchState,
  type SubagentExecutionStatus,
  type SubagentRunPhase,
  type SubagentStatusError,
} from './subagent-status';
import type { SubagentRunDetailsResponse } from '@/types';

type SubagentIcon = 'search' | 'code' | 'task' | 'assistant';

export type SubagentRunStatus = SubagentExecutionStatus | 'queued';
export type SubagentDurableEvidence = 'unknown' | 'found' | 'missing';

export interface SubagentRunView {
  id: string;
  attemptId: string;
  attemptNumber: number;
  attemptCount: number;
  /**
   * Managed spawn tools promise an auditable durable run. Their transcript
   * receipt is not sufficient evidence that a child was accepted.
   */
  requiresDurableEvidence: boolean;
  agentName: string;
  prompt: string;
  requestedProviderId?: string;
  requestedModel?: string;
  effectiveProviderId?: string;
  effectiveModel?: string;
  workflowId?: string;
  taskKey?: string;
  dependencyTaskKeys: string[];
  runtime?: 'codepilot_runtime' | 'claude_code' | 'codex_runtime';
  status: SubagentRunStatus;
  phase: SubagentRunPhase;
  dispatchState: SubagentDispatchState;
  currentActivity?: string;
  lastActivityAt?: string;
  result?: string;
  structuredResult?: DelegatedAgentResult;
  attempts?: SubagentRunDetailsResponse['attempts'];
  lifecycleEvents?: SubagentRunDetailsResponse['events'];
  isError?: boolean;
  error?: SubagentStatusError;
  icon: SubagentIcon;
}

export function shouldDisplaySubagentRun(
  run: SubagentRunView,
  durableEvidence: SubagentDurableEvidence,
): boolean {
  return !run.requiresDurableEvidence || durableEvidence === 'found';
}

const SUBAGENT_TOOL_NAMES = new Set([
  'agent',
  'task',
  'codex_subagent',
  'collabagenttoolcall',
  'codepilot_spawn_subagent',
]);

export function isSubagentToolName(name: string): boolean {
  const lower = name.toLowerCase();
  return SUBAGENT_TOOL_NAMES.has(lower.replace(/[\s.-]/g, ''))
    || lower === 'codex_subagent'
    || lower.endsWith('__codepilot_spawn_subagent');
}

/**
 * Instance-level guard for legacy Codex transcripts. Older event-mapper
 * versions persisted every anonymous wait action with the `codex_subagent`
 * name, so checking the name alone revives bogus capsules after refresh.
 */
export function isSubagentToolCall(
  name: string,
  toolInput: unknown,
  result?: string,
): boolean {
  if (!isSubagentToolName(name)) return false;
  const lower = name.toLowerCase();
  if (lower !== 'codex_subagent' && lower !== 'collabagenttoolcall') return true;
  const input = asRecord(toolInput);
  if (input.type !== 'collabAgentToolCall') {
    // Preserve pre-collab legacy tool records whose input shape cannot be
    // identified as an app-server collaboration action.
    return true;
  }
  return parseCodexCollabFacts(input, result) !== undefined;
}

export function isManagedSubagentToolName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === 'codepilot_spawn_subagent'
    || lower.endsWith('__codepilot_spawn_subagent');
}

export function buildSubagentRunView(input: {
  id: string;
  name: string;
  toolInput: unknown;
  result?: string;
  isError?: boolean;
}): SubagentRunView {
  const args = asRecord(input.toolInput);
  const parsedResult = parseNativeResult(input.result);
  const codexCollab = input.name.toLowerCase() === 'codex_subagent'
    ? parseCodexCollabFacts(args, input.result)
    : undefined;
  const agentName = parsedResult.agentName || firstString(
    args.agent_name,
    args.agent,
    args.subagent_type,
    args.agent_type,
    args.agentName,
    args.name,
  ) || (input.name === 'codex_subagent' ? 'Codex worker' : 'Sub-agent');
  const requestedModel = normalizeModel(parsedResult.requestedModel || firstString(
    args.requested_model,
    codexCollab?.model,
    args.model,
    args.requestedModel,
    args.model_id,
  ));
  const prompt = firstString(
    codexCollab?.prompt,
    args.prompt,
    args.task,
    args.message,
    args.description,
  ) || '';
  const status = deriveStatus(
    input.name,
    args,
    input.result,
    input.isError,
    parsedResult.status,
    codexCollab?.status,
  );
  const attemptId = parsedResult.attemptId
    || parsedResult.taskId
    || firstString(args.id)
    || input.id;
  const logicalRunId = parsedResult.logicalRunId
    || firstString(args.logical_run_id, args.logicalRunId)
    || codexCollab?.childId
    || attemptId;

  return {
    id: logicalRunId,
    attemptId,
    attemptNumber: parsedResult.attemptNumber || 1,
    attemptCount: parsedResult.attemptNumber || 1,
    requiresDurableEvidence: isManagedSubagentToolName(input.name),
    agentName,
    prompt,
    requestedProviderId: parsedResult.requestedProviderId
      || firstString(args.provider_id, args.providerId),
    requestedModel,
    effectiveProviderId: parsedResult.effectiveProviderId,
    effectiveModel: parsedResult.effectiveModel || parsedResult.model,
    workflowId: firstString(args.workflow_id, args.workflowId),
    taskKey: firstString(args.task_key, args.taskKey),
    dependencyTaskKeys: stringArray(args.depends_on, args.dependsOn),
    runtime: parsedResult.runtime || inferRuntime(input.name, parsedResult.isNative),
    status,
    phase: parsedResult.phase || (status === 'running' ? 'running' : 'terminal'),
    dispatchState: status === 'running' ? 'executing' : 'terminal',
    currentActivity: parsedResult.currentActivity || codexCollab?.currentActivity,
    result: parsedResult.result,
    isError: input.isError,
    error: parsedResult.error,
    icon: iconForAgent(agentName),
  };
}

export function collapseLogicalSubagentRuns(runs: SubagentRunView[]): SubagentRunView[] {
  const order: string[] = [];
  const grouped = new Map<string, SubagentRunView>();
  for (const run of runs) {
    if (!grouped.has(run.id)) order.push(run.id);
    const previous = grouped.get(run.id);
    if (!previous || run.attemptNumber >= previous.attemptNumber) {
      grouped.set(run.id, {
        ...run,
        attemptCount: Math.max(
          run.attemptCount,
          run.attemptNumber,
          previous?.attemptCount || 0,
          previous?.attemptNumber || 0,
        ),
      });
    } else {
      grouped.set(run.id, {
        ...previous,
        attemptCount: Math.max(previous.attemptCount, run.attemptNumber),
      });
    }
  }
  return order
    .map(id => grouped.get(id))
    .filter((run): run is SubagentRunView => Boolean(run));
}

export function mergeSubagentRunDetails(
  current: SubagentRunView,
  details: SubagentRunDetailsResponse,
): SubagentRunView {
  const latest = details.attempts[details.attempts.length - 1];
  if (!latest) return current;
  return {
    ...current,
    id: details.logicalRunId,
    attemptId: latest.id,
    attemptNumber: latest.attemptNumber,
    attemptCount: details.attempts.length,
    agentName: latest.agentName || current.agentName,
    prompt: latest.prompt || current.prompt,
    requestedProviderId: latest.providerId || current.requestedProviderId,
    requestedModel: latest.requestedModel || current.requestedModel,
    effectiveProviderId: latest.effectiveProviderId || current.effectiveProviderId,
    effectiveModel: latest.effectiveModel || current.effectiveModel,
    workflowId: latest.workflowId || current.workflowId,
    taskKey: latest.taskKey || current.taskKey,
    dependencyTaskKeys: latest.dependencyTaskKeys,
    runtime: latest.runtime,
    status: latest.dispatchState === 'queued' ? 'queued' : latest.status,
    phase: latest.phase,
    dispatchState: latest.dispatchState,
    currentActivity: latest.currentActivity,
    lastActivityAt: latest.lastActivityAt,
    result: latest.resultText || current.result,
    structuredResult: latest.result,
    attempts: details.attempts,
    lifecycleEvents: details.events,
    error: latest.error,
    isError: latest.status === 'failed' || latest.status === 'timed_out',
  };
}

export function agentRunTabFromView(run: SubagentRunView): AgentRunTab {
  const key = run.id;
  return {
    id: dynamicTabId('agent-run', key),
    kind: 'agent-run',
    key,
    title: run.agentName,
    run: {
      ...run,
      prompt: run.prompt.slice(0, 20_000),
      result: run.result?.slice(0, 50_000),
      attempts: run.attempts?.map(attempt => ({
        ...attempt,
        prompt: attempt.prompt.slice(0, 20_000),
        resultText: attempt.resultText?.slice(0, 50_000),
      })),
    },
  };
}

function parseNativeResult(result: string | undefined): {
  agentName?: string;
  model?: string;
  result?: string;
  isNative: boolean;
  status?: SubagentExecutionStatus;
  phase?: SubagentRunPhase;
  taskId?: string;
  logicalRunId?: string;
  attemptId?: string;
  attemptNumber?: number;
  requestedProviderId?: string;
  requestedModel?: string;
  effectiveProviderId?: string;
  effectiveModel?: string;
  currentActivity?: string;
  runtime?: SubagentRunView['runtime'];
  error?: SubagentStatusError;
} {
  if (!result) return { isNative: false };
  const statusResult = parseSubagentStatusResult(result);
  if (statusResult.metadata) {
    return {
      agentName: statusResult.metadata.agentName,
      model: statusResult.metadata.model,
      effectiveModel: statusResult.metadata.effectiveModel,
      result: statusResult.body,
      isNative: statusResult.metadata.runtime === 'codepilot_runtime',
      status: statusResult.metadata.status,
      phase: statusResult.metadata.phase,
      taskId: statusResult.metadata.taskId,
      logicalRunId: statusResult.metadata.logicalRunId,
      attemptId: statusResult.metadata.attemptId,
      attemptNumber: statusResult.metadata.attemptNumber,
      requestedProviderId: statusResult.metadata.requestedProviderId,
      requestedModel: statusResult.metadata.requestedModel,
      effectiveProviderId: statusResult.metadata.effectiveProviderId,
      currentActivity: statusResult.metadata.currentActivity,
      runtime: statusResult.metadata.runtime,
      error: statusResult.metadata.error,
    };
  }
  const match = result.match(/^Sub-agent: ([^\n]+)\nModel: ([^\n]+)\nRun: [^\n]+\n\n/);
  if (!match) return { result, isNative: false };
  return {
    agentName: match[1]?.trim(),
    model: match[2]?.trim(),
    result: result.slice(match[0].length),
    isNative: true,
  };
}

function deriveStatus(
  toolName: string,
  toolInput: Record<string, unknown>,
  result: string | undefined,
  isError: boolean | undefined,
  explicitStatus?: SubagentExecutionStatus,
  codexChildStatus?: SubagentRunStatus,
): SubagentRunStatus {
  if (explicitStatus) return explicitStatus;
  const lowerName = toolName.toLowerCase();
  if (lowerName === 'codex_subagent' || lowerName === 'collabagenttoolcall') {
    // The collab item's top-level status is only the wait/sendInput/etc.
    // action status. It must never complete or fail the child. Child lifecycle
    // facts come exclusively from agentsStates (or a future typed lifecycle).
    return codexChildStatus ?? 'running';
  }
  if (!result) return 'running';
  if (isError) return 'failed';
  const requestedBackground = toolInput.run_in_background === true
    || toolInput.runInBackground === true
    || toolInput.background === true
    || toolInput.async === true;
  if (requestedBackground) return 'running';
  // Claude background Agent calls return a launch receipt before the child is
  // done. Completion is updated later from task_notification on the same id.
  if (isAsyncSubagentLaunchResult(result)) return 'running';
  if (/SUBAGENT_CANCELLED|cancelled|canceled/i.test(result)) return 'cancelled';
  // Managed routes always return CodePilot's structured terminal envelope.
  // A plain tool result is therefore not proof that the child finished; it is
  // most commonly a launch/transport receipt. Fail closed as running instead
  // of reviving the old "any tool_result = completed" heuristic.
  if (
    lowerName === 'codepilot_spawn_subagent'
    || lowerName.endsWith('__codepilot_spawn_subagent')
  ) {
    return 'running';
  }
  return 'completed';
}

interface CodexCollabFacts {
  childId: string;
  model?: string;
  prompt?: string;
  status?: SubagentRunStatus;
  currentActivity?: string;
}

function parseCodexCollabFacts(
  input: Record<string, unknown>,
  result: string | undefined,
): CodexCollabFacts | undefined {
  const output = parseJsonRecord(result);
  const records = output ? [output, input] : [input];
  const ids = new Set<string>();
  for (const record of records) {
    for (const id of stringArray(record.receiverThreadIds)) {
      if (id.trim()) ids.add(id.trim());
    }
    for (const id of Object.keys(asRecord(record.agentsStates))) {
      if (id.trim()) ids.add(id.trim());
    }
  }
  if (ids.size !== 1) return undefined;
  const childId = ids.values().next().value;
  if (!childId) return undefined;

  let state: Record<string, unknown> | undefined;
  for (const record of records) {
    const candidate = asRecord(asRecord(record.agentsStates)[childId]);
    if (Object.keys(candidate).length > 0) {
      state = candidate;
      break;
    }
  }

  return {
    childId,
    model: firstString(...records.map(record => record.model)),
    prompt: firstString(...records.map(record => record.prompt)),
    status: codexChildStateStatus(firstString(state?.status)),
    currentActivity: firstString(state?.message),
  };
}

function codexChildStateStatus(status: string | undefined): SubagentRunStatus | undefined {
  switch (status?.toLowerCase()) {
    case 'completed':
      return 'completed';
    case 'errored':
    case 'error':
    case 'notfound':
    case 'not_found':
      return 'failed';
    case 'shutdown':
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'interrupted':
      return 'partial';
    case 'pendinginit':
    case 'pending_init':
    case 'running':
      return 'running';
    default:
      return undefined;
  }
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return asRecord(parsed);
  } catch {
    return undefined;
  }
}

function inferRuntime(name: string, nativeResult: boolean): SubagentRunView['runtime'] {
  const lower = name.toLowerCase();
  if (lower === 'codex_subagent') return 'codex_runtime';
  if (lower.endsWith('__codepilot_spawn_subagent') || lower === 'codepilot_spawn_subagent') {
    return 'claude_code';
  }
  if (nativeResult) return 'codepilot_runtime';
  // Agent / Task are SDK names as well as the legacy Native tool name. When
  // the result lacks a trustworthy runtime breadcrumb, do not invent one.
  return undefined;
}

function iconForAgent(name: string): SubagentIcon {
  if (/research|explore|search|investigat/i.test(name)) return 'search';
  if (/review|audit|critic|检查|审查/i.test(name)) return 'code';
  if (/plan|task|worker/i.test(name)) return 'task';
  return 'assistant';
}

function normalizeModel(value: string | undefined): string | undefined {
  if (!value || value === 'inherit') return undefined;
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function stringArray(...values: unknown[]): string[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === 'string');
    }
  }
  return [];
}
