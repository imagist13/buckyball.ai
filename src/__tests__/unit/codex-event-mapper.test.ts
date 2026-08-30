/**
 * Phase 5 Phase 3 — Codex notification → canonical event mapping.
 *
 * Phase 5 review round 1 (2026-05-13) — payloads in this file are
 * SCHEMA-CORRECT per `资料/codex/codex-rs/app-server-protocol/schema/typescript/`.
 * Earlier revision invented payload shapes (params.itemId,
 * params.command as string[], flat token usage) — that's what Codex
 * caught.
 *
 * Pins:
 *
 *   - assistant deltas + reasoning deltas (item/reasoning/textDelta,
 *     item/reasoning/summaryTextDelta) → `assistant_delta`
 *   - ItemStartedNotification = { item: ThreadItem, … } where the
 *     id / type / command (string!) live inside `item`. commandExecution
 *     → `command_started`; mcpToolCall / dynamicToolCall / fileChange /
 *     webSearch → `tool_started`.
 *   - ItemCompletedNotification mirrors ItemStarted; commandExecution
 *     reads `aggregatedOutput` + `exitCode`.
 *   - thread/tokenUsage/updated → params.tokenUsage.last.{inputTokens,
 *     outputTokens} + params.tokenUsage.modelContextWindow.
 *   - turn/completed → run_completed; top-level `error` notification
 *     → run_failed (Codex doesn't have a separate turn/failed).
 *   - fs/changed → file_changed.
 *   - account/login/completed (slash-namespaced) etc. → null
 *     (transport-only / different channel).
 *   - Unknown method → `unknown_item` with `codex.<method>` sourceType.
 *
 * Approval translator covers both the canonical
 * `item/commandExecution/requestApproval` (command as string) and the
 * legacy `execCommandApproval` (command as string[]).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  translateCodexNotification,
  translateCodexApproval,
  CODEX_KNOWN_NOTIFICATION_METHODS,
} from '@/lib/codex/event-mapper';
import { diagnoseCodexNetworkError } from '@/lib/codex/error-diagnostics';

const ctx = { sessionId: 's1' };

describe('translateCodexNotification — streaming text', () => {
  it('item/agentMessage/delta → assistant_delta with the text', () => {
    const event = translateCodexNotification(
      'item/agentMessage/delta',
      { threadId: 't', turnId: 'u', itemId: 'i', delta: 'hello' },
      ctx,
    );
    assert.equal(event?.type, 'assistant_delta');
    if (event?.type !== 'assistant_delta') throw new Error('unreachable');
    assert.equal(event.text, 'hello');
    assert.equal(event.runtimeId, 'codex_runtime');
    assert.equal(event.sessionId, 's1');
  });

  it('empty delta returns null (no zero-length text events)', () => {
    const event = translateCodexNotification('item/agentMessage/delta', { delta: '' }, ctx);
    assert.equal(event, null);
  });

  it('item/reasoning/textDelta maps to assistant_delta (slash-namespaced per schema)', () => {
    const event = translateCodexNotification(
      'item/reasoning/textDelta',
      { delta: 'thinking…' },
      ctx,
    );
    assert.equal(event?.type, 'assistant_delta');
  });

  it('item/reasoning/summaryTextDelta also maps to assistant_delta', () => {
    const event = translateCodexNotification(
      'item/reasoning/summaryTextDelta',
      { delta: 'summary' },
      ctx,
    );
    assert.equal(event?.type, 'assistant_delta');
  });
});

describe('translateCodexNotification — item lifecycle (schema-correct)', () => {
  it('item/started commandExecution → command_started (item.id + item.command string)', () => {
    // Per ThreadItem.commandExecution: { type, id, command: string, cwd, ... }
    const event = translateCodexNotification(
      'item/started',
      {
        item: {
          type: 'commandExecution',
          id: 'cmd-1',
          command: 'ls -la /tmp',
          cwd: '/tmp',
          processId: null,
          source: 'agent',
          status: 'in_progress',
          commandActions: [],
          aggregatedOutput: null,
          exitCode: null,
          durationMs: null,
        },
        threadId: 't',
        turnId: 'u',
        startedAtMs: 1700000000000,
      },
      ctx,
    );
    assert.equal(event?.type, 'command_started');
    if (event?.type !== 'command_started') throw new Error('unreachable');
    assert.equal(event.commandId, 'cmd-1');
    assert.equal(event.command, 'ls -la /tmp');
    assert.equal(event.cwd, '/tmp');
  });

  it('item/started mcpToolCall → tool_started with server.tool name', () => {
    const event = translateCodexNotification(
      'item/started',
      {
        item: {
          type: 'mcpToolCall',
          id: 'mcp-1',
          server: 'memory',
          tool: 'read_graph',
          status: 'in_progress',
          arguments: { foo: 1 },
        },
        threadId: 't',
        turnId: 'u',
        startedAtMs: 1700000000000,
      },
      ctx,
    );
    assert.equal(event?.type, 'tool_started');
    if (event?.type !== 'tool_started') throw new Error('unreachable');
    assert.equal(event.toolId, 'mcp-1');
    assert.equal(event.name, 'memory.read_graph');
    assert.deepEqual(event.input, { foo: 1 });
  });

  it('item/started dynamicToolCall (with namespace) → tool_started with namespace.tool name', () => {
    const event = translateCodexNotification(
      'item/started',
      {
        item: {
          type: 'dynamicToolCall',
          id: 'dyn-1',
          namespace: 'codepilot',
          tool: 'open_preview',
          arguments: { path: '/tmp/x.md' },
          status: 'in_progress',
        },
        threadId: 't',
        turnId: 'u',
        startedAtMs: 1700000000000,
      },
      ctx,
    );
    if (event?.type !== 'tool_started') throw new Error('unreachable');
    assert.equal(event.name, 'codepilot.open_preview');
  });

  it('item/started fileChange / webSearch → tool_started', () => {
    const file = translateCodexNotification(
      'item/started',
      { item: { type: 'fileChange', id: 'fc-1', changes: [] } },
      ctx,
    );
    if (file?.type !== 'tool_started') throw new Error('unreachable');
    assert.equal(file.name, 'fileChange');

    const search = translateCodexNotification(
      'item/started',
      { item: { type: 'webSearch', id: 'ws-1', query: 'codex' } },
      ctx,
    );
    if (search?.type !== 'tool_started') throw new Error('unreachable');
    assert.equal(search.name, 'web_search');
  });

  it('item/completed commandExecution → tool_completed with aggregatedOutput + exit error', () => {
    const ok = translateCodexNotification(
      'item/completed',
      {
        item: {
          type: 'commandExecution',
          id: 'cmd-1',
          command: 'true',
          cwd: '/tmp',
          processId: null,
          source: 'agent',
          status: 'success',
          commandActions: [],
          aggregatedOutput: 'OK',
          exitCode: 0,
          durationMs: 12,
        },
      },
      ctx,
    );
    if (ok?.type !== 'tool_completed') throw new Error('unreachable');
    assert.equal(ok.output, 'OK');
    assert.equal(ok.error, undefined);

    const fail = translateCodexNotification(
      'item/completed',
      {
        item: {
          type: 'commandExecution',
          id: 'cmd-2',
          command: 'false',
          cwd: '/tmp',
          processId: null,
          source: 'agent',
          status: 'failed',
          commandActions: [],
          aggregatedOutput: 'segfault',
          exitCode: 139,
          durationMs: 7,
        },
      },
      ctx,
    );
    if (fail?.type !== 'tool_completed') throw new Error('unreachable');
    assert.equal(fail.error, 'exit 139');
  });

  it('item/started with unknown type → unknown_item fallback (never dropped)', () => {
    const event = translateCodexNotification(
      'item/started',
      { item: { type: 'futureCodexExtensionItem', id: 'x-1' } },
      ctx,
    );
    assert.equal(event?.type, 'unknown_item');
  });
});

describe('translateCodexNotification — turn lifecycle (nested status per schema)', () => {
  // TurnCompletedNotification = { threadId, turn: Turn }
  // Turn.status = 'completed' | 'interrupted' | 'failed' | 'inProgress'
  function turnCompleted(status: string, error?: { message: string }) {
    return {
      threadId: 't',
      turn: {
        id: 'u',
        items: [],
        itemsView: 'all',
        status,
        error: error ?? null,
        startedAt: 0,
        completedAt: 0,
        durationMs: 0,
      },
    };
  }

  it('turn/completed with status=completed → run_completed (preserves real finishReason)', () => {
    const event = translateCodexNotification('turn/completed', turnCompleted('completed'), ctx);
    if (event?.type !== 'run_completed') throw new Error('unreachable');
    assert.equal(event.finishReason, 'completed');
  });

  it('turn/completed with status=interrupted → run_completed with interrupted finishReason', () => {
    // User-interrupted turns must surface as interrupted, NOT as
    // successful end_turn — review round 2 fix (2026-05-13).
    const event = translateCodexNotification('turn/completed', turnCompleted('interrupted'), ctx);
    if (event?.type !== 'run_completed') throw new Error('unreachable');
    assert.equal(event.finishReason, 'interrupted');
  });

  it('turn/completed with status=failed → run_failed (NOT run_completed)', () => {
    // Earlier revision swallowed turn failures as successful end_turn.
    const event = translateCodexNotification(
      'turn/completed',
      turnCompleted('failed', { message: 'context exhausted' }),
      ctx,
    );
    if (event?.type !== 'run_failed') throw new Error('unreachable');
    assert.equal(event.code, 'codex_turn_failed');
    assert.equal(event.message, 'context exhausted');
  });

  it('turn/completed with status=failed and missing error.message → falls back to default text', () => {
    const event = translateCodexNotification(
      'turn/completed',
      turnCompleted('failed', { message: '' }),
      ctx,
    );
    if (event?.type !== 'run_failed') throw new Error('unreachable');
    assert.match(event.message, /Codex turn failed/);
  });

  it('turn/completed diagnoses a 502 that targets CodePilot loopback proxy', () => {
    const event = translateCodexNotification(
      'turn/completed',
      turnCompleted('failed', {
        message: 'unexpected status 502 Bad Gateway: Unknown error, url: http://127.0.0.1:47823/api/codex/proxy/v1/responses (other)',
      }),
      ctx,
    );
    if (event?.type !== 'run_failed') throw new Error('unreachable');
    assert.equal(event.code, 'CODEX_LOOPBACK_PROXY_INTERCEPTED');
    assert.match(event.message, /^CODEX_LOOPBACK_PROXY_INTERCEPTED:/);
    assert.match(event.message, /127\.0\.0\.1\/localhost/);
    assert.match(event.message, /Original Codex error:/);
    assert.match(event.message, /url: http:\/\/127\.0\.0\.1:47823/);
  });

  it('turn/completed with status=inProgress → run_completed (conservative, with the real status as reason)', () => {
    // Codex doesn't typically emit inProgress here, but the schema
    // allows it. Surface the real status so downstream can distinguish.
    const event = translateCodexNotification('turn/completed', turnCompleted('inProgress'), ctx);
    if (event?.type !== 'run_completed') throw new Error('unreachable');
    assert.equal(event.finishReason, 'inProgress');
  });

  it('error notification → run_failed with full TurnError surface (Phase 5b smoke fix 2026-05-15)', () => {
    // Pre-5b the mapper read `params.code` / `params.message` at the
    // top level, which never matched Codex's actual ErrorNotification
    // schema `{ error: TurnError, willRetry, threadId, turnId }`. After
    // the fix the mapper reads `params.error.message` + appends
    // additionalDetails + the codexErrorInfo classification so chat
    // surface stops showing the bare string "Codex error".
    const event = translateCodexNotification(
      'error',
      {
        error: {
          message: 'upstream timed out',
          codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 504 } },
          additionalDetails: 'retry budget exhausted',
        },
        willRetry: false,
        threadId: 't1',
        turnId: 'u1',
      },
      ctx,
    );
    if (event?.type !== 'run_failed') throw new Error('unreachable');
    assert.match(event.message, /upstream timed out/);
    assert.match(event.message, /retry budget exhausted/);
    assert.match(event.message, /httpConnectionFailed HTTP 504/);
    assert.equal(event.code, 'codex:httpConnectionFailed');
  });

  it('error notification diagnoses loopback 502 when the URL is in additionalDetails', () => {
    const event = translateCodexNotification(
      'error',
      {
        error: {
          message: 'Unknown error',
          codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } },
          additionalDetails: 'unexpected status 502 Bad Gateway, url: http://127.0.0.1:47823/api/codex/proxy/v1/responses',
        },
        willRetry: false,
      },
      ctx,
    );
    if (event?.type !== 'run_failed') throw new Error('unreachable');
    assert.equal(event.code, 'CODEX_LOOPBACK_PROXY_INTERCEPTED');
    assert.match(event.message, /^CODEX_LOOPBACK_PROXY_INTERCEPTED:/);
    assert.match(event.message, /url: http:\/\/127\.0\.0\.1:47823/);
  });

  it('error notification with willRetry=true → unknown_item (NOT run_failed) so the stream stays open', () => {
    // Phase 5b smoke round 6 (2026-05-18) — willRetry is non-terminal.
    // Real Codex behaviour: app-server keeps retrying up to 5 times
    // ("stream disconnected — retrying sampling request (n/5)") after
    // emitting `error willRetry=true`. Pre-fix the mapper returned
    // `run_failed` and the runtime closed the stream on the first
    // retry signal — user saw error + done while Codex was still
    // working. Fix: map willRetry=true to canonical `unknown_item`
    // (sourceType='codex_retry') which the runtime wildcard handler
    // does NOT close on. Only the eventual `turn/completed
    // status=failed` lands as the terminal `run_failed`.
    const event = translateCodexNotification(
      'error',
      {
        error: {
          message: 'transient 503',
          codexErrorInfo: 'serverOverloaded',
          additionalDetails: null,
        },
        willRetry: true,
        threadId: 't1',
        turnId: 'u1',
      },
      ctx,
    );
    if (event?.type !== 'unknown_item') {
      throw new Error(`expected unknown_item, got ${event?.type}`);
    }
    assert.equal(event.sourceType, 'codex_retry');
    const payload = event.payload as Record<string, unknown>;
    assert.equal(payload.willRetry, true);
    assert.equal(payload.turnId, 'u1');
    assert.equal(payload.errorCode, 'serverOverloaded');
    assert.match(String(payload.message), /transient 503/);
    assert.match(String(payload.message), /serverOverloaded/);
  });

  it('error notification with willRetry=false (terminal) STILL returns run_failed', () => {
    // Belt: the non-terminal mapping is gated strictly on
    // `willRetry === true`. Any other value (false / undefined /
    // missing key) keeps the legacy terminal mapping so an existing
    // terminal-error flow doesn't accidentally become silent.
    const event = translateCodexNotification(
      'error',
      {
        error: {
          message: 'auth failed',
          codexErrorInfo: 'unauthorized',
          additionalDetails: null,
        },
        willRetry: false,
        threadId: 't1',
        turnId: 'u1',
      },
      ctx,
    );
    if (event?.type !== 'run_failed') throw new Error(`expected run_failed, got ${event?.type}`);
    assert.equal(event.code, 'unauthorized');
  });

  it('error notification with willRetry undefined → run_failed (defensive default)', () => {
    // Codex schema technically allows the field to be absent. When
    // we can't prove non-terminal, we treat it as terminal — never
    // assume the upstream is going to recover on its own.
    const event = translateCodexNotification(
      'error',
      {
        error: {
          message: 'some failure',
          codexErrorInfo: null,
          additionalDetails: null,
        },
        threadId: 't1',
        turnId: 'u1',
      },
      ctx,
    );
    if (event?.type !== 'run_failed') throw new Error(`expected run_failed, got ${event?.type}`);
    assert.equal(event.code, 'codex_error');
  });

  it('error notification with empty error.message falls back to "Codex error (no message)"', () => {
    const event = translateCodexNotification(
      'error',
      { error: { message: '', codexErrorInfo: null, additionalDetails: null } },
      ctx,
    );
    if (event?.type !== 'run_failed') throw new Error('unreachable');
    assert.match(event.message, /Codex error \(no message\)/);
    assert.equal(event.code, 'codex_error');
  });
});

describe('Codex loopback proxy error diagnosis', () => {
  it('recognizes localhost and IPv6 CodePilot proxy URLs', () => {
    assert.match(
      diagnoseCodexNetworkError(
        'unexpected status 502 Bad Gateway, url: http://localhost:47823/api/codex/proxy/v1/responses',
      ).message,
      /^CODEX_LOOPBACK_PROXY_INTERCEPTED:/,
    );
    assert.match(
      diagnoseCodexNetworkError(
        'unexpected status 502 Bad Gateway, url: http://[::1]:47823/api/codex/proxy/v1/responses',
      ).message,
      /^CODEX_LOOPBACK_PROXY_INTERCEPTED:/,
    );
  });

  it('does not relabel an upstream Provider 502, a managed proxy envelope, or an unrelated loopback endpoint', () => {
    const upstream = 'unexpected status 502 Bad Gateway, url: https://api.example.test/v1/responses';
    const unrelated = 'unexpected status 502 Bad Gateway, url: http://127.0.0.1:47825/v1/responses';
    const managedEnvelope = 'unexpected status 502 Bad Gateway: {"error":{"code":"upstream_server_error","message":"Provider unavailable"}}, url: http://127.0.0.1:47823/api/codex/proxy/v1/responses';
    assert.deepEqual(diagnoseCodexNetworkError(upstream), { message: upstream });
    assert.deepEqual(diagnoseCodexNetworkError(unrelated), { message: unrelated });
    assert.deepEqual(diagnoseCodexNetworkError(managedEnvelope), { message: managedEnvelope });
  });
});

describe('translateCodexNotification — chat-only item types return null (P2.1 fix)', () => {
  // Phase 5 review round 2 fix (2026-05-13) — agentMessage / userMessage
  // / plan / reasoning lifecycle previously fell through to unknown_item,
  // which the runtime surfaces as a `status` SSE → useSSEStream renders
  // raw JSON as chat status. That's noise; the actual content streams
  // through dedicated delta methods.
  const chatOnly = [
    'agentMessage',
    'userMessage',
    'plan',
    'reasoning',
    'hookPrompt',
    'enteredReviewMode',
    'exitedReviewMode',
    'contextCompaction',
    // Phase 5b smoke round 7 (2026-05-16): imageView / imageGeneration
    // are NOT chat-only — they have no delta channel and their final
    // item is the only surface where the result reaches the user. See
    // the dedicated visibility describe block below.
  ];

  for (const type of chatOnly) {
    it(`item/started type=${type} → null (no chat noise)`, () => {
      const event = translateCodexNotification(
        'item/started',
        { item: { type, id: 'x-1' }, threadId: 't', turnId: 'u', startedAtMs: 0 },
        ctx,
      );
      assert.equal(event, null);
    });
    it(`item/completed type=${type} → null`, () => {
      const event = translateCodexNotification(
        'item/completed',
        { item: { type, id: 'x-1' }, threadId: 't', turnId: 'u', completedAtMs: 0 },
        ctx,
      );
      assert.equal(event, null);
    });
  }
});

describe('translateCodexNotification — collabAgentToolCall visibility', () => {
  it('keeps an anonymous wait as ordinary collaboration activity, not a child capsule', () => {
    const event = translateCodexNotification(
      'item/started',
      {
        item: {
          type: 'collabAgentToolCall',
          id: 'wait-call-1',
          tool: 'wait',
          status: 'inProgress',
          receiverThreadIds: [],
          agentsStates: {},
        },
        threadId: 't',
        turnId: 'u',
        startedAtMs: 0,
      },
      ctx,
    );
    assert.ok(event);
    if (event.type !== 'tool_started') throw new Error(`expected tool_started, got ${event.type}`);
    assert.equal(event.name, 'codex_collaboration_wait');
    assert.equal(event.toolId, 'wait-call-1');
    assert.deepEqual(event.input, {
      type: 'collabAgentToolCall',
      id: 'wait-call-1',
      tool: 'wait',
      status: 'inProgress',
      receiverThreadIds: [],
      agentsStates: {},
    });
  });

  it('does not turn fifteen identity-less wait actions into fifteen sub-agent capsules', () => {
    const names = Array.from({ length: 15 }, (_, index) => {
      const event = translateCodexNotification(
        'item/started',
        {
          item: {
            type: 'collabAgentToolCall',
            id: `wait-call-${index}`,
            tool: 'wait',
            status: 'inProgress',
            receiverThreadIds: [],
            agentsStates: {},
          },
        },
        ctx,
      );
      if (event?.type !== 'tool_started') throw new Error('expected tool_started');
      return event.name;
    });
    assert.equal(names.filter(name => name === 'codex_subagent').length, 0);
    assert.deepEqual(new Set(names), new Set(['codex_collaboration_wait']));
  });

  it('maps a collaboration item to a child capsule only with one proven child identity', () => {
    const event = translateCodexNotification(
      'item/started',
      {
        item: {
          type: 'collabAgentToolCall',
          id: 'wait-call-2',
          tool: 'wait',
          status: 'inProgress',
          receiverThreadIds: ['child-thread-1'],
          agentsStates: {
            'child-thread-1': { status: 'running', message: 'Reviewing patch' },
          },
          model: 'gpt-5.6-sol',
          prompt: 'Review this patch',
        },
      },
      ctx,
    );
    assert.ok(event);
    if (event.type !== 'tool_started') throw new Error(`expected tool_started, got ${event.type}`);
    assert.equal(event.name, 'codex_subagent');
    assert.equal(event.toolId, 'wait-call-2');
  });

  it('keeps multi-child wait activity out of the single-child capsule path', () => {
    const event = translateCodexNotification(
      'item/started',
      {
        item: {
          type: 'collabAgentToolCall',
          id: 'wait-call-many',
          tool: 'wait',
          status: 'inProgress',
          receiverThreadIds: ['child-1', 'child-2'],
          agentsStates: {
            'child-1': { status: 'running' },
            'child-2': { status: 'completed' },
          },
        },
      },
      ctx,
    );
    assert.ok(event);
    if (event.type !== 'tool_started') throw new Error(`expected tool_started, got ${event.type}`);
    assert.equal(event.name, 'codex_collaboration_wait');
  });

  it('preserves the full identity-bound completion payload without treating action status as child failure', () => {
    const event = translateCodexNotification(
      'item/completed',
      {
        item: {
          type: 'collabAgentToolCall',
          id: 'wait-call-2',
          tool: 'wait',
          status: 'failed',
          receiverThreadIds: ['child-thread-1'],
          agentsStates: {
            'child-thread-1': { status: 'running', message: 'Still reviewing' },
          },
          model: 'gpt-5.6-sol',
        },
        threadId: 't',
        turnId: 'u',
        completedAtMs: 0,
      },
      ctx,
    );
    assert.ok(event);
    if (event.type !== 'tool_completed') throw new Error(`expected tool_completed, got ${event.type}`);
    assert.equal(event.toolId, 'wait-call-2');
    assert.equal((event.output as { model?: string }).model, 'gpt-5.6-sol');
    assert.equal(event.error, undefined);
  });

  it('surfaces an anonymous collaboration action failure as a regular tool error', () => {
    const event = translateCodexNotification(
      'item/completed',
      {
        item: {
          type: 'collabAgentToolCall',
          id: 'wait-call-failed',
          tool: 'wait',
          status: 'failed',
          receiverThreadIds: [],
          agentsStates: {},
        },
      },
      ctx,
    );
    assert.ok(event);
    if (event.type !== 'tool_completed') throw new Error(`expected tool_completed, got ${event.type}`);
    assert.equal(event.error, 'Codex collaboration wait failed');
  });
});

describe('translateCodexNotification — imageGeneration / imageView lifecycle (Phase 5b smoke round 7)', () => {
  // Pre-fix these item types lived in CHAT_ONLY_ITEM_TYPES alongside
  // agentMessage/plan/reasoning. That was wrong: those have streaming
  // delta channels (item/agentMessage/delta etc.) so chat-only is
  // correct, but imageGeneration / imageView have NO delta channel
  // — their final item is the only surface where the user sees the
  // image or saved path. Silently returning null on item/completed
  // produced "tool ran but no result visible" — exactly the
  // GPT-Image-2.0 silent-failure report.
  it('imageGeneration item/started → tool_started with image_generation toolName + revisedPrompt input', () => {
    const event = translateCodexNotification(
      'item/started',
      {
        item: { type: 'imageGeneration', id: 'img-1', status: 'generating', revisedPrompt: null, result: '' },
        threadId: 't',
        turnId: 'u',
        startedAtMs: 0,
      },
      ctx,
    );
    assert.ok(event, 'imageGeneration item/started MUST emit a canonical event (silently dropping it produced the GPT-Image-2.0 blank-completion bug)');
    if (event!.type !== 'tool_started') throw new Error(`expected tool_started, got ${event!.type}`);
    assert.equal(event.toolId, 'img-1');
    assert.equal(event.name, 'image_generation');
  });

  it('imageGeneration item/completed → tool_completed carrying the FULL result/savedPath payload', () => {
    // result is what we want — the base64 / image data — and savedPath
    // is what makes it renderable in the chat UI. The generic
    // TOOL_LIKE_ITEM_TYPES branch packs the whole item into output,
    // which preserves both fields for downstream rendering.
    const event = translateCodexNotification(
      'item/completed',
      {
        item: {
          type: 'imageGeneration',
          id: 'img-1',
          status: 'completed',
          revisedPrompt: 'a cat sitting on a chair',
          result: '<base64-data>',
          savedPath: '/tmp/codex-img-1.png',
        },
        threadId: 't',
        turnId: 'u',
        completedAtMs: 0,
      },
      ctx,
    );
    assert.ok(event, 'imageGeneration item/completed MUST surface the final result (this is the silent-drop bug)');
    if (event!.type !== 'tool_completed') throw new Error(`expected tool_completed, got ${event!.type}`);
    assert.equal(event.toolId, 'img-1');
    // The output must include the result + savedPath so PreviewPanel /
    // chat-side renderers can pick the right path.
    const output = event.output as { result?: string; savedPath?: string; revisedPrompt?: string | null };
    assert.equal(output.result, '<base64-data>', 'image_generation completion must expose the generated image data');
    assert.equal(output.savedPath, '/tmp/codex-img-1.png');
    assert.equal(output.revisedPrompt, 'a cat sitting on a chair');
    // Phase 5b smoke round 8 — also emit MediaBlock so the chat-side
    // MediaPreview renders the image inline. The completed event is
    // the only surface where the image data reaches the UI; without
    // a media field the renderer would only get the JSON payload.
    assert.ok(event.media && event.media.length === 1, 'imageGeneration completion must emit a MediaBlock array');
    const media = event.media![0];
    assert.equal(media.type, 'image');
    assert.equal(media.mimeType, 'image/png', 'mimeType inferred from savedPath extension');
    assert.equal(media.localPath, '/tmp/codex-img-1.png', 'savedPath becomes localPath so MediaPreview reads from disk');
  });

  it('imageGeneration with base64 result but no savedPath puts the data inline (no localPath)', () => {
    // Some Codex flows return inline base64 without writing to disk.
    // The MediaBlock should carry `data` instead of `localPath`;
    // MediaPreview branches on which field is present.
    const event = translateCodexNotification(
      'item/completed',
      {
        item: {
          type: 'imageGeneration',
          id: 'img-2',
          status: 'completed',
          revisedPrompt: null,
          result: 'iVBORw0KGgo...',
        },
        threadId: 't',
        turnId: 'u',
        completedAtMs: 0,
      },
      ctx,
    );
    if (event?.type !== 'tool_completed') throw new Error('unreachable');
    const media = event.media?.[0];
    assert.ok(media, 'inline-result variant must still emit a MediaBlock');
    assert.equal(media!.type, 'image');
    assert.equal(media!.mimeType, 'image/png', 'no savedPath → fall back to image/png default');
    assert.equal(media!.data, 'iVBORw0KGgo...');
    assert.equal(media!.localPath, undefined, 'no path → omit localPath');
  });

  it('imageGeneration with neither savedPath NOR result emits no media (degraded but visible)', () => {
    // Failed mid-flight or status='error' generations. Don't pretend
    // we have a renderable image — let the chat surface the
    // structured output JSON instead.
    const event = translateCodexNotification(
      'item/completed',
      {
        item: {
          type: 'imageGeneration',
          id: 'img-3',
          status: 'failed',
          revisedPrompt: null,
          result: '',
        },
        threadId: 't',
        turnId: 'u',
        completedAtMs: 0,
      },
      ctx,
    );
    if (event?.type !== 'tool_completed') throw new Error('unreachable');
    assert.equal(event.media, undefined, 'no usable image data → omit media so MediaPreview skips this row');
  });

  it('imageView item/started → tool_started with image_view toolName + path input', () => {
    const event = translateCodexNotification(
      'item/started',
      {
        item: { type: 'imageView', id: 'view-1', path: '/Users/me/photos/x.png' },
        threadId: 't',
        turnId: 'u',
        startedAtMs: 0,
      },
      ctx,
    );
    assert.ok(event);
    if (event!.type !== 'tool_started') throw new Error(`expected tool_started, got ${event!.type}`);
    assert.equal(event.name, 'image_view');
    const input = event.input as { path: string };
    assert.equal(input.path, '/Users/me/photos/x.png');
  });

  it('imageView item/completed → tool_completed with MediaBlock(localPath, mimeType from extension)', () => {
    const event = translateCodexNotification(
      'item/completed',
      {
        item: { type: 'imageView', id: 'view-1', path: '/Users/me/photos/x.jpeg' },
        threadId: 't',
        turnId: 'u',
        completedAtMs: 0,
      },
      ctx,
    );
    assert.ok(event);
    if (event!.type !== 'tool_completed') throw new Error(`expected tool_completed, got ${event!.type}`);
    const output = event.output as { path: string };
    assert.equal(output.path, '/Users/me/photos/x.jpeg');
    // Phase 5b smoke round 8 — also emit MediaBlock for the renderer.
    assert.ok(event.media && event.media.length === 1);
    const media = event.media![0];
    assert.equal(media.type, 'image');
    assert.equal(media.localPath, '/Users/me/photos/x.jpeg');
    assert.equal(media.mimeType, 'image/jpeg', 'mimeType inferred from .jpeg extension');
  });

  it('imageView with unknown extension falls back to image/png mimeType', () => {
    const event = translateCodexNotification(
      'item/completed',
      {
        item: { type: 'imageView', id: 'view-1', path: '/tmp/no-ext-file' },
        threadId: 't',
        turnId: 'u',
        completedAtMs: 0,
      },
      ctx,
    );
    if (event?.type !== 'tool_completed') throw new Error('unreachable');
    const media = event.media?.[0];
    assert.equal(media?.mimeType, 'image/png', 'fallback mimeType when extension is missing / unknown');
  });
});

describe('translateCodexNotification — token usage (layered shape)', () => {
  it('reads params.tokenUsage.last.{inputTokens,outputTokens} + params.tokenUsage.modelContextWindow', () => {
    const event = translateCodexNotification(
      'thread/tokenUsage/updated',
      {
        threadId: 't',
        turnId: 'u',
        tokenUsage: {
          total: {
            totalTokens: 500,
            inputTokens: 300,
            cachedInputTokens: 100,
            outputTokens: 200,
            reasoningOutputTokens: 50,
          },
          last: {
            totalTokens: 150,
            inputTokens: 100,
            cachedInputTokens: 20,
            outputTokens: 50,
            reasoningOutputTokens: 10,
          },
          modelContextWindow: 200_000,
        },
      },
      ctx,
    );
    assert.equal(event?.type, 'usage_updated');
    if (event?.type !== 'usage_updated') throw new Error('unreachable');
    assert.equal(event.inputTokens, 100);
    assert.equal(event.outputTokens, 50);
    assert.equal(event.contextWindow, 200_000);
  });

  it('handles null modelContextWindow → undefined (don\'t falsely advertise capacity)', () => {
    const event = translateCodexNotification(
      'thread/tokenUsage/updated',
      {
        tokenUsage: {
          total: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
          last: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
          modelContextWindow: null,
        },
      },
      ctx,
    );
    if (event?.type !== 'usage_updated') throw new Error('unreachable');
    assert.equal(event.contextWindow, undefined);
  });

  it('missing tokenUsage → null (no event)', () => {
    const event = translateCodexNotification(
      'thread/tokenUsage/updated',
      { threadId: 't', turnId: 'u' },
      ctx,
    );
    assert.equal(event, null);
  });
});

describe('translateCodexNotification — fs changes', () => {
  it('fs/changed → file_changed with paths array', () => {
    const event = translateCodexNotification(
      'fs/changed',
      { watchId: 'w1', changedPaths: ['/tmp/a.md', '/tmp/b.md'] },
      ctx,
    );
    if (event?.type !== 'file_changed') throw new Error('unreachable');
    assert.deepEqual([...event.paths], ['/tmp/a.md', '/tmp/b.md']);
  });

  it('fs/changed with empty paths → null', () => {
    const event = translateCodexNotification('fs/changed', { changedPaths: [] }, ctx);
    assert.equal(event, null);
  });
});

describe('translateCodexNotification — transport-only (schema-correct names)', () => {
  // Codex uses slash-separated namespaces. The legacy camelCase names
  // (account/loginCompleted, thread/statusChanged) do NOT exist in
  // ServerNotification.
  const transportOnly = [
    'thread/started',
    'thread/closed',
    'thread/status/changed',
    'turn/started',
    'account/updated',
    'account/login/completed',
    'account/rateLimits/updated',
    'guardianWarning',
    'configWarning',
    'deprecationNotice',
    'process/outputDelta',
    'process/exited',
    'model/rerouted',
    'model/verification',
    'serverRequest/resolved',
  ];
  for (const method of transportOnly) {
    it(`${method} returns null`, () => {
      assert.equal(translateCodexNotification(method, {}, ctx), null);
    });
  }
});

describe('translateCodexNotification — unknown fallback', () => {
  it('unknown method → unknown_item with codex.<method> sourceType', () => {
    const event = translateCodexNotification(
      'someBrandNewCodexNotification',
      { foo: 1 },
      ctx,
    );
    if (event?.type !== 'unknown_item') throw new Error('unreachable');
    assert.equal(event.sourceType, 'codex.someBrandNewCodexNotification');
    assert.deepEqual(event.payload, { foo: 1 });
  });
});

describe('translateCodexApproval — server-to-client request → canonical permission_request', () => {
  const baseArgs = { sessionId: 's1', requestId: 'r1' };

  it('item/commandExecution/requestApproval → Bash subject with command (string per schema)', () => {
    // Per CommandExecutionRequestApprovalParams: command is a string,
    // not array. This is the canonical (current) approval method.
    const event = translateCodexApproval({
      ...baseArgs,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 't',
        turnId: 'u',
        itemId: 'i',
        startedAtMs: 1700000000000,
        command: 'rm -rf /tmp/foo',
        cwd: '/tmp',
        reason: 'destructive command requires confirmation',
      },
    });
    if (event.type !== 'permission_request') throw new Error('unreachable');
    assert.equal(event.toolName, 'Bash');
    assert.equal(event.subject, 'Bash · rm -rf /tmp/foo');
    assert.match(event.details ?? '', /cwd: \/tmp/);
    assert.match(event.details ?? '', /destructive/);
  });

  it('legacy execCommandApproval (command: string[]) → joined for display', () => {
    // ExecCommandApprovalParams (legacy) has command: Array<string>.
    const event = translateCodexApproval({
      ...baseArgs,
      method: 'execCommandApproval',
      params: { command: ['rm', '-rf', '/tmp/foo'], cwd: '/tmp', reason: 'destructive' },
    });
    if (event.type !== 'permission_request') throw new Error('unreachable');
    assert.equal(event.subject, 'Bash · rm -rf /tmp/foo');
  });

  it('item/fileChange/requestApproval → Patch (reason carried through details)', () => {
    const event = translateCodexApproval({
      ...baseArgs,
      method: 'item/fileChange/requestApproval',
      params: {
        threadId: 't',
        turnId: 'u',
        itemId: 'fc-9',
        startedAtMs: 1700000000000,
        reason: 'patch 3 files in /tmp',
      },
    });
    if (event.type !== 'permission_request') throw new Error('unreachable');
    assert.equal(event.toolName, 'Patch');
    assert.equal(event.subject, 'Patch');
    assert.match(event.details ?? '', /patch 3 files/);
  });

  it('legacy applyPatchApproval (has fileChanges map) → "Patch · N files"', () => {
    const event = translateCodexApproval({
      ...baseArgs,
      method: 'applyPatchApproval',
      params: {
        fileChanges: { '/a.md': {}, '/b.md': {}, '/c.md': {} },
        reason: 'agent wants to refactor 3 files',
      },
    });
    if (event.type !== 'permission_request') throw new Error('unreachable');
    assert.equal(event.subject, 'Patch · 3 files');
  });

  it('item/permissions/requestApproval → Permissions request', () => {
    const event = translateCodexApproval({
      ...baseArgs,
      method: 'item/permissions/requestApproval',
      params: {
        reason: 'elevate sandbox',
        cwd: '/workspace',
        environmentId: 'local',
        permissions: { network: { enabled: true } },
      },
    });
    if (event.type !== 'permission_request') throw new Error('unreachable');
    assert.equal(event.toolName, 'Permissions');
    assert.deepEqual(event.toolInput, {
      permissions: { network: { enabled: true } },
      cwd: '/workspace',
      environmentId: 'local',
    });
    assert.deepEqual(event.permissionHints, [{
      type: 'codexPermissionGrant',
      behavior: 'allow',
      destination: 'session',
    }]);
  });

  it('unknown approval kind → permission_unavailable (conservative default)', () => {
    const event = translateCodexApproval({
      ...baseArgs,
      method: 'codex.brandNewApproval',
      params: {},
    });
    if (event.type !== 'permission_unavailable') throw new Error('unreachable');
    assert.match(event.reason, /codex\.brandNewApproval/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Guardrail: every method name the mapper recognises must exist in the
// upstream `ServerNotification.ts` union. Tests load the schema file at
// boot — when Codex renames a method, this test fires before the
// mapper hits a real session.
// ─────────────────────────────────────────────────────────────────────

describe('Codex method-name guardrail vs upstream ServerNotification', () => {
  const schemaPath = path.resolve(
    __dirname,
    '../../../资料/codex/codex-rs/app-server-protocol/schema/typescript/ServerNotification.ts',
  );

  function loadSchemaMethods(): Set<string> | null {
    if (!fs.existsSync(schemaPath)) return null;
    const src = fs.readFileSync(schemaPath, 'utf8');
    const methods = new Set<string>();
    for (const m of src.matchAll(/"method":\s*"([^"]+)"/g)) {
      methods.add(m[1]);
    }
    return methods;
  }

  it('every known Codex notification method appears in ServerNotification.ts', () => {
    const schema = loadSchemaMethods();
    if (!schema) {
      // Schema not present (codex repo not cloned into 资料/codex).
      // Don't fail the unit harness — Phase 5 plan calls out the
      // clone as a developer prerequisite. The guardrail still pins
      // method-name correctness for any environment that does have
      // the schema (CI, local dev with codex installed).
      return;
    }
    const unknown = CODEX_KNOWN_NOTIFICATION_METHODS.filter((m) => !schema.has(m));
    assert.deepEqual(
      unknown,
      [],
      `event-mapper references method names not present in upstream ServerNotification: ${unknown.join(', ')}`,
    );
  });
});
