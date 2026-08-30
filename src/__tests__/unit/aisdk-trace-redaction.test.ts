/**
 * aisdk-trace-redaction.test.ts — AI SDK 7 Phase 4 ③ content spot-checks for
 * the redacted-by-default trace (src/lib/aisdk-trace.ts).
 *
 * Per the required check, this is CONTENT INSPECTION, not assertion of
 * intent: planted secrets (fake API key, Bearer token), a planted prompt,
 * system text, tool input and tool output are pushed through a REAL ai@7
 * `streamText` run (scripted provider fetch, real Telemetry integration
 * events), and every emitted trace line is checked by
 *   1. key/marker substring comparison (the exact planted values must not
 *      appear anywhere), and
 *   2. shape greps (sk-ant-…, Bearer …, api-key header shapes must not
 *      match any line).
 * A positive check pins that the trace still carries useful diagnostics
 * (model id, tool name, event types) — redaction must not degenerate into
 * an empty log.
 *
 * Default-off is pinned: isAiSdkTraceEnabled() is false without the
 * explicit CODEPILOT_AISDK_TRACE=1 env switch.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { streamText, tool, stepCountIs } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import {
  redactTraceValue,
  createRedactedTraceTelemetry,
  isAiSdkTraceEnabled,
} from '@/lib/aisdk-trace';

// ── Planted sensitive values (never expected in any trace output) ──

const PLANTED_API_KEY = 'sk-ant-api03-PLANTED-SECRET-KEY-a1b2c3d4e5f6g7h8';
const PLANTED_BEARER = 'Bearer PLANTED-BEARER-TOKEN-0123456789';
const PLANTED_SYSTEM = 'SYSTEM-MARKER-do-not-leak-9f8e7d';
const PLANTED_PROMPT = 'PROMPT-MARKER-super-private-user-text-4c5d6e';
const PLANTED_TOOL_INPUT = 'TOOL-INPUT-MARKER-secret-path-7a8b9c';
const PLANTED_TOOL_OUTPUT = 'TOOL-OUTPUT-MARKER-file-contents-1d2e3f';

const MARKERS = [
  PLANTED_API_KEY,
  PLANTED_BEARER,
  PLANTED_SYSTEM,
  PLANTED_PROMPT,
  PLANTED_TOOL_INPUT,
  PLANTED_TOOL_OUTPUT,
];

/** Shape greps — credential FORMS must not match either. */
const SHAPE_PATTERNS: Array<[string, RegExp]> = [
  ['anthropic key shape', /sk-ant-[A-Za-z0-9_-]{10,}/],
  ['generic sk- key shape', /sk-[A-Za-z0-9]{20,}/],
  ['bearer token shape', /Bearer\s+[A-Za-z0-9_-]{8,}/],
  ['x-api-key header with value', /x-api-key["':\s]+[A-Za-z0-9_-]{10,}/i],
];

// ── Canned Anthropic wire (same shapes as the parity harness) ────

type AnthropicSseEvent = readonly [string, Record<string, unknown>];

function sseBody(events: readonly AnthropicSseEvent[]): string {
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

function messageStart(): AnthropicSseEvent {
  return ['message_start', {
    type: 'message_start',
    message: {
      id: 'msg_trace', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  }];
}

function toolStepResponse(): Response {
  const events: AnthropicSseEvent[] = [
    messageStart(),
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_trace_1', name: 'trace_probe', input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ path: PLANTED_TOOL_INPUT }) } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return new Response(sseBody(events), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function textStepResponse(text: string): Response {
  const events: AnthropicSseEvent[] = [
    messageStart(),
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return new Response(sseBody(events), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

// ── 1. Pure redactor: fail-closed policy ─────────────────────────

describe('redactTraceValue policy', () => {
  it('collapses content subtrees, digests unknown strings, keeps safe metadata', () => {
    const out = redactTraceValue({
      model: 'claude-sonnet-4-6',
      toolName: 'Read',
      stepNumber: 3,
      success: true,
      messages: [{ role: 'user', content: PLANTED_PROMPT }],
      input: { path: PLANTED_TOOL_INPUT },
      someUnknownFutureField: PLANTED_PROMPT,
      headers: { authorization: PLANTED_BEARER },
    }) as Record<string, unknown>;

    const s = JSON.stringify(out);
    for (const marker of MARKERS) {
      assert.ok(!s.includes(marker), `planted value must not survive: ${marker.slice(0, 24)}…`);
    }
    // Safe metadata survives; numbers/booleans survive.
    assert.equal(out.model, 'claude-sonnet-4-6');
    assert.equal(out.toolName, 'Read');
    assert.equal(out.stepNumber, 3);
    assert.equal(out.success, true);
    // Content subtrees are single digests (no structure leak).
    assert.match(String(out.messages), /^\[redacted sha256:[0-9a-f]{12} len:\d+\]$/);
    assert.match(String(out.headers), /^\[redacted sha256:[0-9a-f]{12} len:\d+\]$/);
    // Unknown string keys fail closed to a digest.
    assert.match(String(out.someUnknownFutureField), /^\[redacted sha256:/);
  });

  it('never throws on hostile shapes (cycles, functions, deep nesting)', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    // Cycle → depth cap → digest of the remainder; JSON.stringify inside
    // digest would throw on the cycle, which the try/catch converts.
    const out = redactTraceValue(cyclic) as Record<string, unknown>;
    assert.equal(out.a, 1);
    let deep: Record<string, unknown> = { leaf: PLANTED_PROMPT };
    for (let i = 0; i < 20; i++) deep = { nested: deep };
    const deepOut = JSON.stringify(redactTraceValue(deep));
    assert.ok(!deepOut.includes(PLANTED_PROMPT));
    assert.equal(JSON.stringify(redactTraceValue(() => PLANTED_PROMPT)).includes(PLANTED_PROMPT), false);
  });
});

// ── 2. Real trace sample content inspection ──────────────────────

describe('real ai@7 telemetry trace — content spot-check', () => {
  it('a tool-call turn emits trace lines with NO planted secret, prompt, or credential shape', async () => {
    const lines: string[] = [];
    const integration = createRedactedTraceTelemetry((line) => lines.push(line));

    const originalFetch = globalThis.fetch;
    let call = 0;
    globalThis.fetch = (async () => {
      call++;
      return call === 1 ? toolStepResponse() : textStepResponse('done');
    }) as typeof fetch;

    try {
      const anthropic = createAnthropic({ apiKey: PLANTED_API_KEY });
      const result = streamText({
        model: anthropic('claude-sonnet-4-6'),
        system: PLANTED_SYSTEM,
        messages: [{ role: 'user', content: PLANTED_PROMPT }],
        tools: {
          trace_probe: tool({
            description: 'trace probe tool',
            inputSchema: z.object({ path: z.string() }),
            execute: async () => PLANTED_TOOL_OUTPUT,
          }),
        },
        stopWhen: stepCountIs(2),
        headers: { 'x-extra-auth': PLANTED_BEARER },
        telemetry: { isEnabled: true, functionId: 'trace-redaction-test', integrations: [integration] },
      });
      // Drain the stream so all steps + tool executions complete.
      for await (const _part of result.fullStream) { void _part; }
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.ok(lines.length >= 4, `expected a real trace sample, got ${lines.length} lines`);
    const all = lines.join('\n');

    // (1) key/marker substring comparison
    for (const marker of MARKERS) {
      assert.ok(!all.includes(marker), `trace leaked planted value: ${marker.slice(0, 24)}…`);
    }
    // (2) shape greps
    for (const [label, re] of SHAPE_PATTERNS) {
      assert.ok(!re.test(all), `trace matched credential shape: ${label}`);
    }

    // Positive: the trace is still a useful diagnostic — event types, model
    // id, tool name and numeric fields survive redaction.
    assert.ok(lines.some((l) => l.includes('"event":"model-call-start"')), 'model-call-start present');
    assert.ok(lines.some((l) => l.includes('"event":"tool-execution-end"')), 'tool-execution-end present');
    assert.ok(all.includes('claude-sonnet-4-6'), 'model id survives');
    assert.ok(all.includes('trace_probe'), 'tool name survives');
  });
});

// ── 3. Default-off is pinned ─────────────────────────────────────

describe('isAiSdkTraceEnabled', () => {
  it('is OFF by default and requires the explicit =1 switch', () => {
    assert.equal(isAiSdkTraceEnabled({} as NodeJS.ProcessEnv), false);
    assert.equal(isAiSdkTraceEnabled({ CODEPILOT_AISDK_TRACE: '' } as unknown as NodeJS.ProcessEnv), false);
    assert.equal(isAiSdkTraceEnabled({ CODEPILOT_AISDK_TRACE: 'true' } as unknown as NodeJS.ProcessEnv), false);
    assert.equal(isAiSdkTraceEnabled({ CODEPILOT_AISDK_TRACE: '1' } as unknown as NodeJS.ProcessEnv), true);
  });
});
