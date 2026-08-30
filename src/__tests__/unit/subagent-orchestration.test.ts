import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  findSubagentRoute,
  getSubagentRoutingGuidance,
  reportedModelMatchesSubagentRoute,
  resolveSameProviderSubagentModel,
  subagentRouteSelector,
  type SubagentModelOption,
  type SubagentRoute,
} from '../../lib/subagent-models';
import {
  agentRunTabFromView,
  buildSubagentRunView,
  collapseLogicalSubagentRuns,
  isSubagentToolCall,
  isSubagentToolName,
  shouldDisplaySubagentRun,
} from '../../lib/subagent-view';
import {
  initialState,
  openDynamicTab,
  parse,
  serialize,
} from '../../lib/workspace-sidebar';
import {
  getRegisteredAgents,
  validateClaudeSubagentToolInput,
  type ClaudeSubagentRoutingContext,
} from '../../lib/agent-sdk-agents';
import { buildPermissionResolvedEvent } from '../../lib/permission-registry';
import {
  encodeSubagentStatusResult,
  parseSubagentStatusResult,
} from '../../lib/subagent-status';
import { subagentModelBrand } from '../../lib/subagent-model-brand';
import {
  buildClaudeSubagentToolOptions,
  createClaudeSubagentActivityTimeout,
  createClaudeSubagentMcpServer,
  createClaudeSubagentToolUseCorrelation,
  findClaudeSubagentRoute,
  getClaudeSubagentPermissionAttribution,
  getClaudeSubagentRoutingGuidance,
  isClaudeManagedSubagentToolName,
  claudeReportedModelMatchesRoute,
  normalizeClaudeSubagentEffectiveModel,
  normalizeClaudeSubagentInterruption,
  normalizeClaudeSubagentCapabilities,
  normalizeClaudeSubagentTerminalResult,
  serializeClaudeSubagentWriteRun,
  validateClaudeSubagentCapabilities,
  type ClaudeSubagentRoute,
} from '../../lib/claude-subagent-mcp';
import {
  compileSubagentPromptWithDependencies,
  validateSubagentDispatchSpec,
} from '../../lib/subagent-orchestration';
import { formatClaudeStreamErrorDiagnostic } from '../../lib/claude-stream-diagnostics';
import type {
  SDKResultError,
  SDKResultSuccess,
} from '@anthropic-ai/claude-agent-sdk';
import {
  codexReportedModelMatchesRoute,
  codexNotificationBelongsToThread,
  combineCodexSubagentAbortSignalsFallback,
  getCodexSubagentParentContext,
  isManagedCodexSubagentSession,
  normalizeCodexSubagentEffectiveModel,
  normalizeCodexSubagentTurn,
  registerCodexSubagentParentContext,
  resolveCodexSubagentAbortSignal,
  resolveCodexSubagentPermission,
} from '../../lib/codex/subagent';
import {
  getSubagentDetailInitialProbeDelay,
  recordSubagentDetailProbeFailure,
  recordSubagentDetailProbeSuccess,
  resetSubagentDetailProbeStateForTests,
  SUBAGENT_DETAIL_COOLDOWN_MS,
  SUBAGENT_DETAIL_FAST_RETRY_MS,
} from '../../lib/subagent-detail-probe';
import { buildCodexHostedSearchTools } from '../../lib/codex/proxy/unified-adapter';
import {
  classifyNativeSubagentError,
  NATIVE_SUBAGENT_TIMEOUTS,
  parseChildErrorEvent,
} from '../../lib/tools/agent';
import {
  explicitlyReportsSubagentTaskFailure,
  parseReportedSubagentOutcome,
} from '../../lib/reported-subagent-outcome';
import fs from 'node:fs';
import path from 'node:path';
import { PermissionPrompt } from '../../components/chat/PermissionPrompt';
import { SubagentModelIcon } from '../../components/chat/SubagentModelIcon';
import { I18nContext } from '../../components/layout/I18nProvider';
import { translate } from '../../i18n';

const models: SubagentModelOption[] = [
  { id: 'deepseek-v3.2', upstreamId: 'deepseek/deepseek-v3.2', displayName: 'DeepSeek V3.2' },
  { id: 'grok-4.5', displayName: 'Grok 4.5' },
];

describe('same-provider sub-agent model resolution', () => {
  it('inherits the parent model when no override is requested', () => {
    assert.deepEqual(resolveSameProviderSubagentModel(undefined, 'grok-4.5', models), {
      ok: true,
      model: 'grok-4.5',
      requestedModel: 'inherit',
      displayName: 'Grok 4.5',
    });
  });

  it('canonicalizes an enabled upstream model ID', () => {
    const result = resolveSameProviderSubagentModel(
      'deepseek/deepseek-v3.2',
      'grok-4.5',
      models,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.model, 'deepseek-v3.2');
  });

  it('fails closed for an arbitrary model outside the current provider catalog', () => {
    assert.deepEqual(resolveSameProviderSubagentModel('unknown-model', 'grok-4.5', models), {
      ok: false,
      code: 'MODEL_NOT_AVAILABLE',
      requestedModel: 'unknown-model',
    });
  });
});

describe('Runtime-independent Sub-agent workflow contract', () => {
  it('rejects undeclared wait-only placeholders and validates explicit workflow edges', () => {
    const placeholder = validateSubagentDispatchSpec({
      prompt: '等待新闻搜集 Agent 提供内容，目前处于等待状态。',
    });
    assert.equal(placeholder.ok, false);
    if (!placeholder.ok) {
      assert.equal(placeholder.error.code, 'DEPENDENCY_DECLARATION_REQUIRED');
    }

    const realLongRunningCommand = validateSubagentDispatchSpec({
      prompt: '必须先使用 Bash 执行 sleep 180，等待命令结束后才输出 STOP_SMOKE_UPSTREAM_DONE；除此之外不要输出其他内容。',
      workflowId: 'release-smoke-stop',
      taskKey: 'upstream',
      dependsOn: [],
    });
    assert.equal(realLongRunningCommand.ok, true);

    const realEnglishCommand = validateSubagentDispatchSpec({
      prompt: 'Run the build and wait for the command output before reporting the verification result.',
      workflowId: 'release-smoke-stop',
      taskKey: 'upstream-en',
      dependsOn: [],
    });
    assert.equal(realEnglishCommand.ok, true);

    const undeclaredUpstreamOutput = validateSubagentDispatchSpec({
      prompt: 'Wait for the upstream output, then write the final copy.',
    });
    assert.equal(undeclaredUpstreamOutput.ok, false);
    if (!undeclaredUpstreamOutput.ok) {
      assert.equal(undeclaredUpstreamOutput.error.code, 'DEPENDENCY_DECLARATION_REQUIRED');
    }

    const workflow = validateSubagentDispatchSpec({
      prompt: 'Write the article from the upstream research.',
      workflowId: 'tour-news-20260724',
      taskKey: 'copy',
      dependsOn: ['research', 'research'],
    });
    assert.deepEqual(workflow, {
      ok: true,
      spec: {
        workflowId: 'tour-news-20260724',
        taskKey: 'copy',
        dependencyTaskKeys: ['research'],
      },
    });

    const selfDependency = validateSubagentDispatchSpec({
      prompt: 'Do the task.',
      workflowId: 'workflow',
      taskKey: 'research',
      dependsOn: ['research'],
    });
    assert.equal(selfDependency.ok, false);
    if (!selfDependency.ok) {
      assert.equal(selfDependency.error.code, 'INVALID_DEPENDENCY_SPEC');
    }
  });

  it('injects durable upstream output at execution time instead of freezing a placeholder prompt', () => {
    const compiled = compileSubagentPromptWithDependencies({
      prompt: 'Write a Chinese article from the verified research.',
      workflowId: 'tour-news',
      dependencies: [{
        id: 'attempt-research',
        logical_run_id: 'logical-research',
        attempt_number: 1,
        parent_session_id: 'session',
        runtime: 'claude_code',
        tool_name: 'codepilot_spawn_subagent',
        agent_name: 'News researcher',
        provider_id: 'qwen',
        requested_model: 'qwen-max',
        effective_provider_id: 'qwen',
        effective_model: 'Qwen Max',
        workflow_id: 'tour-news',
        task_key: 'research',
        dependencies_json: '[]',
        dispatch_state: 'terminal',
        prompt: 'Research.',
        status: 'completed',
        phase: 'terminal',
        terminal: 1,
        result_text: 'Verified result with https://example.com/source',
        result_json: '',
        current_activity: 'Sub-agent completed',
        last_activity_at: '2026-07-24 00:00:00',
        error_json: '',
        created_at: '2026-07-24 00:00:00',
        updated_at: '2026-07-24 00:01:00',
        completed_at: '2026-07-24 00:01:00',
      }],
    });
    assert.match(compiled, /dependencies below have now reached terminal status/);
    assert.match(compiled, /"task_key":"research"/);
    assert.match(compiled, /Verified result with https:\/\/example\.com\/source/);
    assert.doesNotMatch(compiled, /currently waiting/i);
  });

  it('is consumed by all three managed Runtime adapters', () => {
    const root = process.cwd();
    for (const file of [
      'src/lib/tools/agent.ts',
      'src/lib/claude-subagent-mcp.ts',
      'src/lib/codex/proxy/builtin-bridge.ts',
    ]) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      assert.match(source, /validateSubagentDispatchSpec/);
      assert.match(source, /resolveSubagentDependencies/);
      assert.match(source, /workflow_id/);
      assert.match(source, /task_key/);
      assert.match(source, /depends_on/);
    }
  });
});

describe('CodePilot/Codex managed cross-provider routes', () => {
  const routes: SubagentRoute[] = [
    {
      providerId: 'glm-provider',
      providerName: 'GLM',
      id: 'sonnet',
      upstreamId: 'glm-5.2',
      displayName: 'GLM-5.2',
    },
    {
      providerId: 'kimi-provider',
      providerName: 'Kimi Coding Plan',
      id: 'sonnet',
      upstreamId: 'kimi-for-coding',
      displayName: 'Kimi for Coding',
    },
  ];

  it('requires Provider + Model together, so identical protocol aliases cannot select the wrong vendor', () => {
    assert.equal(findSubagentRoute(routes, 'glm-provider', 'sonnet')?.displayName, 'GLM-5.2');
    assert.equal(findSubagentRoute(routes, 'kimi-provider', 'sonnet')?.displayName, 'Kimi for Coding');
    assert.equal(findSubagentRoute(routes, 'kimi-provider', 'glm-5.2'), undefined);
  });

  it('publishes descriptive selectors instead of presenting sonnet as the effective model', () => {
    assert.equal(subagentRouteSelector(routes[0]), 'glm-5.2');
    assert.equal(subagentRouteSelector(routes[1]), 'kimi-for-coding');
    const guidance = getSubagentRoutingGuidance('codepilot_runtime', routes);
    assert.match(guidance, /provider_id="glm-provider", model="glm-5\.2"/);
    assert.match(guidance, /Never substitute the parent model/);
  });

  it('accepts only a selected Native route identity as the Runtime-reported model', () => {
    assert.equal(
      reportedModelMatchesSubagentRoute('KIMI-FOR-CODING', routes[1]),
      true,
    );
    assert.equal(
      reportedModelMatchesSubagentRoute('Kimi for Coding', routes[1]),
      true,
    );
    assert.equal(
      reportedModelMatchesSubagentRoute('claude-sonnet-4-6', routes[1]),
      false,
    );
  });

  it('routes Native child tool assembly and execution through the selected Provider, not the parent Provider', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/tools/agent.ts'), 'utf8');
    assert.match(source, /providerId: route\.providerId/);
    assert.match(source, /sessionProviderId: route\.providerId/);
    assert.match(source, /startSubagentRun\(\{[\s\S]{0,400}runtime: 'codepilot_runtime'/);
    assert.match(source, /settleSubagentRun\(agentRunId/);
    assert.doesNotMatch(source, /Available same-provider models/);
  });

  it('gives managed Native children bounded Provider/tool/run waits without changing ordinary chat defaults', () => {
    assert.deepEqual(NATIVE_SUBAGENT_TIMEOUTS, {
      connectMs: 300_000,
      firstTokenMs: 300_000,
      toolExecutionMs: 360_000,
      totalRunMs: 1_800_000,
    });
    const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/tools/agent.ts'), 'utf8');
    assert.match(source, /timeouts: NATIVE_SUBAGENT_TIMEOUTS/);
    assert.match(source, /model_id\?: string/);
    assert.match(source, /SUBAGENT_ROUTE_MISMATCH/);
  });

  it('inherits the Native parent tool surface while preventing recursive delegation', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/tools/agent.ts'), 'utf8');
    assert.match(source, /parentPolicyKnown = Boolean\(permissionContext \|\| ctx\.bypassPermissions\)/);
    assert.match(source, /!ctx\.bypassPermissions[\s\S]{0,120}ctx\.parentSessionId/);
    assert.match(source, /name !== 'Agent'/);
    assert.match(source, /name !== 'codepilot_spawn_subagent'/);
    assert.doesNotMatch(source, /filterTools\(readOnlyTools/);
  });

  it('uses one shared task-outcome contract instead of treating a denied Native tool run as completed', () => {
    const failed = parseReportedSubagentOutcome([
      '__CODEPILOT_SUBAGENT_OUTCOME__{"status":"failed","error":{"code":"CAPABILITY_UNAVAILABLE","retryable":true}}',
      '命令未能执行：Bash 调用被权限策略拒绝。',
    ].join('\n'));
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error?.code, 'CAPABILITY_UNAVAILABLE');
    assert.equal(explicitlyReportsSubagentTaskFailure(failed.text), true);

    const contradictory = parseReportedSubagentOutcome([
      '__CODEPILOT_SUBAGENT_OUTCOME__{"status":"completed"}',
      '命令未能执行：permission denied。',
    ].join('\n'));
    assert.equal(contradictory.status, 'completed');
    assert.equal(explicitlyReportsSubagentTaskFailure(contradictory.text), true);
  });

  it('turns a Native child SSE 403 into a failed auth terminal instead of an empty success', () => {
    const parsed = parseChildErrorEvent(JSON.stringify({
      category: 'NATIVE_STREAM_ERROR',
      userMessage: 'API Error: 403 Access to model denied',
    }));
    assert.deepEqual(parsed, {
      category: 'NATIVE_STREAM_ERROR',
      message: 'API Error: 403 Access to model denied',
    });
    assert.deepEqual(classifyNativeSubagentError(parsed.message, parsed.category), {
      code: 'AUTH_FORBIDDEN',
      httpStatus: 403,
      retryable: false,
    });
  });
});

describe('Codex managed Sub Agent lifecycle', () => {
  it('keeps child notifications isolated from the parent app-server stream', () => {
    assert.equal(codexNotificationBelongsToThread({ threadId: 'parent' }, 'parent'), true);
    assert.equal(codexNotificationBelongsToThread({ threadId: 'child' }, 'parent'), false);
    assert.equal(codexNotificationBelongsToThread({ account: 'global' }, 'parent'), true);
  });

  it('normalizes completed, auth failure, and empty completion from Codex terminal facts', () => {
    assert.deepEqual(normalizeCodexSubagentTurn({
      status: 'completed',
      items: [{ type: 'agentMessage', phase: 'final_answer', text: 'Done' }],
    }), { status: 'completed', text: 'Done' });

    const forbidden = normalizeCodexSubagentTurn({
      status: 'failed',
      error: {
        message: 'Provider request failed',
        codexErrorInfo: { httpResponse: { httpStatusCode: 403 } },
      },
    });
    assert.equal(forbidden.status, 'failed');
    assert.deepEqual(forbidden.error, {
      code: 'AUTH_FORBIDDEN',
      httpStatus: 403,
      retryable: false,
    });

    const empty = normalizeCodexSubagentTurn({ status: 'completed', items: [] });
    assert.equal(empty.status, 'failed');
    assert.equal(empty.error?.code, 'EMPTY_RESULT');
  });

  it('uses the child task outcome contract instead of equating turn completion with task success', () => {
    const completed = normalizeCodexSubagentTurn({
      status: 'completed',
      items: [{
        type: 'agentMessage',
        phase: 'final_answer',
        text: '__CODEPILOT_SUBAGENT_OUTCOME__{"status":"completed"}\nCollected three verified sources.',
      }],
    });
    assert.deepEqual(completed, {
      status: 'completed',
      text: 'Collected three verified sources.',
    });

    const failed = normalizeCodexSubagentTurn({
      status: 'completed',
      items: [{
        type: 'agentMessage',
        phase: 'final_answer',
        text: '__CODEPILOT_SUBAGENT_OUTCOME__{"status":"failed","error":{"code":"CAPABILITY_UNAVAILABLE","retryable":true}}\n无法完成此任务：网络搜索工具不可用。',
      }],
    });
    assert.deepEqual(failed, {
      status: 'failed',
      text: '无法完成此任务：网络搜索工具不可用。',
      error: { code: 'CAPABILITY_UNAVAILABLE', retryable: true },
    });

    const contradictory = normalizeCodexSubagentTurn({
      status: 'completed',
      items: [{
        type: 'agentMessage',
        phase: 'final_answer',
        text: '__CODEPILOT_SUBAGENT_OUTCOME__{"status":"completed"}\n无法完成此任务：DNS 网络被阻断。',
      }],
    });
    assert.equal(contradictory.status, 'failed');
    assert.equal(contradictory.error?.code, 'CAPABILITY_UNAVAILABLE');

    const partial = normalizeCodexSubagentTurn({
      status: 'completed',
      items: [{
        type: 'agentMessage',
        phase: 'final_answer',
        text: '__CODEPILOT_SUBAGENT_OUTCOME__{"status":"partial"}\nTwo of three sources were verified.',
      }],
    });
    assert.equal(partial.status, 'partial');
    assert.equal(partial.text, 'Two of three sources were verified.');
  });

  it('keeps the structured task outcome requirement in the child system instructions', () => {
    const codexSource = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/codex/subagent.ts'),
      'utf8',
    );
    const sharedSource = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/reported-subagent-outcome.ts'),
      'utf8',
    );
    assert.match(codexSource, /SUBAGENT_OUTCOME_INSTRUCTION/);
    assert.match(sharedSource, /final response MUST start with exactly one machine-readable line/);
    assert.match(sharedSource, /finishing your response is not task completion/);
  });

  it('fails closed for legacy child prose that explicitly says the task was not completed', () => {
    const outcome = normalizeCodexSubagentTurn({
      status: 'completed',
      items: [{
        type: 'agentMessage',
        phase: 'final_answer',
        text: '**无法完成此任务**\n\n网络完全不可用，DNS 解析被沙箱阻断。',
      }],
    });
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.error?.code, 'CAPABILITY_UNAVAILABLE');
  });

  it('honours a failed outcome marker even when a compatible model prepends prose', () => {
    const outcome = normalizeCodexSubagentTurn({
      status: 'completed',
      items: [{
        type: 'agentMessage',
        phase: 'final_answer',
        text: [
          'I will search the latest sources now.',
          '__CODEPILOT_SUBAGENT_OUTCOME__{"status":"failed","error":{"code":"CAPABILITY_UNAVAILABLE","retryable":true}}',
          '我无法完成这个任务：没有可用的联网检索工具。',
        ].join(''),
      }],
    });
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.error?.code, 'CAPABILITY_UNAVAILABLE');
    assert.match(outcome.text, /I will search/);
    assert.match(outcome.text, /无法完成这个任务/);
    assert.doesNotMatch(outcome.text, /__CODEPILOT_SUBAGENT_OUTCOME__/);
  });

  it('marks nested child sessions so the bridge enforces depth one', () => {
    assert.equal(isManagedCodexSubagentSession('codex-subagent-123'), true);
    assert.equal(isManagedCodexSubagentSession('parent-session'), false);
  });

  it('carries the parent Codex permission wire into a managed child', () => {
    const parentAbort = new AbortController();
    const context = {
      permission: {
        thread: {
          approvalPolicy: 'on-request' as const,
          approvalsReviewer: 'user' as const,
          sandbox: 'workspace-write' as const,
        },
        turn: {
          approvalPolicy: 'on-request' as const,
          approvalsReviewer: 'user' as const,
          sandboxPolicy: {
            type: 'workspaceWrite' as const,
            writableRoots: [],
            networkAccess: false as const,
          },
        },
      },
      mcpServers: { search: { command: 'search-mcp' } },
      abortSignal: parentAbort.signal,
    };
    const unregister = registerCodexSubagentParentContext('parent-codex', context);
    assert.equal(getCodexSubagentParentContext('parent-codex'), context);
    assert.deepEqual(resolveCodexSubagentPermission(context), context.permission);
    const transportAbort = new AbortController();
    const combinedAbort = resolveCodexSubagentAbortSignal(
      context,
      transportAbort.signal,
    );
    assert.equal(combinedAbort?.aborted, false);
    parentAbort.abort();
    assert.equal(
      combinedAbort?.aborted,
      true,
      'a parent chat Stop must cancel dependency waiting and child execution even if the proxy request remains open',
    );
    unregister();
    assert.equal(getCodexSubagentParentContext('parent-codex'), undefined);
    assert.deepEqual(resolveCodexSubagentPermission().turn.sandboxPolicy, {
      type: 'workspaceWrite',
      writableRoots: [],
      networkAccess: true,
    });
  });

  it('composes parent and transport cancellation without requiring AbortSignal.any', () => {
    const parent = new AbortController();
    const transport = new AbortController();
    const combined = combineCodexSubagentAbortSignalsFallback([
      parent.signal,
      transport.signal,
    ]);
    assert.equal(combined.aborted, false);
    transport.abort('transport closed');
    assert.equal(combined.aborted, true);
    assert.equal(combined.reason, 'transport closed');

    const alreadyStopped = new AbortController();
    alreadyStopped.abort('parent already stopped');
    const immediate = combineCodexSubagentAbortSignalsFallback([
      alreadyStopped.signal,
      new AbortController().signal,
    ]);
    assert.equal(immediate.aborted, true);
    assert.equal(immediate.reason, 'parent already stopped');
  });

  it('translates Codex hosted web search only for providers with a real SDK tool', () => {
    const descriptors = [{ rawType: 'web_search', payload: { type: 'web_search' } }];
    assert.deepEqual(
      Object.keys(buildCodexHostedSearchTools(descriptors, { sdkType: 'xai' })).sort(),
      ['x_search'],
    );
    assert.deepEqual(
      Object.keys(buildCodexHostedSearchTools(undefined, { sdkType: 'xai' })),
      ['x_search'],
      'xAI route mounts its native hosted tool even when Codex did not advertise generic web_search',
    );
    assert.deepEqual(
      Object.keys(buildCodexHostedSearchTools(descriptors, {
        sdkType: 'openai',
        useResponsesApi: true,
      })),
      ['web_search'],
    );
    assert.deepEqual(
      Object.keys(buildCodexHostedSearchTools(descriptors, {
        sdkType: 'openai',
        useResponsesApi: false,
      })),
      [],
    );
    assert.deepEqual(
      Object.keys(buildCodexHostedSearchTools(descriptors, { sdkType: 'anthropic' }, true)),
      [],
    );
  });
});

describe('Claude Code managed Provider + Model sub-agent routing', () => {
  const routes: ClaudeSubagentRoute[] = [
    {
      providerId: 'kimi-provider',
      providerName: 'Kimi Coding Plan',
      modelId: 'sonnet',
      upstreamModelId: 'kimi-for-coding',
      displayName: 'Kimi for Coding',
    },
    {
      providerId: 'glm-provider',
      providerName: 'GLM Coding Plan',
      modelId: 'glm-5',
      displayName: 'GLM-5',
    },
  ];

  it('resolves only an exact catalog provider/model pair, including canonical upstream IDs', () => {
    assert.equal(findClaudeSubagentRoute(routes, 'kimi-provider', 'sonnet')?.displayName, 'Kimi for Coding');
    assert.equal(findClaudeSubagentRoute(routes, 'kimi-provider', 'kimi-for-coding')?.modelId, 'sonnet');
    assert.equal(findClaudeSubagentRoute(routes, 'kimi-provider', 'grok-4.5'), undefined);
    assert.equal(findClaudeSubagentRoute(routes, 'xai-provider', 'sonnet'), undefined);
  });

  it('correlates each SDK tool-use id to exactly one durable physical attempt', () => {
    const correlation = createClaudeSubagentToolUseCorrelation();
    const firstAttempt = {
      prompt: 'Research the current release.',
      agent_name: 'Researcher',
      provider_id: 'kimi-provider',
      model: 'sonnet',
      required_capabilities: ['network_search'],
    };
    correlation.record('call-first', firstAttempt);
    correlation.record('call-first', firstAttempt);
    assert.equal(correlation.claim(firstAttempt), 'call-first');
    assert.equal(correlation.claim(firstAttempt), undefined, 'a duplicate hook id must be claimed once');

    const retryAttempt = {
      ...firstAttempt,
      logical_run_id: 'call-first',
    };
    correlation.record('call-retry', retryAttempt);
    assert.equal(correlation.claim(retryAttempt), 'call-retry');
    assert.equal(correlation.claim(firstAttempt), undefined, 'retry input must not cross attempts');
  });

  it('prefers the newest SDK id when identical stale and current calls coexist', () => {
    const correlation = createClaudeSubagentToolUseCorrelation();
    const input = {
      prompt: 'Same request',
      provider_id: 'glm-provider',
      model: 'glm-5',
      required_capabilities: [],
    };
    correlation.record('call-stale', input);
    correlation.record('call-current', input);
    assert.equal(correlation.claim(input), 'call-current');
    assert.equal(correlation.claim(input), 'call-stale');
  });

  it('tells the parent to fail closed instead of substituting Sonnet for an unavailable model', () => {
    const guidance = getClaudeSubagentRoutingGuidance(routes);
    assert.match(guidance, /provider_id="kimi-provider", model="sonnet"/);
    assert.match(guidance, /Never substitute sonnet\/opus\/haiku/);
    assert.match(guidance, /SUBAGENT_MODEL_UNAVAILABLE/);
    assert.match(guidance, /one-shot foreground run/);
    assert.match(guidance, /returns only after the child reaches a terminal status/);
    assert.match(guidance, /Never describe a returned call as merely submitted, launched, queued, still processing/);
    assert.match(guidance, /workflow_id, a unique task_key per child, and depends_on/);
    assert.match(guidance, /injects the upstream results when the downstream Runtime actually starts/);
    assert.match(guidance, /Never spawn a child just to confirm, stand by, or wait/);
    assert.match(guidance, /rejects logical_run_id reuse while its prior attempt is running\/settling or after it completed successfully/);
    assert.match(guidance, /inherits the parent turn's available Claude Code built-ins/);
    assert.match(guidance, /WebSearch\/WebFetch, file edits, and shell are allowed/);
    assert.match(guidance, /pass source URLs beside the claims they support/);
    assert.match(guidance, /idle timeout renews whenever the SDK emits child activity/);
    assert.match(guidance, /Never silently fall back, attribute parent work to the failed child/);
    assert.match(guidance, /catalog-compatible candidates, not entitlement proof/);
  });

  it('fails closed only when the parent tool surface really lacks a required capability', () => {
    assert.deepEqual(validateClaudeSubagentCapabilities([]), { ok: true });
    assert.deepEqual(validateClaudeSubagentCapabilities(['read_workspace']), { ok: true });
    assert.deepEqual(
      validateClaudeSubagentCapabilities(['network_search', 'write_workspace']),
      { ok: true },
    );
    assert.deepEqual(
      validateClaudeSubagentCapabilities(
        ['network_search', 'write_workspace', 'network_search'],
        { tools: ['Read', 'Glob', 'Grep'], permissionMode: 'plan' },
      ),
      { ok: false, unsupported: ['network_search', 'write_workspace'] },
    );
    assert.deepEqual(
      validateClaudeSubagentCapabilities(
        ['read_workspace', 'network_search', 'write_workspace'],
        {
          tools: ['Read', 'Glob', 'Grep'],
          permissionMode: 'default',
          mcpServers: {
            'codepilot-memory': {} as never,
          },
        },
      ),
      { ok: false, unsupported: ['network_search', 'write_workspace'] },
      'a local memory MCP must not manufacture live network or write capability',
    );
  });

  it('never treats an SDK success envelope with is_error=true as completed', () => {
    const outcome = normalizeClaudeSubagentTerminalResult({
      type: 'result',
      subtype: 'success',
      is_error: true,
      api_error_status: 403,
      result: 'Failed to authenticate. API Error: 403 Access to model denied.',
    } as unknown as SDKResultSuccess);
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.error?.code, 'AUTH_FORBIDDEN');
    assert.equal(outcome.error?.httpStatus, 403);
    assert.match(outcome.text, /Access to model denied/);
  });

  it('maps clean success and is_error without an HTTP status from structured fields', () => {
    const completed = normalizeClaudeSubagentTerminalResult({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Done',
    } as unknown as SDKResultSuccess);
    assert.deepEqual(completed, { status: 'completed', text: 'Done' });

    const failed = normalizeClaudeSubagentTerminalResult({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Provider rejected the request',
    } as unknown as SDKResultSuccess);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error?.code, 'RUNTIME_ERROR');
    assert.notEqual(failed.status, 'completed');
  });

  it('maps maxTurns to partial and preserves the last child text', () => {
    const outcome = normalizeClaudeSubagentTerminalResult({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      errors: ['Maximum turns reached'],
      stop_reason: null,
    } as unknown as SDKResultError, 'Partial research notes');
    assert.equal(outcome.status, 'partial');
    assert.equal(outcome.error?.code, 'MAX_TURNS');
    assert.equal(outcome.text, 'Partial research notes');
  });

  it('distinguishes parent cancellation from child timeout', () => {
    assert.deepEqual(normalizeClaudeSubagentInterruption({
      parentAborted: true,
      displayName: 'Researcher',
      timeoutMs: 300_000,
      partialText: 'Two sources collected.',
    }), {
      status: 'cancelled',
      text: 'Two sources collected.\n\nSUBAGENT_CANCELLED: the parent turn was cancelled.',
    });
    const timedOut = normalizeClaudeSubagentInterruption({
      parentAborted: false,
      displayName: 'Researcher',
      timeoutMs: 300_000,
      timeoutKind: 'idle',
      partialText: 'One verified source.',
    });
    assert.equal(timedOut.status, 'timed_out');
    assert.equal(timedOut.error?.code, 'TIMEOUT');
    assert.match(timedOut.text, /300-second/);
    assert.match(timedOut.text, /idle limit/);
    assert.match(timedOut.text, /One verified source/);
  });

  it('renews the idle deadline on SDK activity while preserving a hard cap', async () => {
    const idleController = new AbortController();
    const idleTimeout = createClaudeSubagentActivityTimeout({
      abortController: idleController,
      idleTimeoutMs: 100,
      hardTimeoutMs: 500,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    idleTimeout.markActivity();
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    assert.equal(idleController.signal.aborted, false, 'activity must renew the idle deadline');
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    assert.equal(idleController.signal.aborted, true);
    assert.equal(idleTimeout.getTimeoutKind(), 'idle');
    idleTimeout.clear();

    const hardController = new AbortController();
    const hardTimeout = createClaudeSubagentActivityTimeout({
      abortController: hardController,
      idleTimeoutMs: 500,
      hardTimeoutMs: 100,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    hardTimeout.markActivity();
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    assert.equal(hardController.signal.aborted, true, 'activity must not renew the hard cap');
    assert.equal(hardTimeout.getTimeoutKind(), 'hard');
    hardTimeout.clear();
  });

  it('registers the managed tool as a first-class Sub Agent tool', () => {
    const server = createClaudeSubagentMcpServer({
      sessionId: 'session-1',
      workingDirectory: '/tmp',
      routes,
    }) as unknown as { instance: { _registeredTools: Record<string, unknown> } };
    assert.ok(server.instance._registeredTools.codepilot_spawn_subagent);
    assert.equal(isClaudeManagedSubagentToolName('mcp__codepilot-subagent__codepilot_spawn_subagent'), true);
  });

  it('inherits MCP transport and the parent approval callback without letting MCP presence prove capabilities', () => {
    const canUseTool = async () => ({ behavior: 'deny' as const, message: 'test' });
    const inherited = buildClaudeSubagentToolOptions({
      tools: ['Read', 'Glob', 'Grep'],
      permissionMode: 'default',
      canUseTool,
      mcpServers: {
        'codepilot-subagent': {} as never,
        'unknown-mcp': {} as never,
      },
    });
    assert.deepEqual(validateClaudeSubagentCapabilities(
      ['read_workspace', 'network_search', 'write_workspace'],
      inherited,
    ), { ok: false, unsupported: ['network_search', 'write_workspace'] });
    assert.equal(inherited.canUseTool, canUseTool);
    assert.ok(inherited.mcpServers && 'unknown-mcp' in inherited.mcpServers);
    assert.ok(!inherited.mcpServers || !('codepilot-subagent' in inherited.mcpServers));
    assert.ok(inherited.disallowedTools?.includes('Agent'));
    assert.ok(inherited.disallowedTools?.includes('Task'));
    assert.deepEqual(validateClaudeSubagentCapabilities(
      ['read_workspace', 'network_search', 'write_workspace'],
      {
        tools: ['Read', 'WebSearch', 'Write'],
        permissionMode: 'default',
      },
    ), { ok: true });
    assert.deepEqual(validateClaudeSubagentCapabilities(
      ['write_workspace'],
      { tools: ['Read', 'Glob', 'Grep'], permissionMode: 'plan' },
    ), { ok: false, unsupported: ['write_workspace'] });
  });

  it('turns malformed capability arrays into a structured application error', () => {
    const malformed = normalizeClaudeSubagentCapabilities([null, true]);
    assert.equal(malformed.ok, false);
    if (!malformed.ok) {
      assert.equal(malformed.error.code, 'INVALID_SUBAGENT_SPEC');
      assert.match(malformed.message, /do not send null or boolean placeholders/);
    }
    assert.deepEqual(normalizeClaudeSubagentCapabilities([
      'network_search',
      'network_search',
      'read_workspace',
    ]), {
      ok: true,
      capabilities: ['network_search', 'read_workspace'],
    });
  });

  it('wraps the inherited approval callback with the managed child identity', async () => {
    let observed: ReturnType<typeof getClaudeSubagentPermissionAttribution>;
    const canUseTool = async (
      _toolName: string,
      _input: Record<string, unknown>,
      context: unknown,
    ) => {
      observed = getClaudeSubagentPermissionAttribution(context);
      return { behavior: 'deny' as const, message: 'test' };
    };
    const attribution = {
      agentRunId: 'claude-run-1',
      childSessionId: 'claude-child-1',
      agentName: 'Frontend engineer',
    };
    const inherited = buildClaudeSubagentToolOptions({
      canUseTool: canUseTool as never,
    }, attribution);
    await inherited.canUseTool?.('Write', { file_path: 'index.ts' }, {
      signal: new AbortController().signal,
      toolUseID: 'tool-1',
    });
    assert.deepEqual(observed, attribution);
  });

  it('serializes write-capable children that share a working directory', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const workingDirectory = `/tmp/codepilot-subagent-write-${process.pid}`;
    const first = serializeClaudeSubagentWriteRun(
      workingDirectory,
      undefined,
      async () => {
        order.push('first:start');
        await firstGate;
        order.push('first:end');
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const second = serializeClaudeSubagentWriteRun(
      workingDirectory,
      undefined,
      async () => {
        order.push('second:start');
        order.push('second:end');
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ['first:start'], 'the second writer must wait for the first');
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, [
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ]);
  });

  it('returns a structured capability failure before spawning a child', async () => {
    const server = createClaudeSubagentMcpServer({
      sessionId: 'session-capability-negative',
      workingDirectory: '/tmp',
      routes,
      getParentToolOptions: () => ({
        tools: ['Read', 'Glob', 'Grep'],
        mcpServers: {
          'codepilot-memory': {} as never,
        },
      }),
    }) as unknown as {
      instance: {
        _registeredTools: Record<string, {
          handler: (input: Record<string, unknown>) => Promise<{
            content: Array<{ type: string; text: string }>;
            isError?: boolean;
          }>;
        }>;
      };
    };
    const registered = server.instance._registeredTools.codepilot_spawn_subagent;
    assert.ok(registered);
    const result = await registered.handler({
      prompt: 'Search X for yesterday\'s AI news',
      agent_name: 'X researcher',
      provider_id: 'kimi-provider',
      model: 'sonnet',
      required_capabilities: ['network_search'],
    });
    assert.equal(result.isError, true);
    const parsed = parseSubagentStatusResult(result.content[0]?.text);
    assert.equal(parsed.metadata?.status, 'failed');
    assert.equal(parsed.metadata?.error?.code, 'CAPABILITY_UNAVAILABLE');
    assert.match(parsed.body || '', /Do not continue with stale local knowledge/);
  });

  it('refuses to launch a Claude child when its durable parent/run cannot be created', async () => {
    const server = createClaudeSubagentMcpServer({
      sessionId: 'missing-parent-session',
      workingDirectory: '/tmp',
      routes,
      getParentToolOptions: () => ({ tools: ['Read'] }),
    }) as unknown as {
      instance: {
        _registeredTools: Record<string, {
          handler: (input: Record<string, unknown>) => Promise<{
            content: Array<{ type: string; text: string }>;
            isError?: boolean;
          }>;
        }>;
      };
    };
    const result = await server.instance._registeredTools.codepilot_spawn_subagent.handler({
      prompt: 'Read the workspace.',
      agent_name: 'Reader',
      provider_id: 'kimi-provider',
      model: 'sonnet',
      required_capabilities: ['read_workspace'],
    });
    const parsed = parseSubagentStatusResult(result.content[0]?.text);
    assert.equal(result.isError, true);
    assert.equal(parsed.metadata?.status, 'failed');
    assert.equal(parsed.metadata?.error?.code, 'RUNTIME_ERROR');
    assert.match(parsed.body || '', /SUBAGENT_RUN_PERSISTENCE_UNAVAILABLE/);
  });

  it('restores Kimi/GLM protocol aliases without hiding a real model mismatch', () => {
    const kimiRoute = routes[0];
    assert.ok(kimiRoute);
    const resolved = { model: 'sonnet', upstreamModel: 'kimi-for-coding' };
    assert.equal(
      normalizeClaudeSubagentEffectiveModel('sonnet', kimiRoute, resolved),
      'Kimi for Coding',
    );
    assert.equal(
      normalizeClaudeSubagentEffectiveModel('kimi-for-coding', kimiRoute, resolved),
      'Kimi for Coding',
    );
    assert.equal(
      normalizeClaudeSubagentEffectiveModel('claude-sonnet-4-6', kimiRoute, resolved),
      'claude-sonnet-4-6',
      'a genuinely different SDK report must remain visible',
    );
    assert.equal(claudeReportedModelMatchesRoute('sonnet', kimiRoute, resolved), true);
    assert.equal(claudeReportedModelMatchesRoute('kimi-for-coding', kimiRoute, resolved), true);
    assert.equal(
      claudeReportedModelMatchesRoute('claude-sonnet-4-6', kimiRoute, resolved),
      false,
      'the Claude adapter must fail closed when the SDK reports a different model',
    );
  });

  it('keeps source provenance and anti-fabrication rules in the Claude child prompt', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/claude-subagent-mcp.ts'),
      'utf8',
    );
    assert.match(source, /Keep source URLs attached to the claims they support/);
    assert.match(source, /never fill missing details from training knowledge/);
    assert.match(source, /report only paths that a completed tool call actually created or modified/);
  });
});

describe('sub-agent transcript view and workspace tab', () => {
  it('recognizes native, Claude SDK, and Codex collaboration tool names', () => {
    assert.equal(isSubagentToolName('Agent'), true);
    assert.equal(isSubagentToolName('Task'), true);
    assert.equal(isSubagentToolName('codex_subagent'), true);
    assert.equal(isSubagentToolName('codex_collaboration_wait'), false);
    assert.equal(isSubagentToolName('mcp__codepilot-subagent__codepilot_spawn_subagent'), true);
    assert.equal(isSubagentToolName('Bash'), false);
  });

  it('hides legacy anonymous Codex wait capsules after refresh while preserving identity-bound children', () => {
    const anonymousWait = {
      type: 'collabAgentToolCall',
      id: 'wait-call-anonymous',
      tool: 'wait',
      status: 'inProgress',
      receiverThreadIds: [],
      agentsStates: {},
    };
    assert.equal(
      isSubagentToolCall('codex_subagent', anonymousWait, JSON.stringify({
        ...anonymousWait,
        status: 'completed',
      })),
      false,
    );

    const identityBoundWait = {
      ...anonymousWait,
      id: 'wait-call-child',
      receiverThreadIds: ['child-thread-1'],
      agentsStates: { 'child-thread-1': { status: 'running' } },
    };
    assert.equal(
      isSubagentToolCall('codex_subagent', identityBoundWait, JSON.stringify({
        ...identityBoundWait,
        status: 'completed',
      })),
      true,
    );
    assert.equal(isSubagentToolCall('Agent', { prompt: 'Review' }), true);
    assert.equal(isSubagentToolCall('Bash', { command: 'pwd' }), false);
  });

  it('shows the catalog-verified model name instead of an SDK role alias', () => {
    const view = buildSubagentRunView({
      id: 'run-managed',
      name: 'mcp__codepilot-subagent__codepilot_spawn_subagent',
      toolInput: {
        agent_name: 'Kimi writer',
        provider_id: 'kimi-provider',
        model: 'sonnet',
        requested_model: 'Kimi for Coding',
        prompt: 'Draft copy',
      },
    });
    assert.equal(view.agentName, 'Kimi writer');
    assert.equal(view.requestedModel, 'Kimi for Coding');
    assert.equal(view.runtime, 'claude_code');
    assert.equal(view.status, 'running');
  });

  it('separates requested/effective model and strips Native result metadata', () => {
    const view = buildSubagentRunView({
      id: 'run-1',
      name: 'Agent',
      toolInput: { agent: 'explore', model: 'deepseek-v3.2', prompt: 'Find the call site' },
      result: 'Sub-agent: Explore\nModel: deepseek-v3.2\nRun: run-1\n\nFound it.',
    });
    assert.equal(view.requestedModel, 'deepseek-v3.2');
    assert.equal(view.effectiveModel, 'deepseek-v3.2');
    assert.equal(view.runtime, 'codepilot_runtime');
    assert.equal(view.result, 'Found it.');
    assert.equal(view.status, 'completed');
    assert.equal(view.icon, 'search');
  });

  it('keeps Claude async launch receipts running until a terminal lifecycle update arrives', () => {
    const launched = buildSubagentRunView({
      id: 'run-async',
      name: 'Agent',
      toolInput: { subagent_type: 'codepilot-readonly', model: 'sonnet', prompt: 'Research' },
      result: JSON.stringify({ status: 'async_launched', agentId: 'agent-1' }),
    });
    assert.equal(launched.status, 'running');

    const completed = buildSubagentRunView({
      id: 'run-async',
      name: 'Agent',
      toolInput: { subagent_type: 'codepilot-readonly', model: 'sonnet', prompt: 'Research' },
      result: encodeSubagentStatusResult(
        { status: 'completed', taskId: 'task-1', runtime: 'claude_code' },
        'Research complete',
      ),
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.runtime, 'claude_code');
    assert.equal(completed.result, 'Research complete');
  });

  it('never promotes spawn acknowledgement text to completed without a terminal fact', () => {
    const managedReceipt = buildSubagentRunView({
      id: 'run-managed-receipt',
      name: 'codepilot_spawn_subagent',
      toolInput: { agent_name: 'Researcher', model: 'qwen', prompt: 'Research' },
      result: 'Task submitted successfully and processing will continue.',
    });
    assert.equal(managedReceipt.status, 'running');

    const sdkBackgroundReceipt = buildSubagentRunView({
      id: 'run-sdk-background',
      name: 'Agent',
      toolInput: {
        subagent_type: 'researcher',
        run_in_background: true,
        prompt: 'Research',
      },
      result: 'Task accepted.',
    });
    assert.equal(sdkBackgroundReceipt.status, 'running');
  });

  it('uses Codex agentsStates facts instead of treating collaboration action completion as child completion', () => {
    const running = buildSubagentRunView({
      id: 'wait-call-1',
      name: 'codex_subagent',
      toolInput: {
        type: 'collabAgentToolCall',
        id: 'wait-call-1',
        tool: 'wait',
        status: 'inProgress',
        receiverThreadIds: ['child-1'],
        agentsStates: { 'child-1': { status: 'running', message: 'Reviewing' } },
      },
      result: JSON.stringify({
        type: 'collabAgentToolCall',
        id: 'wait-call-1',
        tool: 'wait',
        status: 'completed',
        receiverThreadIds: ['child-1'],
        agentsStates: { 'child-1': { status: 'running', message: 'Still reviewing' } },
        model: 'gpt-5.6-sol',
        prompt: 'Review this patch',
      }),
    });
    assert.equal(running.status, 'running');
    assert.equal(running.id, 'child-1');
    assert.equal(running.attemptId, 'wait-call-1');
    assert.equal(running.currentActivity, 'Still reviewing');
    assert.equal(running.requestedModel, 'gpt-5.6-sol');
    assert.equal(running.prompt, 'Review this patch');

    const completed = buildSubagentRunView({
      id: 'wait-call-2',
      name: 'codex_subagent',
      toolInput: {
        type: 'collabAgentToolCall',
        id: 'wait-call-2',
        tool: 'wait',
        status: 'inProgress',
        receiverThreadIds: ['child-1'],
      },
      result: JSON.stringify({
        type: 'collabAgentToolCall',
        id: 'wait-call-2',
        tool: 'wait',
        status: 'completed',
        receiverThreadIds: ['child-1'],
        agentsStates: { 'child-1': { status: 'completed' } },
      }),
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.id, 'child-1');

    const actionFailedButChildUnknown = buildSubagentRunView({
      id: 'wait-call-3',
      name: 'codex_subagent',
      toolInput: {
        type: 'collabAgentToolCall',
        id: 'wait-call-3',
        tool: 'wait',
        receiverThreadIds: ['child-1'],
      },
      result: JSON.stringify({
        type: 'collabAgentToolCall',
        id: 'wait-call-3',
        tool: 'wait',
        status: 'failed',
        receiverThreadIds: ['child-1'],
        agentsStates: {},
      }),
    });
    assert.equal(
      actionFailedButChildUnknown.status,
      'running',
      'a failed wait action is not proof that the child failed',
    );
  });

  it('round-trips partial and timed-out status metadata with structured errors', () => {
    const encodedPartial = encodeSubagentStatusResult({
      status: 'partial',
      runtime: 'claude_code',
      error: { code: 'MAX_TURNS', retryable: false },
    }, 'Some results');
    assert.match(encodedPartial, /"terminal":true/);
    assert.match(encodedPartial, /TERMINAL: the child has stopped; no background run remains/);
    const partial = parseSubagentStatusResult(encodedPartial);
    assert.equal(partial.metadata?.status, 'partial');
    assert.equal(partial.metadata?.error?.code, 'MAX_TURNS');
    assert.equal(partial.body, 'Some results', 'lifecycle guidance is model-only and must not leak into the UI transcript');

    const runningWire = encodeSubagentStatusResult({
      status: 'running',
      runtime: 'claude_code',
    }, 'Started');
    assert.match(runningWire, /"terminal":false/);
    assert.match(runningWire, /RUNNING: this is a progress\/launch receipt, not task completion/);

    const timedOut = buildSubagentRunView({
      id: 'run-timeout',
      name: 'mcp__codepilot-subagent__codepilot_spawn_subagent',
      toolInput: { agent_name: 'Researcher', model: 'sonnet', prompt: 'Research' },
      result: encodeSubagentStatusResult({
        status: 'timed_out',
        runtime: 'claude_code',
        error: { code: 'TIMEOUT', retryable: true },
      }, 'Timed out'),
      isError: true,
    });
    assert.equal(timedOut.status, 'timed_out');
    assert.equal(timedOut.error?.code, 'TIMEOUT');

    const forbidden = buildSubagentRunView({
      id: 'run-forbidden',
      name: 'mcp__codepilot-subagent__codepilot_spawn_subagent',
      toolInput: { agent_name: 'Qwen researcher', model: 'qwen3.8-max-preview', prompt: 'Research' },
      result: encodeSubagentStatusResult({
        status: 'failed',
        runtime: 'claude_code',
        error: { code: 'AUTH_FORBIDDEN', httpStatus: 403, retryable: false },
      }, 'Access to model denied'),
      isError: true,
    });
    assert.equal(forbidden.status, 'failed');
    assert.equal(forbidden.error?.httpStatus, 403);

    for (const code of [
      'LOGICAL_RUN_STILL_RUNNING',
      'LOGICAL_RUN_ALREADY_COMPLETED',
    ] as const) {
      const rejectedRetry = parseSubagentStatusResult(encodeSubagentStatusResult({
        status: 'failed',
        runtime: 'claude_code',
        error: { code, retryable: false },
      }, code));
      assert.equal(rejectedRetry.metadata?.error?.code, code);
      assert.equal(rejectedRetry.metadata?.error?.retryable, false);
    }
  });

  it('collapses retry attempts into one logical capsule and keeps the latest attempt', () => {
    const first = buildSubagentRunView({
      id: 'tool-call-1',
      name: 'codepilot_spawn_subagent',
      toolInput: {
        logical_run_id: 'logical-research',
        agent_name: 'Researcher',
        model: 'qwen',
      },
      result: encodeSubagentStatusResult({
        status: 'failed',
        phase: 'terminal',
        logicalRunId: 'logical-research',
        attemptId: 'tool-call-1',
        attemptNumber: 1,
        runtime: 'codepilot_runtime',
        error: { code: 'RATE_LIMITED', retryable: true },
      }),
    });
    const second = buildSubagentRunView({
      id: 'tool-call-2',
      name: 'codepilot_spawn_subagent',
      toolInput: {
        logical_run_id: 'logical-research',
        agent_name: 'Researcher',
        model: 'qwen',
      },
      result: encodeSubagentStatusResult({
        status: 'completed',
        phase: 'terminal',
        logicalRunId: 'logical-research',
        attemptId: 'tool-call-2',
        attemptNumber: 2,
        runtime: 'codepilot_runtime',
      }, 'Done'),
    });
    const collapsed = collapseLogicalSubagentRuns([first, second]);
    assert.equal(collapsed.length, 1);
    assert.equal(collapsed[0]?.id, 'logical-research');
    assert.equal(collapsed[0]?.attemptId, 'tool-call-2');
    assert.equal(collapsed[0]?.attemptCount, 2);
    assert.equal(collapsed[0]?.status, 'completed');
  });

  it('updates a selected agent-run tab by run id without persisting transcript content', () => {
    const running = buildSubagentRunView({
      id: 'run-2',
      name: 'Task',
      toolInput: { subagent_type: 'reviewer', model: 'sonnet', prompt: 'Review' },
    });
    const first = openDynamicTab(initialState(), agentRunTabFromView(running));
    assert.equal(first.activeTabId, 'agent-run:run-2');
    assert.equal(first.tabs.length, 3);

    const restored = parse(JSON.stringify(serialize(first)));
    assert.equal(restored.tabs.length, 2, 'agent prompts/results are not duplicated into localStorage');

    const completed = { ...running, status: 'completed' as const, result: 'Done' };
    const updated = openDynamicTab(first, agentRunTabFromView(completed));
    assert.equal(updated.tabs.length, 3, 'same run updates in place instead of duplicating the tab');
    const tab = updated.tabs.find(candidate => candidate.id === 'agent-run:run-2');
    assert.ok(tab && tab.kind === 'agent-run');
    if (tab?.kind === 'agent-run') assert.equal(tab.run.result, 'Done');
  });
});

describe('runtime adapter safety contracts', () => {
  const kimiContext: ClaudeSubagentRoutingContext = {
    providerName: 'Kimi Coding Plan',
    parentModel: 'sonnet',
    providerCompatible: true,
    availableModels: [
      { modelId: 'sonnet', upstreamModelId: 'kimi-for-coding', displayName: 'Kimi for Coding' },
    ],
    roleModels: {
      default: 'kimi-for-coding',
      sonnet: 'kimi-for-coding',
      opus: 'kimi-for-coding',
      haiku: 'kimi-for-coding',
    },
  };
  const multiModelContext: ClaudeSubagentRoutingContext = {
    providerName: 'Volcengine Ark',
    parentModel: 'deepseek-v3.2',
    providerCompatible: true,
    availableModels: [
      { modelId: 'deepseek-v3.2', displayName: 'DeepSeek V3.2' },
      { modelId: 'glm-4.7', displayName: 'GLM-4.7' },
      { modelId: 'kimi-k2.5', displayName: 'Kimi K2.5' },
    ],
    roleModels: {
      default: 'deepseek-v3.2',
      sonnet: 'glm-4.7',
      opus: 'deepseek-v3.2',
      haiku: 'kimi-k2.5',
    },
  };

  it('routes logical-run start rejections through every managed Runtime adapter', () => {
    for (const relativePath of [
      'src/lib/tools/agent.ts',
      'src/lib/claude-subagent-mcp.ts',
      'src/lib/codex/proxy/builtin-bridge.ts',
    ]) {
      const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
      assert.match(
        source,
        /describeSubagentRunStartRejection\(persistenceError\)/,
        `${relativePath} must preserve logical conflict codes instead of flattening them to RUNTIME_ERROR`,
      );
      assert.match(source, /rejection\?\.error/);
      assert.match(source, /rejection\?\.message/);
    }
  });

  it('accepts Codex route aliases but rejects a silently substituted model', () => {
    const route: SubagentRoute = {
      providerId: 'provider-qwen',
      providerName: 'Qwen Coding Plan',
      id: 'qwen3.8-max-preview',
      upstreamId: 'qwen/qwen3.8-max-preview',
      displayName: 'Qwen 3.8 Max Preview',
    };
    assert.equal(codexReportedModelMatchesRoute('qwen3.8-max-preview', route), true);
    assert.equal(codexReportedModelMatchesRoute('qwen/qwen3.8-max-preview', route), true);
    assert.equal(codexReportedModelMatchesRoute('Qwen 3.8 Max Preview', route), true);
    assert.equal(codexReportedModelMatchesRoute('gpt-5.6', route), false);
  });

  it('shows the verified Codex route identity instead of a protocol selector', () => {
    const kimiRoute: SubagentRoute = {
      providerId: 'kimi-provider',
      providerName: 'Kimi Coding Plan',
      id: 'sonnet',
      upstreamId: 'kimi-for-coding',
      displayName: 'Kimi for Coding',
    };
    assert.equal(
      normalizeCodexSubagentEffectiveModel('sonnet', kimiRoute),
      'Kimi for Coding',
    );
    assert.equal(
      normalizeCodexSubagentEffectiveModel('kimi-for-coding', kimiRoute),
      'Kimi for Coding',
    );
    assert.equal(
      normalizeCodexSubagentEffectiveModel('gpt-5.6', kimiRoute),
      'gpt-5.6',
      'a real mismatch must stay visible and must not be relabelled as Kimi',
    );
  });

  it('keeps the raw Codex model report as a lifecycle breadcrumb', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/codex/subagent.ts'),
      'utf8',
    );
    assert.match(source, /runtimeReportedModel:\s*started\.model/);
    assert.match(
      source,
      /\.\.\.\(effectiveModel\s*\?\s*\{\s*effectiveModel\s*\}\s*:\s*\{\}\)/,
      'the runtime-init event must also carry the normalized user-facing identity',
    );
  });

  it('does not synthesize inheriting or provider-relative SDK Agent profiles', () => {
    assert.deepEqual(getRegisteredAgents(), {});
    assert.deepEqual(getRegisteredAgents(kimiContext), {});
    const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/claude-client.ts'), 'utf8');
    assert.match(source, /createClaudeSubagentMcpServer/);
    assert.doesNotMatch(source, /\.\.\.getRegisteredAgents\(claudeSubagentRouting\)/);
  });

  it('rejects a direct full-ID override that the Agent tool schema cannot route', () => {
    const rejected = validateClaudeSubagentToolInput('Agent', {
      subagent_type: 'codepilot-readonly',
      model: 'grok-4.5',
    }, {}, kimiContext);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.equal(rejected.code, 'SUBAGENT_MODEL_UNAVAILABLE');
      assert.match(rejected.message, /Do not continue as if the sub-agent ran/);
    }
    assert.deepEqual(validateClaudeSubagentToolInput(
      'Agent',
      { model: 'sonnet' },
      {},
      kimiContext,
    ), { ok: true });
  });

  it('accepts Kimi, GLM, and DeepSeek only when the selected provider route really resolves to them', () => {
    const kimiAgentName = 'kimi-worker';
    const kimiAgents = {
      [kimiAgentName]: {
        description: 'Kimi worker',
        prompt: 'Write',
        model: 'kimi-for-coding',
      },
    };
    assert.deepEqual(validateClaudeSubagentToolInput('Agent', {
      subagent_type: kimiAgentName,
      prompt: 'You are a Kimi writing expert. Draft the copy.',
    }, kimiAgents, kimiContext), { ok: true });

    const glmAgentName = 'glm-worker';
    const multiAgents = {
      [glmAgentName]: {
        description: 'GLM worker',
        prompt: 'Review',
        model: 'glm-4.7',
      },
    };
    assert.deepEqual(validateClaudeSubagentToolInput('Agent', {
      subagent_type: glmAgentName,
      prompt: '你是 GLM 专家，请审查这个方案。',
    }, multiAgents, multiModelContext), { ok: true });
    assert.deepEqual(validateClaudeSubagentToolInput('Agent', {
      model: 'opus',
      prompt: 'You are a DeepSeek writing expert. Draft the copy.',
    }, multiAgents, multiModelContext), { ok: true });
  });

  it('rejects prompt-level model masquerading when the selected child route is different', () => {
    const agents = {
      'codepilot-readonly': {
        description: 'Read-only worker',
        prompt: 'Research',
      },
    };
    const rejected = validateClaudeSubagentToolInput('Agent', {
      subagent_type: 'codepilot-readonly',
      prompt: '你是 Grok 专家。请检索昨天 Twitter 上最热门的 AI 信息。',
    }, agents, multiModelContext);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.equal(rejected.requestedModel, 'Grok');
      assert.match(rejected.message, /cannot route sub-agent model "Grok"/);
    }
    assert.equal(validateClaudeSubagentToolInput('Agent', {
      model: 'sonnet',
      prompt: 'You are a Kimi writing expert. Draft the copy.',
    }, agents, multiModelContext).ok, false, 'the GLM-mapped sonnet role must not masquerade as Kimi');

    assert.deepEqual(validateClaudeSubagentToolInput('Agent', {
      prompt: 'Research how the Grok API handles structured output.',
    }, agents, multiModelContext), { ok: true }, 'ordinary subject mentions must remain valid research tasks');
  });

  it('installs a PreToolUse hard gate instead of relying only on canUseTool', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/claude-client.ts'), 'utf8');
    assert.match(source, /PreToolUse:[\s\S]{0,2500}validateClaudeSubagentToolInput/);
    assert.match(source, /permissionDecision:\s*'deny'/);
    assert.match(source, /emitSubagentModelUnavailable\(validation, toolUseId\)/);
    assert.match(source, /claudeSubagentToolUseCorrelation\.record\(\s*toolUseId/);
  });

  it('lets managed children own timeout semantics and preserves stream errors as JSON', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/claude-client.ts'), 'utf8');
    assert.match(
      source,
      /!isClaudeManagedSubagentToolName\(progressMsg\.tool_name\)[\s\S]{0,180}toolTimeoutSeconds > 0/,
    );
    assert.match(
      source,
      /console\.error\(`\[claude-client\] Stream error: \$\{formatClaudeStreamErrorDiagnostic\(error\)\}`\)/,
    );

    const error = new Error('parent stream failed') as Error & {
      code?: string;
      cause?: Error;
    };
    error.code = 'EPIPE';
    error.cause = new Error('child pipe closed');
    const diagnostic = JSON.parse(formatClaudeStreamErrorDiagnostic(error)) as {
      message?: string;
      code?: string;
      cause?: { message?: string };
    };
    assert.equal(diagnostic.message, 'parent stream failed');
    assert.equal(diagnostic.code, 'EPIPE');
    assert.equal(diagnostic.cause?.message, 'child pipe closed');
  });

  it('carries child attribution on permission timeout resolution', () => {
    const event = buildPermissionResolvedEvent('perm-1', {
      agentRunId: 'run-1',
      childSessionId: 'sub-1',
    });
    assert.deepEqual(JSON.parse(event.data), {
      permissionRequestId: 'perm-1',
      status: 'timeout',
      agentRunId: 'run-1',
      childSessionId: 'sub-1',
    });
  });

  it('wires managed child attribution into both permission request and timeout events', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/claude-client.ts'), 'utf8');
    assert.match(source, /const childAttribution = getClaudeSubagentPermissionAttribution\(opts\)/);
    assert.match(source, /\.\.\.\(childAttribution \? childAttribution : \{\}\)/);
    assert.match(
      source,
      /buildPermissionResolvedEvent\(\s*permissionRequestId,\s*childAttribution,\s*\)/,
    );
  });
});

describe('sub-agent card presentation contracts', () => {
  it('loads model brand icons without pulling the @lobehub/ui barrel into Node tests', () => {
    const markup = renderToStaticMarkup(
      React.createElement(SubagentModelIcon, { model: 'deepseek-v4-pro' }),
    );
    assert.match(markup, /<svg/);
    assert.match(markup, /DeepSeek/i);
  });

  it('maps common model families to their provider brand icon', () => {
    assert.equal(subagentModelBrand('kimi-k2.7-code'), 'kimi');
    assert.equal(subagentModelBrand('glm-5.2'), 'zhipu');
    assert.equal(subagentModelBrand('grok-4.5'), 'xai');
    assert.equal(subagentModelBrand('deepseek-v4-pro'), 'deepseek');
    assert.equal(subagentModelBrand('qwen3.8-max-preview'), 'qwen');
    assert.equal(subagentModelBrand('MiniMax-M2.5'), 'minimax');
    assert.equal(subagentModelBrand('mimo-v2.5-pro'), 'mimo');
    assert.equal(subagentModelBrand('claude-opus-4-8'), 'anthropic');
  });

  it('renders single-line capsules after output and exposes Details while running', () => {
    const root = process.cwd();
    const streaming = fs.readFileSync(path.join(root, 'src/components/chat/StreamingMessage.tsx'), 'utf8');
    const history = fs.readFileSync(path.join(root, 'src/components/chat/MessageItem.tsx'), 'utf8');
    const card = fs.readFileSync(path.join(root, 'src/components/chat/SubagentCard.tsx'), 'utf8');
    assert.ok(streaming.lastIndexOf('subagentRuns.map') > streaming.lastIndexOf('<StreamingStatusBar'));
    assert.ok(history.lastIndexOf('subagentRuns.map') > history.lastIndexOf('<AssistantContent'));
    assert.match(card, /inline-flex max-w-full items-center/);
    assert.match(card, /data-subagent-logical-run-id/);
    assert.match(card, /data-subagent-attempt-count/);
    assert.match(card, /\{workspace && \(/);
    assert.doesNotMatch(card, /run\.prompt &&/);
    assert.doesNotMatch(card, /run\.status !== 'running'/);
    assert.doesNotMatch(card, /runtimeLabel\(run\.runtime\)/);
    assert.match(card, /after_cursor=\$\{eventCursor\}/);
    assert.match(card, /const eventsById = new Map/);
    assert.match(card, /\.sort\(\(left, right\) => left\.cursor - right\.cursor\)/);
    assert.match(card, /response\.status === 404/);
    assert.match(card, /recordSubagentDetailProbeFailure\(detailKey, 'not_found'\)/);
    assert.match(card, /recordSubagentDetailProbeFailure\(detailKey, 'transient'\)/);
    assert.match(card, /scheduleNext\(decision\.delayMs, true\)/);
    assert.match(card, /getSubagentDetailInitialProbeDelay\(detailKey\)/);
    assert.match(card, /shouldDisplaySubagentRun\(transcriptRun, durableEvidence\)/);
  });

  it('keeps details probes recoverable after bounded 404/5xx bursts', () => {
    resetSubagentDetailProbeStateForTests();
    const key = 'session-1:logical-run-1';
    const startedAt = 10_000;

    for (let attempt = 1; attempt < 5; attempt += 1) {
      const decision = recordSubagentDetailProbeFailure(
        key,
        attempt % 2 === 0 ? 'transient' : 'not_found',
        startedAt,
      );
      assert.deepEqual(decision, {
        delayMs: SUBAGENT_DETAIL_FAST_RETRY_MS,
        burstExhausted: false,
      });
    }
    const cooled = recordSubagentDetailProbeFailure(key, 'not_found', startedAt);
    assert.deepEqual(cooled, {
      delayMs: SUBAGENT_DETAIL_COOLDOWN_MS,
      burstExhausted: true,
    });
    assert.equal(
      getSubagentDetailInitialProbeDelay(key, startedAt + 1_000),
      SUBAGENT_DETAIL_COOLDOWN_MS - 1_000,
      'a remount must respect cooldown rather than permanently stop or restart a 1 Hz flood',
    );
    assert.equal(
      getSubagentDetailInitialProbeDelay(key, startedAt + SUBAGENT_DETAIL_COOLDOWN_MS),
      0,
      'a late durable row must become probeable again without a full-page refresh',
    );
    assert.deepEqual(
      recordSubagentDetailProbeFailure(
        key,
        'transient',
        startedAt + SUBAGENT_DETAIL_COOLDOWN_MS,
      ),
      {
        delayMs: SUBAGENT_DETAIL_COOLDOWN_MS,
        burstExhausted: true,
      },
      'after the initial spawn-race burst, one failed recovery probe must stay low-frequency',
    );
    recordSubagentDetailProbeSuccess(key);
    assert.equal(getSubagentDetailInitialProbeDelay(key, startedAt), 0);
  });

  it('does not treat a production transcript view as durable managed-run evidence', () => {
    const managed = buildSubagentRunView({
      id: 'managed-without-durable-row',
      name: 'mcp__codepilot-subagent__codepilot_spawn_subagent',
      toolInput: {
        agent_name: 'Researcher',
        provider_id: 'missing-provider',
        model: 'missing-model',
        prompt: 'Research.',
      },
    });
    assert.equal(managed.requiresDurableEvidence, true);
    assert.equal(shouldDisplaySubagentRun(managed, 'unknown'), false);
    assert.equal(shouldDisplaySubagentRun(managed, 'missing'), false);
    assert.equal(shouldDisplaySubagentRun(managed, 'found'), true);

    const legacy = buildSubagentRunView({
      id: 'legacy-agent-run',
      name: 'Agent',
      toolInput: { agent: 'explore', prompt: 'Inspect the repository.' },
    });
    assert.equal(legacy.requiresDurableEvidence, false);
    assert.equal(shouldDisplaySubagentRun(legacy, 'unknown'), true);
  });

  it('shows managed child attribution on permission prompts', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/chat/PermissionPrompt.tsx'),
      'utf8',
    );
    assert.match(source, /data-subagent-permission-attribution/);
    assert.match(source, /streaming\.permissionRequestedBySubagent/);
    assert.match(source, /pendingPermission\.agentName/);

    const html = renderToStaticMarkup(
      React.createElement(
        I18nContext.Provider,
        {
          value: {
            locale: 'en',
            setLocale: () => {},
            t: (key, params) => translate('en', key, params),
          },
        },
        React.createElement(PermissionPrompt, {
          pendingPermission: {
            permissionRequestId: 'permission-1',
            toolName: 'Write',
            toolInput: { file_path: 'index.ts' },
            toolUseId: 'tool-1',
            agentRunId: 'claude-run-1',
            childSessionId: 'claude-child-1',
            agentName: 'Frontend engineer',
          },
          permissionResolved: null,
          onPermissionResponse: () => {},
        }),
      ),
    );
    assert.match(html, /Requested by Sub Agent: Frontend engineer/);
    assert.match(html, /data-subagent-permission-attribution="claude-run-1"/);
  });

  it('mounts the workspace sidebar on the first-turn /chat route when Details opens it', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/components/layout/AppShell.tsx'), 'utf8');
    assert.match(source, /isChatRoute && ws\.state\.open/);
    assert.match(source, /<ChatContentRow isChatRoute=\{isChatRoute\}/);
  });

  it('keeps refresh-recovered assistant checkpoints visible and polls them to a terminal row', () => {
    const root = process.cwd();
    const chatView = fs.readFileSync(path.join(root, 'src/components/chat/ChatView.tsx'), 'utf8');
    const history = fs.readFileSync(path.join(root, 'src/components/chat/MessageItem.tsx'), 'utf8');
    assert.match(chatView, /message\.stream_status === 'streaming'/);
    assert.match(chatView, /window\.setInterval\(refreshCheckpoints,\s*750\)/);
    assert.match(chatView, /mirroredCheckpointIdsRef\.current\.has\(message\.id\)/);
    assert.match(chatView, /recoveredCheckpointContents\.has\(message\.content\)/);
    assert.match(history, /message\.stream_status !== 'completed'/);
    assert.match(history, /message\.streamStatus\.\$\{message\.stream_status\}/);
  });
});
