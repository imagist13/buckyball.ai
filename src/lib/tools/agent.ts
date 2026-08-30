/**
 * tools/agent.ts — AgentTool: spawn a sub-agent with isolated context.
 *
 * The sub-agent runs an independent agent-loop with restricted tools
 * and a separate message history. Results are returned as text to the parent.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { getAgent, getSubAgents } from '../agent-registry';
import { runAgentLoop } from '../agent-loop';
import { assembleTools, PERMISSION_SAFE_TOOLS } from '../agent-tools';
import {
  findSubagentRoute,
  getSubagentRoutingGuidance,
  listSubagentRoutes,
  reportedModelMatchesSubagentRoute,
  subagentRouteSelector,
} from '../subagent-models';
import type { NativeTimeoutConfig } from '../native-timeout';
import type { ProviderCallScene } from '../provider-call-policy';
import {
  encodeSubagentStatusResult,
  type SubagentExecutionStatus,
  type SubagentStatusError,
} from '../subagent-status';
import {
  checkpointSubagentRun,
  describeSubagentRunStartRejection,
  markSubagentRunSettling,
  recordSubagentRunEvent,
  settleSubagentRun,
  startSubagentRun,
} from '../db';
import type { ToolSet } from 'ai';
import crypto from 'crypto';
import {
  resolveSubagentDependencies,
  validateSubagentDispatchSpec,
} from '../subagent-orchestration';
import {
  classifyReportedSubagentTaskFailure,
  explicitlyReportsSubagentTaskFailure,
  parseReportedSubagentOutcome,
  SUBAGENT_OUTCOME_INSTRUCTION,
} from '../reported-subagent-outcome';

const activeDelegations = new Map<string, number>();
const MAX_CONCURRENT_DELEGATIONS = 2;
const MINUTE_MS = 60_000;

/**
 * Managed Native children are blocking foreground calls, so unlike ordinary
 * Native chat they must not inherit the all-disabled timeout default.
 *
 * - connect/first-token: fail a Provider request that makes no progress
 * - tool execution: one minute beyond the inherited 5-minute approval window
 * - total run: align with the Claude managed-child hard ceiling
 *
 * Codex currently retains its own 5-minute adapter ceiling; that discrepancy
 * is documented as follow-up rather than hidden as an accidental default.
 */
export const NATIVE_SUBAGENT_TIMEOUTS = {
  connectMs: 5 * MINUTE_MS,
  firstTokenMs: 5 * MINUTE_MS,
  toolExecutionMs: 6 * MINUTE_MS,
  totalRunMs: 30 * MINUTE_MS,
} satisfies NativeTimeoutConfig;

/**
 * Create the Agent tool for spawning sub-agents.
 */
export function createAgentTool(ctx: {
  workingDirectory: string;
  providerId?: string;
  sessionProviderId?: string;
  parentModel?: string;
  /** Inherit permission mode from parent */
  permissionMode?: string;
  bypassPermissions?: boolean;
  /** Parent session ID — sub-agent inherits permission context */
  parentSessionId?: string;
  /** Callback to forward SSE events (permission_request) to the parent stream */
  emitSSE?: (event: { type: string; data: string }) => void;
  /** Abort signal from parent */
  abortSignal?: AbortSignal;
  /** Parent call scene — delegation is allowed only from a foreground chat. */
  parentCallScene?: ProviderCallScene;
}) {
  const subAgentIds = getSubAgents().map(a => a.id);
  const routes = listSubagentRoutes('codepilot_runtime');
  const parentProviderId = ctx.providerId || ctx.sessionProviderId || 'env';
  const routingGuidance = getSubagentRoutingGuidance('codepilot_runtime', routes);

  return tool({
    description:
      'Launch a blocking one-shot Sub Agent in the current CodePilot Runtime on an explicit CodePilot Provider + Model route. ' +
      'The Sub Agent has isolated context, inherits the parent tool/permission surface, and never inherits the parent Provider when a named route is requested. ' +
      'The call returns only after the child reaches a terminal status; no background child remains running afterward. Consume terminal=true plus the returned result immediately and never describe it as merely submitted or still processing. ' +
      'For dependent children, assign one workflow_id, a unique task_key per child, and depends_on task keys; emit upstream task calls before their dependents. CodePilot waits durably and injects upstream terminal results before starting the downstream Runtime. ' +
      'Never launch a wait-only/stand-by placeholder; an undeclared placeholder is rejected before Provider execution. ' +
      'Omit logical_run_id on a first attempt; reuse the returned logicalRunId only when retrying that same logical task so retries stay in one capsule. ' +
      'CodePilot rejects reuse while the prior attempt is active or after it completed successfully; omit logical_run_id for genuinely new work. ' +
      `Available agents: ${subAgentIds.join(', ')}. ` +
      'Use "explore" for quick codebase searches, "general" for multi-step tasks.\n' +
      routingGuidance,
    inputSchema: z.object({
      prompt: z.string().describe('The task for the sub-agent to perform'),
      agent: z.string().optional().describe(`Agent type: ${subAgentIds.join(' | ')} (default: general)`),
      provider_id: z.string().optional().describe('Exact provider_id from the route list. Required for a named-model child; omit only to inherit the parent route.'),
      model: z.string().optional().describe('Exact model selector from the route list. Omit or use "inherit" only to keep the parent model.'),
      logical_run_id: z.string().max(160).optional().describe('Opaque logical task id for a retry. Omit on the first attempt; if a failed result returns logicalRunId, reuse exactly that value so the retry stays in one UI capsule.'),
      workflow_id: z.string().max(160).optional().describe('Stable workflow id shared by all children in one dependency graph. Provide together with task_key.'),
      task_key: z.string().max(160).optional().describe('Unique task key within workflow_id, such as research, copy, or implementation.'),
      depends_on: z.array(z.string().max(160)).optional().describe('Upstream task_key values in the same workflow. CodePilot waits for their durable completed results and injects them into this child prompt.'),
    }),
    execute: async ({
      prompt,
      agent: agentId,
      provider_id: requestedProviderId,
      model: requestedModel,
      logical_run_id: requestedLogicalRunId,
      workflow_id: workflowId,
      task_key: taskKey,
      depends_on: dependsOn,
    }, execOptions) => {
      if (ctx.parentCallScene !== 'interactive_chat') {
        return encodeSubagentStatusResult({
          status: 'failed',
          runtime: 'codepilot_runtime',
          error: { code: 'RUNTIME_ERROR', retryable: false },
        }, 'DELEGATION_SCENE_BLOCKED: Sub Agents can only be started from an active user chat turn.');
      }

      const agentDef = getAgent(agentId || 'general');
      if (!agentDef) {
        return encodeSubagentStatusResult({
          status: 'failed',
          runtime: 'codepilot_runtime',
          error: { code: 'RUNTIME_ERROR', retryable: false },
        }, `Error: Unknown agent "${agentId}". Available: ${subAgentIds.join(', ')}`);
      }
      const dispatchValidation = validateSubagentDispatchSpec({
        prompt,
        workflowId,
        taskKey,
        dependsOn,
      });
      if (!dispatchValidation.ok) {
        return encodeSubagentStatusResult({
          status: 'failed',
          agentName: agentDef.displayName,
          runtime: 'codepilot_runtime',
          error: dispatchValidation.error,
        }, dispatchValidation.message);
      }
      const dispatchSpec = dispatchValidation.spec;

      const wantsInheritance = !requestedModel || requestedModel === 'inherit';
      const targetProviderId = wantsInheritance
        ? parentProviderId
        : requestedProviderId?.trim();
      const targetModel = wantsInheritance
        ? ctx.parentModel
        : (requestedModel || agentDef.model)?.trim();
      if (!targetProviderId || !targetModel) {
        return encodeSubagentStatusResult({
          status: 'failed',
          agentName: agentDef.displayName,
          model: targetModel,
          runtime: 'codepilot_runtime',
          error: { code: 'MODEL_UNAVAILABLE', retryable: false },
        }, 'SUBAGENT_ROUTE_REQUIRED: a named-model Sub Agent requires both provider_id and model from the available route list. Do not substitute the parent route.');
      }
      const route = findSubagentRoute(routes, targetProviderId, targetModel);
      if (!route) {
        return encodeSubagentStatusResult({
          status: 'failed',
          agentName: agentDef.displayName,
          model: targetModel,
          runtime: 'codepilot_runtime',
          error: { code: 'MODEL_UNAVAILABLE', retryable: false },
        }, `SUBAGENT_MODEL_UNAVAILABLE: CodePilot Runtime cannot route provider "${targetProviderId}" model "${targetModel}". Do not continue as if this Sub Agent ran. Ask the user whether to choose an available route or change Runtime.`);
      }

      const toolCallId = (execOptions as { toolCallId?: string } | undefined)?.toolCallId;
      const agentRunId = toolCallId || `agent-run-${crypto.randomUUID()}`;
      const childSessionId = `sub-${crypto.randomUUID()}`;
      if (!ctx.parentSessionId) {
        return encodeSubagentStatusResult({
          status: 'failed',
          taskId: agentRunId,
          agentName: agentDef.displayName,
          model: route.displayName,
          runtime: 'codepilot_runtime',
          error: { code: 'RUNTIME_ERROR', retryable: true },
        }, 'SUBAGENT_RUN_PERSISTENCE_UNAVAILABLE: the parent chat session is missing, so an auditable Sub Agent run cannot be created. The child was not started.');
      }
      let startedRun: ReturnType<typeof startSubagentRun>;
      try {
        startedRun = startSubagentRun({
          id: agentRunId,
          logicalRunId: requestedLogicalRunId,
          parentSessionId: ctx.parentSessionId,
          runtime: 'codepilot_runtime',
          toolName: 'Agent',
          agentName: agentDef.displayName,
          providerId: route.providerId,
          requestedModel: route.id,
          workflowId: dispatchSpec.workflowId,
          taskKey: dispatchSpec.taskKey,
          dependencyTaskKeys: dispatchSpec.dependencyTaskKeys,
          prompt,
        });
      } catch (persistenceError) {
        const rejection = describeSubagentRunStartRejection(persistenceError);
        const detail = persistenceError instanceof Error
          ? persistenceError.message
          : String(persistenceError);
        return encodeSubagentStatusResult({
          status: 'failed',
          taskId: agentRunId,
          agentName: agentDef.displayName,
          model: route.displayName,
          runtime: 'codepilot_runtime',
          error: rejection?.error || { code: 'RUNTIME_ERROR', retryable: true },
        }, rejection?.message
          || `SUBAGENT_RUN_PERSISTENCE_UNAVAILABLE: CodePilot could not create an auditable run before launch (${detail}). The child was not started.`);
      }
      const logicalRunId = startedRun.logical_run_id;
      const attemptNumber = startedRun.attempt_number;
      let runtimeStarted = false;
      let runtimeReportedModel: string | undefined;
      const terminalResult = (
        status: Exclude<SubagentExecutionStatus, 'running'>,
        text: string,
        error?: SubagentStatusError,
        usage?: {
          requests?: number;
          inputTokens?: number;
          outputTokens?: number;
          toolCalls?: number;
          costUsd?: number;
        },
      ): string => {
        try {
          markSubagentRunSettling(agentRunId);
          const settled = settleSubagentRun(agentRunId, {
            status,
            resultText: text,
            effectiveProviderId: runtimeStarted ? route.providerId : undefined,
            effectiveModel: runtimeReportedModel,
            error,
            usage,
          });
          const factStatus = settled?.terminal === 1
            ? settled.status as Exclude<SubagentExecutionStatus, 'running'>
            : status;
          const factText = settled?.terminal === 1 ? settled.result_text : text;
          const factEffectiveProvider = settled?.effective_provider_id
            || (runtimeStarted ? route.providerId : undefined);
          const factEffectiveModel = settled?.effective_model || runtimeReportedModel;
          return encodeSubagentStatusResult({
            status: factStatus,
            phase: 'terminal',
            taskId: agentRunId,
            logicalRunId,
            attemptId: agentRunId,
            attemptNumber,
            agentName: agentDef.displayName,
            requestedProviderId: route.providerId,
            requestedModel: route.id,
            effectiveProviderId: factEffectiveProvider,
            effectiveModel: factEffectiveModel,
            model: route.displayName,
            runtime: 'codepilot_runtime',
            error: factStatus === status ? error : undefined,
          }, factText);
        } catch (persistenceError) {
          const detail = persistenceError instanceof Error
            ? persistenceError.message
            : String(persistenceError);
          return encodeSubagentStatusResult({
            status: 'failed',
            phase: 'settling',
            taskId: agentRunId,
            logicalRunId,
            attemptId: agentRunId,
            attemptNumber,
            agentName: agentDef.displayName,
            requestedProviderId: route.providerId,
            requestedModel: route.id,
            model: route.displayName,
            runtime: 'codepilot_runtime',
            error: { code: 'RUNTIME_ERROR', retryable: false },
          }, `SUBAGENT_RUN_PERSISTENCE_FAILED: child reached ${status}, but CodePilot could not persist the terminal fact (${detail}). Do not claim completion or background progress.\n\n${text}`);
        }
      };
      const dependencyResolution = await resolveSubagentDependencies({
        runId: agentRunId,
        parentSessionId: ctx.parentSessionId,
        prompt,
        workflowId: dispatchSpec.workflowId,
        dependencyTaskKeys: dispatchSpec.dependencyTaskKeys,
        abortSignal: ctx.abortSignal,
      });
      if (!dependencyResolution.ok) {
        return terminalResult(
          dependencyResolution.status,
          dependencyResolution.message,
          dependencyResolution.error,
        );
      }
      const executionPrompt = dependencyResolution.prompt;
      const concurrencyKey = ctx.parentSessionId;
      const activeCount = activeDelegations.get(concurrencyKey) || 0;
      if (activeCount >= MAX_CONCURRENT_DELEGATIONS) {
        return terminalResult(
          'failed',
          `SUBAGENT_CONCURRENCY_LIMIT: at most ${MAX_CONCURRENT_DELEGATIONS} Sub Agents may run at once.`,
          { code: 'CONCURRENCY_LIMIT', retryable: true },
        );
      }
      activeDelegations.set(concurrencyKey, activeCount + 1);
      const childAbortController = new AbortController();
      const abortChild = () => childAbortController.abort(ctx.abortSignal?.reason);
      if (ctx.abortSignal?.aborted) abortChild();
      else ctx.abortSignal?.addEventListener('abort', abortChild, { once: true });

      try {
      const currentRoute = findSubagentRoute(
        listSubagentRoutes('codepilot_runtime'),
        route.providerId,
        subagentRouteSelector(route),
      );
      if (!currentRoute) {
        return terminalResult(
          'failed',
          `SUBAGENT_MODEL_UNAVAILABLE: ${route.displayName} is no longer enabled for CodePilot Runtime.`,
          { code: 'MODEL_UNAVAILABLE', retryable: false },
        );
      }

      // Persist permission rows against the real parent chat session (the DB
      // foreign key), while carrying child identity in the SSE payload so a
      // prompt can be approved/denied for the correct run.
      const permissionContext = (
        !ctx.bypassPermissions
        && ctx.parentSessionId
        && ctx.emitSSE
        && ctx.permissionMode
      )
        ? {
            sessionId: ctx.parentSessionId,
            permissionMode: (ctx.permissionMode || 'normal') as import('../permission-checker').PermissionMode,
            emitSSE: ctx.emitSSE,
            abortSignal: childAbortController.signal,
            agentRunId,
            childSessionId,
          }
        : undefined;
      const { tools: allTools, systemPrompts: childToolPrompts } = assembleTools({
        workingDirectory: ctx.workingDirectory,
        prompt: executionPrompt,
        sessionId: ctx.parentSessionId,
        emitSSE: ctx.emitSSE,
        abortSignal: childAbortController.signal,
        providerId: route.providerId,
        sessionProviderId: route.providerId,
        model: route.id,
        callScene: 'delegated_interactive',
        bypassPermissions: ctx.bypassPermissions,
        permissionContext,
      });
      // Inherit the parent's effective tool surface. Normal sessions keep the
      // existing permission wrapper (including child run attribution); the
      // explicit full-access profile inherits the unwrapped surface. A direct
      // caller that supplied neither fact stays on the historical safe-read
      // fallback rather than accidentally gaining writes.
      const parentPolicyKnown = Boolean(permissionContext || ctx.bypassPermissions);
      const inheritedTools = Object.fromEntries(
        Object.entries(allTools).filter(([name]) =>
          name !== 'Agent'
          && name !== 'codepilot_spawn_subagent'
          && (parentPolicyKnown || PERMISSION_SAFE_TOOLS.has(name))),
      );
      const subTools = filterTools(inheritedTools, agentDef.allowedTools, agentDef.disallowedTools);

      // Build system prompt
      const systemPrompt = [
        agentDef.prompt || 'You are a helpful sub-agent.',
        `Working directory: ${ctx.workingDirectory}`,
        ...childToolPrompts,
        'Use the inherited tools under the parent permission policy. Do not spawn another agent.',
        'If the task needs a capability or tool that is unavailable or denied, explicitly report that the task failed. Never substitute training knowledge, stale files, or a completed-sounding summary.',
        SUBAGENT_OUTCOME_INSTRUCTION,
      ].filter(Boolean).join('\n\n');

      // The requested Provider becomes an effective fact only at the point
      // where this adapter actually starts the child Runtime. A queued child
      // cancelled during dependency wait must keep effectiveProviderId empty.
      runtimeStarted = true;
      checkpointSubagentRun(agentRunId, {
        effectiveProviderId: route.providerId,
        currentActivity: 'Starting Sub-agent Runtime',
      });

      // Run sub-agent loop and collect the full response
      const stream = runAgentLoop({
        callScene: 'delegated_interactive',
        prompt: executionPrompt,
        sessionId: childSessionId,
        providerId: route.providerId,
        sessionProviderId: route.providerId,
        model: route.id,
        systemPrompt,
        workingDirectory: ctx.workingDirectory,
        tools: subTools,
        maxSteps: agentDef.maxSteps || 30,
        permissionMode: ctx.permissionMode, // inherit from parent
        abortController: childAbortController,
        timeouts: NATIVE_SUBAGENT_TIMEOUTS,
      });

      // Emit subagent start event as tool_output so the parent UI can show progress
      if (ctx.emitSSE) {
        ctx.emitSSE({
          type: 'tool_output',
          data: `[subagent:${agentDef.id}:${route.displayName}] ${executionPrompt.length > 120 ? executionPrompt.slice(0, 117) + '...' : executionPrompt}`,
        });
      }

      // Collect text from the stream
      const reader = stream.getReader();
      const textParts: string[] = [];
      let childError: { message: string; category?: string } | undefined;
      let usage: {
        requests?: number;
        inputTokens?: number;
        outputTokens?: number;
        toolCalls?: number;
        costUsd?: number;
      } | undefined;
      let toolCalls = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Parse SSE events, extract text content and forward permission requests
          if (value) {
            const lines = value.split('\n');
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const event = JSON.parse(line.slice(6));
                if (event.type === 'text') {
                  textParts.push(event.data);
                  checkpointSubagentRun(agentRunId, {
                    resultText: textParts.join(''),
                    currentActivity: 'Generating Sub-agent result',
                  });
                } else if (event.type === 'error') {
                  childError = parseChildErrorEvent(event.data);
                } else if (event.type === 'result') {
                  try {
                    const result = JSON.parse(event.data) as {
                      usage?: {
                        input_tokens?: number;
                        output_tokens?: number;
                        cost_usd?: number;
                      };
                      num_turns?: number;
                      model_id?: string;
                    };
                    runtimeReportedModel = result.model_id?.trim() || runtimeReportedModel;
                    usage = {
                      requests: result.num_turns,
                      inputTokens: result.usage?.input_tokens,
                      outputTokens: result.usage?.output_tokens,
                      costUsd: result.usage?.cost_usd,
                      toolCalls,
                    };
                    if (runtimeReportedModel) {
                      checkpointSubagentRun(agentRunId, {
                        effectiveModel: runtimeReportedModel,
                        currentActivity: 'Runtime route reported',
                      });
                    }
                  } catch { /* usage is optional */ }
                } else if (event.type === 'permission_request' && ctx.emitSSE) {
                  // Forward permission requests to parent stream so the
                  // client can show the approval UI for sub-agent tool calls
                  ctx.emitSSE(event);
                } else if (event.type === 'tool_use') {
                  // Forward subagent tool invocations as tool_output progress
                  try {
                    const tool = JSON.parse(event.data);
                    toolCalls += 1;
                    const toolRenderer = getToolSummary(tool.name, tool.input);
                    recordSubagentRunEvent(agentRunId, {
                      type: 'tool_started',
                      activity: toolRenderer,
                      toolName: tool.name,
                    });
                    ctx.emitSSE?.({ type: 'tool_output', data: `> ${toolRenderer}` });
                  } catch { /* skip malformed */ }
                } else if (event.type === 'tool_result') {
                  // Show tool completion
                  try {
                    const res = JSON.parse(event.data);
                    const status = res.is_error ? 'x' : '+';
                    recordSubagentRunEvent(agentRunId, {
                      type: 'tool_completed',
                      activity: res.is_error ? 'Tool failed' : 'Tool completed',
                      payload: { isError: res.is_error === true },
                    });
                    ctx.emitSSE?.({ type: 'tool_output', data: `[${status}] done` });
                  } catch { /* skip malformed */ }
                }
              } catch { /* skip non-JSON lines */ }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (childAbortController.signal.aborted) {
        return terminalResult(
          'cancelled',
          'SUBAGENT_CANCELLED: the parent turn was cancelled.',
          undefined,
          usage,
        );
      }
      if (childError) {
        const error = classifyNativeSubagentError(childError.message, childError.category);
        const timedOut = error.code === 'TIMEOUT';
        return terminalResult(
          timedOut ? 'timed_out' : 'failed',
          childError.message,
          error,
          usage,
        );
      }
      if (
        runtimeReportedModel
        && !reportedModelMatchesSubagentRoute(runtimeReportedModel, route)
      ) {
        recordSubagentRunEvent(agentRunId, {
          type: 'route_warning',
          activity: 'Effective model did not match the requested route',
          payload: {
            requestedProviderId: route.providerId,
            requestedModel: route.id,
            reportedModel: runtimeReportedModel,
          },
        });
        return terminalResult(
          'failed',
          `SUBAGENT_ROUTE_MISMATCH: requested ${route.providerId}/${route.id}, but CodePilot Runtime reported model "${runtimeReportedModel}". CodePilot stopped this attempt instead of silently accepting a fallback.`,
          { code: 'ROUTE_MISMATCH', retryable: false },
          usage,
        );
      }
      const reportedOutcome = parseReportedSubagentOutcome(textParts.join(''));
      const result = reportedOutcome.text || '(Sub-agent produced no text output)';
      const resultText = `${result}\n\nRequested route: ${route.providerName} / ${subagentRouteSelector(route)}${
        runtimeReportedModel ? `\nRuntime-reported model: ${runtimeReportedModel}` : ''
      }`;
      if (
        reportedOutcome.status === 'failed'
        || explicitlyReportsSubagentTaskFailure(result)
      ) {
        return terminalResult(
          'failed',
          resultText,
          reportedOutcome.error || classifyReportedSubagentTaskFailure(result),
          usage,
        );
      }
      if (reportedOutcome.status === 'partial') {
        return terminalResult(
          'partial',
          resultText,
          reportedOutcome.error || { code: 'RUNTIME_ERROR', retryable: true },
          usage,
        );
      }
      return terminalResult(
        reportedOutcome.text ? 'completed' : 'failed',
        resultText,
        reportedOutcome.text
          ? undefined
          : { code: 'EMPTY_RESULT' as const, retryable: true },
        usage,
      );
      } catch (error) {
        const cancelled = childAbortController.signal.aborted;
        const message = cancelled
          ? 'SUBAGENT_CANCELLED: the parent turn was cancelled.'
          : error instanceof Error ? error.message : String(error);
        return terminalResult(
          cancelled ? 'cancelled' : 'failed',
          message,
          cancelled ? undefined : classifyNativeSubagentError(message),
        );
      } finally {
        ctx.abortSignal?.removeEventListener('abort', abortChild);
        const remaining = (activeDelegations.get(concurrencyKey) || 1) - 1;
        if (remaining > 0) activeDelegations.set(concurrencyKey, remaining);
        else activeDelegations.delete(concurrencyKey);
      }
    },
  });
}

export function parseChildErrorEvent(data: unknown): { message: string; category?: string } {
  if (typeof data !== 'string') return { message: String(data) };
  try {
    const parsed = JSON.parse(data) as { userMessage?: unknown; category?: unknown };
    return {
      message: typeof parsed.userMessage === 'string' ? parsed.userMessage : data,
      ...(typeof parsed.category === 'string' ? { category: parsed.category } : {}),
    };
  } catch {
    return { message: data };
  }
}

export function classifyNativeSubagentError(message: string, category?: string): SubagentStatusError {
  const statusMatch = message.match(/(?:HTTP|API Error|status(?: code)?)\D{0,8}(401|403|429|5\d\d)\b/i);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : undefined;
  if (httpStatus === 401 || httpStatus === 403) {
    return { code: 'AUTH_FORBIDDEN', httpStatus, retryable: false };
  }
  if (httpStatus === 429) {
    return { code: 'RATE_LIMITED', httpStatus, retryable: true };
  }
  if (category?.startsWith('TIMEOUT_') || /timed? out|timeout/i.test(message)) {
    return { code: 'TIMEOUT', retryable: true };
  }
  if (/model[^\n]*(?:not found|unavailable|unsupported|not available)|unknown model/i.test(message)) {
    return { code: 'MODEL_UNAVAILABLE', ...(httpStatus ? { httpStatus } : {}), retryable: false };
  }
  return {
    code: 'RUNTIME_ERROR',
    ...(httpStatus ? { httpStatus } : {}),
    retryable: typeof httpStatus === 'number' && httpStatus >= 500,
  };
}

// ── Helpers ─────────────────────────────────────────────────────

/** Build a one-line summary of a tool invocation for subagent progress output. */
function getToolSummary(name: string, input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (!inp) return name;
  const lower = name.toLowerCase();
  if (['bash', 'execute', 'run', 'shell'].includes(lower)) {
    const cmd = (inp.command || inp.cmd || '') as string;
    return cmd ? (cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd) : 'bash';
  }
  const filePath = (inp.file_path || inp.path || inp.filePath || '') as string;
  if (['read', 'readfile', 'read_file'].includes(lower)) {
    return filePath ? `Read ${filePath}` : 'Read';
  }
  if (['write', 'edit', 'writefile', 'write_file', 'create_file'].includes(lower)) {
    return filePath ? `Edit ${filePath}` : 'Edit';
  }
  if (['glob', 'grep', 'search', 'find_files', 'search_files'].includes(lower)) {
    const pattern = (inp.pattern || inp.query || inp.glob || '') as string;
    return pattern ? `${name} "${pattern.length > 40 ? pattern.slice(0, 37) + '...' : pattern}"` : name;
  }
  return name;
}

function filterTools(
  allTools: ToolSet,
  allowedTools?: string[],
  disallowedTools?: string[],
): ToolSet {
  if (allowedTools && allowedTools.length > 0) {
    // Whitelist mode: only include specified tools
    const filtered: ToolSet = {};
    for (const name of allowedTools) {
      if (allTools[name]) filtered[name] = allTools[name];
    }
    return filtered;
  }

  if (disallowedTools && disallowedTools.length > 0) {
    // Blacklist mode: include all except specified
    const filtered: ToolSet = {};
    const blocked = new Set(disallowedTools);
    for (const [name, tool] of Object.entries(allTools)) {
      if (!blocked.has(name)) filtered[name] = tool;
    }
    return filtered;
  }

  return allTools;
}
