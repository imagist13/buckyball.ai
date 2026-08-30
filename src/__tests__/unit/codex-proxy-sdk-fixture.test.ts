/**
 * Phase 5b smoke round 5–6 (2026-05-16) — Codex Responses SSE
 * contract round-trip.
 *
 * Pins the proxy's outbound SSE stream against two contract sources
 * with deliberately asymmetric coverage:
 *
 *   Success path → SDK fixture
 *     资料/codex/sdk/typescript/tests/responsesProxy.ts
 *     (assistantMessage / shell_call / responseCompleted)
 *
 *   Failure path → Codex app-server parser
 *     资料/codex/codex-rs/codex-api/src/sse/responses.rs
 *     `process_responses_event` → "response.failed" arm
 *
 * Why the split: the SDK fixture's `responseFailed()` emits
 * `{type: 'error', error: {code, message}}`, but Codex's actual
 * app-server SSE parser only matches `response.failed`. Round 5
 * naively aligned errors with the SDK fixture; round 6 reverted
 * because the app-server path is today's production consumer, and
 * the `error` form falls through unhandled there. Success events
 * (output_item.done, completed) round-trip through BOTH parsers
 * so they stay SDK-fixture-aligned.
 *
 * The test stages a synthesised ai-sdk `fullStream` (the same shape
 * `streamText().fullStream` produces), runs it through `translateStream`
 * + `encodeEvent`, and asserts:
 *
 *   1. Wire framing is `event: <type>\ndata: <JSON>\n\n` (NOT bare
 *      `data:` like pre-fix).
 *   2. Assistant text lands as `output_item.done(message, [output_text])` —
 *      matching `assistantMessage()` in the SDK fixture.
 *   3. Function-call lands as `output_item.done(function_call,
 *      call_id, name, arguments)` — matching `shell_call()`.
 *   4. `response.completed.response.usage` has `input_tokens_details`
 *      + `output_tokens_details` keys (nullable) — matching
 *      `responseCompleted()`'s shape.
 *   5. Error frames are `response.failed` with `response: {id, error:
 *      {code, message}}` — matching Codex's `process_responses_event`
 *      "response.failed" arm. The SDK fixture's `{type: 'error'}`
 *      form is the future @openai/codex-sdk execution-POC path; not
 *      what today's app-server route emits.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TextStreamPart, ToolSet } from 'ai';
import { translateStream } from '@/lib/codex/proxy/translate-stream';
import { encodeEvent, encodeDone } from '@/lib/codex/proxy/sse';
import type {
  ResponsesEvent,
  ResponsesRequestBody,
} from '@/lib/codex/proxy/types';

function source(parts: TextStreamPart<ToolSet>[]): AsyncIterable<TextStreamPart<ToolSet>> {
  return (async function* () {
    for (const p of parts) yield p;
  })();
}

async function collect(gen: AsyncGenerator<ResponsesEvent, void, void>): Promise<ResponsesEvent[]> {
  const out: ResponsesEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const baseBody: ResponsesRequestBody = {
  model: 'gpt-test',
  input: [],
  stream: true,
};

// ─────────────────────────────────────────────────────────────────────
// SSE wire framing
// ─────────────────────────────────────────────────────────────────────

describe('Codex proxy SSE — wire framing matches SDK fixture (event: <type>\\ndata: <JSON>\\n\\n)', () => {
  it('each encoded event prefixes an `event:` line before the data line', () => {
    const decoder = new TextDecoder();
    const bytes = encodeEvent({
      type: 'response.created',
      response: { id: 'resp_x' },
    });
    const wire = decoder.decode(bytes);
    // SDK fixture formatSseEvent: `event: ${type}\n` + `data: ${json}\n\n`
    assert.match(wire, /^event: response\.created\ndata: \{/);
    assert.match(wire, /\}\n\n$/);
  });

  it('encodeDone produces the `[DONE]` sentinel Codex expects after the terminal frame', () => {
    const decoder = new TextDecoder();
    const wire = decoder.decode(encodeDone());
    assert.equal(wire, 'data: [DONE]\n\n');
  });

  it('every emitted ResponsesEvent type is round-trip-encodable (no JSON.stringify cycles)', () => {
    const decoder = new TextDecoder();
    const samples: ResponsesEvent[] = [
      { type: 'response.created', response: { id: 'r' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { id: 'msg1', type: 'message', role: 'assistant', content: [] },
      },
      {
        type: 'response.output_text.delta',
        output_index: 0,
        item_id: 'msg1',
        delta: 'hi',
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          id: 'msg1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'hi' }],
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'r',
          usage: {
            input_tokens: 0,
            input_tokens_details: null,
            output_tokens: 0,
            output_tokens_details: null,
            total_tokens: 0,
          },
        },
      },
      { type: 'response.failed', response: { id: 'r', error: { code: 'internal_error', message: 'x' } } },
    ];
    for (const sample of samples) {
      const wire = decoder.decode(encodeEvent(sample));
      assert.match(wire, new RegExp(`^event: ${sample.type.replace(/\./g, '\\.')}\\ndata: `));
      // The data payload must JSON-parse cleanly back to the original event.
      const dataLine = wire.slice(wire.indexOf('data: ') + 'data: '.length, -2);
      const parsed = JSON.parse(dataLine);
      assert.equal(parsed.type, sample.type, `round-trip type must match for ${sample.type}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// assistantMessage() fixture round-trip
// ─────────────────────────────────────────────────────────────────────

describe('translateStream produces an output_item.done(message) matching SDK assistantMessage() shape', () => {
  it('text turn lands as: created → output_item.added(message) → output_text.delta* → output_item.done(message) → completed', async () => {
    const events = await collect(
      translateStream({
        responseId: 'resp_mock',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          { type: 'text-start', id: 'msg_mock' } as never,
          { type: 'text-delta', id: 'msg_mock', text: 'First response' } as never,
          { type: 'text-end', id: 'msg_mock' } as never,
          {
            type: 'finish',
            finishReason: 'stop',
            rawFinishReason: 'stop',
            totalUsage: { inputTokens: 42, outputTokens: 5, totalTokens: 47, inputTokenDetails: { cacheReadTokens: 12 } },
          } as never,
        ]),
      }),
    );

    // Locate the output_item.done(message) — this is what
    // assistantMessage() in the SDK fixture emits and what Codex's
    // handle_output_item_done lands.
    const done = events.find(e =>
      e.type === 'response.output_item.done' && (e as { item: { type: string } }).item.type === 'message',
    ) as
      | undefined
      | {
          type: 'response.output_item.done';
          item: { type: 'message'; role: 'assistant'; id: string; content: Array<{ type: string; text: string }> };
        };
    assert.ok(done, 'output_item.done(message) must be emitted — its absence is the GLM/Kimi blank-completion bug');
    assert.equal(done.item.type, 'message');
    assert.equal(done.item.role, 'assistant');
    assert.equal(done.item.content[0].type, 'output_text');
    assert.equal(done.item.content[0].text, 'First response');
  });

  it('matches assistantMessage() reference event keys (type/item.type/item.role/item.id/item.content[].type/text)', async () => {
    // Reference event from sdk/typescript/tests/responsesProxy.ts:assistantMessage("X"):
    //   {
    //     type: "response.output_item.done",
    //     item: {
    //       type: "message",
    //       role: "assistant",
    //       id: "msg_mock",
    //       content: [{ type: "output_text", text: "X" }],
    //     }
    //   }
    const events = await collect(
      translateStream({
        responseId: 'resp_mock',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          { type: 'text-start', id: 'msg_mock' } as never,
          { type: 'text-delta', id: 'msg_mock', text: 'X' } as never,
          { type: 'text-end', id: 'msg_mock' } as never,
          { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } as never,
        ]),
      }),
    );
    const done = events.find(e =>
      e.type === 'response.output_item.done' && (e as { item: { type: string } }).item.type === 'message',
    ) as {
      type: 'response.output_item.done';
      item: { type: 'message'; role: 'assistant'; id: string; content: Array<{ type: 'output_text'; text: string }> };
    };
    // Compare keys of `done` to the canonical structure (deep-equal
    // a representative subset; tolerate extra optional fields like
    // output_index).
    assert.equal(done.item.type, 'message');
    assert.equal(done.item.role, 'assistant');
    assert.equal(typeof done.item.id, 'string', 'item.id is required by the SDK fixture');
    assert.ok(done.item.id.length > 0, 'item.id must be non-empty');
    assert.equal(done.item.content[0].type, 'output_text');
    assert.equal(done.item.content[0].text, 'X');
  });
});

// ─────────────────────────────────────────────────────────────────────
// shell_call() fixture round-trip
// ─────────────────────────────────────────────────────────────────────

describe('translateStream produces an output_item.done(function_call) matching SDK shell_call() shape', () => {
  it('tool turn lands as: created → output_item.done(function_call) → completed', async () => {
    // Reference event from sdk/typescript/tests/responsesProxy.ts:shell_call():
    //   {
    //     type: "response.output_item.done",
    //     item: {
    //       type: "function_call",
    //       call_id: "call_<random>",
    //       name: "shell",
    //       arguments: JSON.stringify({ command, timeout_ms }),
    //     }
    //   }
    const events = await collect(
      translateStream({
        responseId: 'resp_mock',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          {
            type: 'tool-call',
            toolCallId: 'call_demo',
            toolName: 'shell',
            input: { command: ['bash', '-lc', "echo 'Hello, world!'"], timeout_ms: 100 },
          } as never,
          { type: 'finish', finishReason: 'tool-calls', rawFinishReason: 'tool_calls', totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } as never,
        ]),
      }),
    );

    const done = events.find(e =>
      e.type === 'response.output_item.done' && (e as { item: { type: string } }).item.type === 'function_call',
    ) as {
      type: 'response.output_item.done';
      item: { type: 'function_call'; call_id: string; name: string; arguments: string };
    };
    assert.ok(done, 'output_item.done(function_call) must be emitted (matches SDK shell_call())');
    assert.equal(done.item.type, 'function_call');
    assert.equal(done.item.call_id, 'call_demo');
    assert.equal(done.item.name, 'shell');
    // arguments must be a JSON-encoded STRING — not a parsed object —
    // because Codex's handle_output_item_done expects the raw string.
    assert.equal(typeof done.item.arguments, 'string');
    const parsed = JSON.parse(done.item.arguments);
    assert.deepEqual(parsed.command, ['bash', '-lc', "echo 'Hello, world!'"]);
    assert.equal(parsed.timeout_ms, 100);
  });
});

// ─────────────────────────────────────────────────────────────────────
// responseCompleted() fixture round-trip
// ─────────────────────────────────────────────────────────────────────

describe('response.completed payload matches SDK responseCompleted() shape', () => {
  it('usage carries input/output token totals AND nullable details objects', async () => {
    // Reference event from sdk/typescript/tests/responsesProxy.ts:responseCompleted():
    //   {
    //     type: "response.completed",
    //     response: {
    //       id: "resp_mock",
    //       usage: {
    //         input_tokens: 42,
    //         input_tokens_details: { cached_tokens: 12 } | null,
    //         output_tokens: 5,
    //         output_tokens_details: { reasoning_tokens: N } | null,
    //         total_tokens: 47,
    //       },
    //     },
    //   }
    const events = await collect(
      translateStream({
        responseId: 'resp_mock',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          {
            type: 'finish',
            finishReason: 'stop',
            rawFinishReason: 'stop',
            totalUsage: {
              inputTokens: 42,
              outputTokens: 5,
              totalTokens: 47,
              inputTokenDetails: { cacheReadTokens: 12 },
              outputTokenDetails: { reasoningTokens: 0 },
            },
          } as never,
        ]),
      }),
    );
    const completed = events[events.length - 1] as {
      type: 'response.completed';
      response: {
        id: string;
        usage: {
          input_tokens: number;
          input_tokens_details: { cached_tokens: number } | null;
          output_tokens: number;
          output_tokens_details: { reasoning_tokens: number } | null;
          total_tokens: number;
        };
      };
    };
    assert.equal(completed.type, 'response.completed');
    assert.equal(completed.response.id, 'resp_mock');
    assert.equal(completed.response.usage.input_tokens, 42);
    assert.deepEqual(completed.response.usage.input_tokens_details, { cached_tokens: 12 });
    assert.equal(completed.response.usage.output_tokens, 5);
    assert.deepEqual(completed.response.usage.output_tokens_details, { reasoning_tokens: 0 });
    assert.equal(completed.response.usage.total_tokens, 47);
  });

  it('usage details collapse to null when ai-sdk doesn\'t provide them (matches SDK fixture default)', async () => {
    const events = await collect(
      translateStream({
        responseId: 'resp_mock',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          {
            type: 'finish',
            finishReason: 'stop',
            rawFinishReason: 'stop',
            totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          } as never,
        ]),
      }),
    );
    const completed = events[events.length - 1] as {
      response: { usage: { input_tokens_details: unknown; output_tokens_details: unknown } };
    };
    assert.equal(completed.response.usage.input_tokens_details, null);
    assert.equal(completed.response.usage.output_tokens_details, null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Error frame contract — Codex app-server parser, not SDK fixture
// ─────────────────────────────────────────────────────────────────────

describe('error frames target Codex app-server parser shape: response.failed { response: { id, error: { code, message } } }', () => {
  // Asymmetry between sources: SDK fixture's `responseFailed()`
  // emits `{type: 'error', error}`, but Codex's app-server SSE
  // parser (codex-rs/codex-api/src/sse/responses.rs
  // `process_responses_event`) only matches `response.failed` and
  // reads `response.error.code` to classify. The `error` form falls
  // through unhandled there and Codex throws "stream closed before
  // response.completed" — silent failure for the user.
  //
  // Phase 5b smoke round 6 (2026-05-16) reverted from the SDK
  // fixture shape to Codex's parser shape so streaming failures
  // surface as structured ApiError variants on the app-server side.
  // Any future @openai/codex-sdk execution POC will need to branch
  // on consumer type and emit the SDK shape there instead.
  it('upstream throw becomes response.failed with response.id + response.error.{code,message}', async () => {
    const events = await collect(
      translateStream({
        responseId: 'resp_mock',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          { type: 'error', error: new Error('rate limit exceeded') } as never,
        ]),
      }),
    );
    const last = events[events.length - 1] as {
      type: string;
      response: { id: string; error: { code: string; message: string } };
    };
    assert.equal(
      last.type,
      'response.failed',
      'Phase 5b smoke round 6 — terminal error MUST be response.failed; Codex app-server does not consume `error`',
    );
    assert.equal(last.response.id, 'resp_mock', 'response.id required so Codex can correlate to the in-progress response');
    assert.ok(last.response.error.code, 'response.error.code required (Codex classifies failure by code)');
    assert.match(last.response.error.message, /rate limit/, 'response.error.message is what Codex surfaces verbatim');
  });

  it('abort event also lands as response.failed (not a separate event type)', async () => {
    const events = await collect(
      translateStream({
        responseId: 'resp_mock',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          { type: 'abort', reason: 'client disconnected' } as never,
        ]),
      }),
    );
    const last = events[events.length - 1] as {
      type: string;
      response: { id: string; error: { code: string; message: string } };
    };
    assert.equal(last.type, 'response.failed');
    assert.equal(last.response.error.code, 'upstream_timeout');
    assert.match(last.response.error.message, /aborted/);
  });
});
