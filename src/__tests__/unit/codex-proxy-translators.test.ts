/**
 * Phase 5b — Translation layer pins for the Codex Responses proxy.
 *
 * Locks the Responses ↔ ai-sdk conversions: input items / tools /
 * stream events / non-stream response. These are the load-bearing
 * shape contracts the unified adapter relies on; a regression here
 * lands at the wire boundary and Codex sees malformed events.
 *
 * The adapter itself (createUnifiedAdapter) is exercised separately
 * through smoke / live-credential paths — its job is glue, not
 * translation. The unit tests here keep the format-correctness pin
 * fast (~ms) and independent of any real provider call.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translateResponsesInput } from '@/lib/codex/proxy/translate-input';
import { buildPrompt } from '@/lib/codex/proxy/unified-adapter';
import { translateResponsesTools } from '@/lib/codex/proxy/translate-tools';
import { translateStream } from '@/lib/codex/proxy/translate-stream';
import { translateNonStreamResponse } from '@/lib/codex/proxy/translate-response';
import { buildProviderOptions } from '@/lib/codex/proxy/unified-adapter';
import type {
  ResponsesInputItem,
  ResponsesTool,
  ResponsesRequestBody,
} from '@/lib/codex/proxy/types';

// ─────────────────────────────────────────────────────────────────────
// translateResponsesInput
// ─────────────────────────────────────────────────────────────────────

describe('translateResponsesInput — Responses items → ai-sdk ModelMessage[]', () => {
  it('translates a single user message with input_text', () => {
    const input: ResponsesInputItem[] = [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }],
      },
    ];
    const messages = translateResponsesInput(input);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'user');
    assert.deepEqual(messages[0].content, [{ type: 'text', text: 'hello' }]);
  });

  it('translates assistant message with output_text', () => {
    const input: ResponsesInputItem[] = [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'hi back' }],
      },
    ];
    const messages = translateResponsesInput(input);
    assert.equal(messages[0].role, 'assistant');
    assert.deepEqual(messages[0].content, [{ type: 'text', text: 'hi back' }]);
  });

  it('merges function_call into the preceding assistant message', () => {
    // Codex's typical shape: assistant text → function_call → ...
    const input: ResponsesInputItem[] = [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'let me check' }],
      },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'lookup',
        arguments: '{"q":"weather"}',
      },
    ];
    const messages = translateResponsesInput(input);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'assistant');
    const content = messages[0].content as Array<{ type: string }>;
    assert.equal(content.length, 2);
    assert.equal(content[0].type, 'text');
    assert.equal(content[1].type, 'tool-call');
    const toolCall = content[1] as unknown as { toolCallId: string; toolName: string; input: unknown };
    assert.equal(toolCall.toolCallId, 'call_1');
    assert.equal(toolCall.toolName, 'lookup');
    assert.deepEqual(toolCall.input, { q: 'weather' });
  });

  it('translates function_call_output as tool message with JSON content when parseable', () => {
    const input: ResponsesInputItem[] = [
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: '{"temp":72}',
      },
    ];
    const messages = translateResponsesInput(input);
    assert.equal(messages[0].role, 'tool');
    const content = messages[0].content as Array<{
      type: string;
      toolCallId: string;
      output: { type: string; value: unknown };
    }>;
    assert.equal(content[0].type, 'tool-result');
    assert.equal(content[0].toolCallId, 'call_1');
    assert.equal(content[0].output.type, 'json');
    assert.deepEqual(content[0].output.value, { temp: 72 });
  });

  it('falls back to text output when function_call_output is non-JSON', () => {
    const input: ResponsesInputItem[] = [
      { type: 'function_call_output', call_id: 'c1', output: 'plain string result' },
    ];
    const messages = translateResponsesInput(input);
    const content = messages[0].content as Array<{
      output: { type: string; value: unknown };
    }>;
    assert.equal(content[0].output.type, 'text');
    assert.equal(content[0].output.value, 'plain string result');
  });

  it('resolves tool-result toolName from the matching function_call (Phase 5b smoke round 7)', () => {
    // Pre-fix the translator wrote a sentinel '__from_responses_proxy__'
    // for every tool-result. Anthropic and OpenAI Responses both use
    // tool-result.toolName to look up the tool definition and route
    // the result back to the model; the sentinel broke that and
    // produced "tool ran but no continuation" (GPT-Image-2.0 skill
    // completed silently). The fix builds a call_id → toolName map
    // from the input's function_call items.
    const input: ResponsesInputItem[] = [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'generating' }],
      },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'gpt_image_2',
        arguments: '{"prompt":"a cat"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: '{"image":"<base64>","saved_path":"/tmp/x.png"}',
      },
    ];
    const messages = translateResponsesInput(input);
    // Last message is the tool result; its content[0].toolName must
    // be the original function_call name, not a sentinel.
    const toolMsg = messages[messages.length - 1];
    assert.equal(toolMsg.role, 'tool');
    const content = toolMsg.content as Array<{
      type: string;
      toolCallId: string;
      toolName: string;
      output: { type: string };
    }>;
    assert.equal(
      content[0].toolName,
      'gpt_image_2',
      'tool-result.toolName must round-trip from the matching function_call — pre-fix the sentinel broke provider routing and silenced GPT-Image-2.0',
    );
    assert.equal(content[0].toolCallId, 'call_1');
  });

  it('resolves toolName across function_call_output appearing after multiple unrelated turns', () => {
    // Same correlation must survive interleaving with text turns
    // and other function_calls. Pin the full-walk-then-translate
    // behaviour so a future "optimise to single pass" diff doesn't
    // regress.
    const input: ResponsesInputItem[] = [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'go' }] },
      { type: 'function_call', call_id: 'a', name: 'tool_a', arguments: '{}' },
      { type: 'function_call', call_id: 'b', name: 'tool_b', arguments: '{}' },
      { type: 'function_call_output', call_id: 'b', output: '{"ok":true}' },
      { type: 'function_call_output', call_id: 'a', output: '{"ok":true}' },
    ];
    const messages = translateResponsesInput(input);
    const tool1 = messages[messages.length - 2].content as Array<{ toolName: string; toolCallId: string }>;
    const tool2 = messages[messages.length - 1].content as Array<{ toolName: string; toolCallId: string }>;
    assert.equal(tool1[0].toolCallId, 'b');
    assert.equal(tool1[0].toolName, 'tool_b');
    assert.equal(tool2[0].toolCallId, 'a');
    assert.equal(tool2[0].toolName, 'tool_a');
  });

  it('orphan function_call_output (no matching function_call in this request) falls back to a named sentinel + warns', () => {
    // The sentinel must NOT be the silent '__from_responses_proxy__'
    // anymore — make orphans loud so debugging is possible. console.warn
    // is the load-bearing side effect; intercept it.
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(a => String(a)).join(' '));
    };
    try {
      const input: ResponsesInputItem[] = [
        { type: 'function_call_output', call_id: 'orphan_1', output: '{"ok":true}' },
      ];
      const messages = translateResponsesInput(input);
      const content = messages[0].content as Array<{ toolName: string }>;
      assert.equal(
        content[0].toolName,
        '__orphan_function_call_output__',
        'orphan tool-result must use the named sentinel so the divergence is visible at provider time',
      );
      assert.ok(
        warnings.some(w => w.includes('orphan_1') && w.includes('no matching function_call')),
        `orphan must emit a console.warn naming the call_id; got: ${JSON.stringify(warnings)}`,
      );
    } finally {
      console.warn = originalWarn;
    }
  });

  it('promotes input_image to ai-sdk image part on user messages', () => {
    const input: ResponsesInputItem[] = [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'what is this' },
          { type: 'input_image', image_url: 'https://example.com/img.png' },
        ],
      },
    ];
    const messages = translateResponsesInput(input);
    const content = messages[0].content as Array<{ type: string; image?: string; text?: string }>;
    assert.equal(content[0].type, 'text');
    assert.equal(content[1].type, 'image');
    assert.equal(content[1].image, 'https://example.com/img.png');
  });

  it('maps developer role to system (ai-sdk parity)', () => {
    const input: ResponsesInputItem[] = [
      {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: 'be terse' }],
      },
    ];
    const messages = translateResponsesInput(input);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[0].content, 'be terse');
  });
});

// ─────────────────────────────────────────────────────────────────────
// translateResponsesTools
// ─────────────────────────────────────────────────────────────────────

describe('translateResponsesTools — Responses tools[] → ai-sdk ToolSet (no execute)', () => {
  it('returns undefined for empty / missing input', () => {
    assert.equal(translateResponsesTools(undefined), undefined);
    assert.equal(translateResponsesTools([]), undefined);
  });

  it('forwards tool name + description + parameters; omits execute', () => {
    const tools: ResponsesTool[] = [
      {
        type: 'function',
        name: 'lookup',
        description: 'Search the web',
        parameters: { type: 'object', properties: { q: { type: 'string' } } },
      },
    ];
    const out = translateResponsesTools(tools);
    assert.ok(out);
    assert.ok(out!.lookup);
    // ai-sdk's Tool exposes `inputSchema` for definition-only tools.
    const t = out!.lookup as unknown as { description?: string; inputSchema: unknown; execute?: unknown };
    assert.equal(t.description, 'Search the web');
    assert.ok(t.inputSchema, 'inputSchema must be set so ai-sdk accepts the tool');
    assert.equal(t.execute, undefined, 'execute must be absent — Codex runs the tool itself');
  });

  it('synthesises empty-object schema when parameters is missing', () => {
    // Phase 5b smoke round 3 (2026-05-16): the translator now goes
    // through ai-sdk's `tool({ inputSchema: jsonSchema(...) })`
    // wrapper, so the resulting tool's inputSchema is the SDK's
    // FlexibleSchema wrapper (with `.validate()` / `.jsonSchema`),
    // not a raw `{ type: 'object', ... }`. The full streamText
    // contract pin lives in codex-proxy-tool-contract.test.ts.
    // This pin just confirms the wrapper carries the synthesised
    // schema fields ai-sdk reads (which include `jsonSchema`).
    const tools: ResponsesTool[] = [{ type: 'function', name: 'no_args' }];
    const out = translateResponsesTools(tools);
    const t = out!.no_args as unknown as { inputSchema: { jsonSchema?: { type?: string } } };
    assert.ok(t.inputSchema, 'wrapper must be present');
    assert.equal(t.inputSchema.jsonSchema?.type, 'object', 'underlying JSON Schema must still be the synthesised empty-object shape');
  });

  it('throws unsupported_tool_kind for non-function tool types', () => {
    const tools = [{ type: 'shell' } as unknown as ResponsesTool];
    assert.throws(
      () => translateResponsesTools(tools),
      /Unsupported tool kind|shell/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// translateStream
// ─────────────────────────────────────────────────────────────────────

async function collectStream(
  gen: AsyncGenerator<unknown, void, void>,
): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

function source<T>(parts: T[]): AsyncIterable<T> {
  return (async function* () {
    for (const p of parts) yield p;
  })();
}

describe('translateStream — ai-sdk fullStream → Codex Responses SSE (SDK fixture contract, 2026-05-16)', () => {
  // Reference contract: 资料/codex/sdk/typescript/tests/responsesProxy.ts
  // (assistantMessage / shell_call / responseCompleted / responseFailed).
  // Pre-fix smoke saw GLM/Kimi "completed but blank" because the
  // translator emitted only output_text.delta + completed without
  // the wrapping `output_item.done` that Codex's reader uses to land
  // the assistant message into the turn's items array.
  const baseBody: ResponsesRequestBody = {
    model: 'gpt-test',
    input: [],
    stream: true,
  };

  it('emits response.created on start (no required response.in_progress)', async () => {
    const events = await collectStream(
      translateStream({
        responseId: 'resp_x',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 } } as never,
        ]),
      }),
    );
    assert.equal((events[0] as { type: string }).type, 'response.created');
    assert.equal((events[1] as { type: string }).type, 'response.completed');
  });

  it('suppresses provider x_search from Codex while forwarding lifecycle and citations', async () => {
    const lifecycle: Array<Record<string, unknown>> = [];
    const events = await collectStream(
      translateStream({
        responseId: 'resp_x',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          { type: 'tool-input-start', id: 'xs_1', toolName: 'x_search' } as never,
          {
            type: 'tool-call',
            toolCallId: 'xs_1',
            toolName: 'x_search',
            input: {},
            providerExecuted: true,
          } as never,
          {
            type: 'tool-result',
            toolCallId: 'xs_1',
            toolName: 'x_search',
            output: { query: 'CodePilot', posts: [] },
            providerExecuted: true,
          } as never,
          {
            type: 'source',
            sourceType: 'url',
            id: 'source-1',
            url: 'https://x.com/example/status/1',
            title: 'Example post',
          } as never,
          { type: 'finish', finishReason: 'stop', totalUsage: {} } as never,
        ]),
        builtinToolNames: new Set(['x_search']),
        providerExecutedToolNames: new Set(['x_search']),
        onProviderToolEvent: event => lifecycle.push(event as unknown as Record<string, unknown>),
      }),
    );

    assert.equal(
      events.some(event => (event as { type: string }).type === 'response.output_item.done'),
      false,
      'provider-hosted calls must not leak to Codex as client-executed function calls',
    );
    assert.equal(lifecycle[0]?.type, 'started');
    assert.equal(lifecycle[1]?.type, 'completed');
    assert.equal(lifecycle[2]?.type, 'completed', 'late source enriches the same completed call');
    assert.deepEqual(lifecycle[2]?.sources, [{
      id: 'source-1',
      url: 'https://x.com/example/status/1',
      title: 'Example post',
      trust: 'external',
    }]);
  });

  it('emits output_item.added + output_text.delta + output_item.done(message) for a text block (SDK contract)', async () => {
    const events = await collectStream(
      translateStream({
        responseId: 'resp_x',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          { type: 'text-start', id: 't1' } as never,
          { type: 'text-delta', id: 't1', text: 'Hello' } as never,
          { type: 'text-delta', id: 't1', text: ' world' } as never,
          { type: 'text-end', id: 't1' } as never,
          { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } } as never,
        ]),
      }),
    );
    const types = events.map(e => (e as { type: string }).type);
    assert.deepEqual(types, [
      'response.created',
      'response.output_item.added',
      'response.output_text.delta',
      'response.output_text.delta',
      'response.output_item.done',
      'response.completed',
    ]);
    const added = events[1] as { output_index: number; item: { type: string; role: string } };
    assert.equal(added.output_index, 0);
    assert.equal(added.item.type, 'message');
    assert.equal(added.item.role, 'assistant');

    const done = events[4] as { item: { type: string; role: string; id: string; content: Array<{ type: string; text: string }> } };
    assert.equal(done.item.type, 'message', 'final item must be message');
    assert.equal(done.item.role, 'assistant');
    assert.equal(done.item.content[0].type, 'output_text', 'output content must be output_text per Codex schema');
    assert.equal(done.item.content[0].text, 'Hello world', 'output_item.done(message) must carry the FULL accumulated text — this is what Codex records');
  });

  it('text-delta WITHOUT a preceding text-start synthesizes output_item.added + delta (OpenRouter Anthropic-skin fix)', async () => {
    // Phase 5b smoke round 6 (2026-05-18) — real-credential smoke
    // showed OpenRouter Anthropic-skin (`anthropic/*` models via
    // OpenRouter's OpenAI-compatible /v1/chat/completions endpoint)
    // emitting `text-delta` chunks without a preceding `text-start`.
    // Pre-fix the translator's `if (idx === undefined) break;`
    // silently dropped every delta and the SSE only ever carried
    // context_usage + result + done — Codex saw a "completed but
    // blank" assistant message. Fix: first text-delta self-allocates
    // textIndices + emits the output_item.added preamble. This pin
    // captures that contract so a refactor can't quietly drop the
    // defensive allocation.
    const events = await collectStream(
      translateStream({
        responseId: 'resp_x',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          // intentionally NO text-start
          { type: 'text-delta', id: 't1', text: 'Hello' } as never,
          { type: 'text-delta', id: 't1', text: ' world' } as never,
          // intentionally NO text-end either — finish flushes (existing fix)
          { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } } as never,
        ]),
      }),
    );
    const types = events.map(e => (e as { type: string }).type);
    // Must include the preamble AND the deltas AND a final done +
    // completed. The added event is synthesized by the first delta
    // because text-start never fired.
    assert.deepEqual(
      types,
      [
        'response.created',
        'response.output_item.added',
        'response.output_text.delta',
        'response.output_text.delta',
        'response.output_item.done',
        'response.completed',
      ],
      `expected the round-6 defensive-allocation shape; got: ${types.join(',')}`,
    );
    const done = events.find(e => (e as { type: string }).type === 'response.output_item.done') as { item: { content: Array<{ text: string }> } };
    assert.equal(done.item.content[0].text, 'Hello world');
  });

  it('text-end WITHOUT a preceding text-start or text-delta still emits a canonical output_item.done', async () => {
    // Belt: the third unusual upstream shape — a cheap synthesizer
    // that emits ONLY text-end (no start, no delta) before finish.
    // The Codex reader still needs to see an output_item.done; we
    // emit an empty-content message rather than dropping silently.
    const events = await collectStream(
      translateStream({
        responseId: 'resp_x',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          { type: 'text-end', id: 't1' } as never,
          { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } } as never,
        ]),
      }),
    );
    const types = events.map(e => (e as { type: string }).type);
    assert.ok(
      types.includes('response.output_item.added'),
      'text-end without prior allocation must still synthesize the preamble',
    );
    assert.ok(
      types.includes('response.output_item.done'),
      'text-end must still emit output_item.done so Codex records the (empty) message',
    );
  });

  it('flushes missing output_item.done on finish (the GLM/Kimi blank-completion fix)', async () => {
    // Some upstreams emit text-delta but never text-end before finish.
    // Pre-fix this dropped the message entirely; Codex saw response.completed
    // with no preceding output_item.done(message) and rendered a blank
    // assistant message.
    const events = await collectStream(
      translateStream({
        responseId: 'resp_x',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          { type: 'text-start', id: 't1' } as never,
          { type: 'text-delta', id: 't1', text: 'partial' } as never,
          // intentionally no text-end
          { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } as never,
        ]),
      }),
    );
    const types = events.map(e => (e as { type: string }).type);
    assert.ok(
      types.includes('response.output_item.done'),
      `finish must flush a pending message as output_item.done — pre-fix this missed and Codex rendered blank. Saw: ${types.join(',')}`,
    );
    const done = events.find(e => (e as { type: string }).type === 'response.output_item.done') as { item: { content: Array<{ text: string }> } };
    assert.equal(done.item.content[0].text, 'partial', 'flushed message must carry the accumulated delta text');
  });

  it('function_call lands wholesale via output_item.done(function_call) (SDK contract)', async () => {
    // Per SDK responsesProxy.ts `shell_call()`, function_call is a
    // single output_item.done event with call_id/name/arguments —
    // no separate function_call.delta/done events.
    const events = await collectStream(
      translateStream({
        responseId: 'resp_x',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          { type: 'tool-input-start', id: 'call_1', toolName: 'lookup' } as never,
          { type: 'tool-input-delta', id: 'call_1', delta: '{"q":"weather"}' } as never,
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'lookup', input: { q: 'weather' } } as never,
          { type: 'finish', finishReason: 'tool-calls', rawFinishReason: 'tool_calls', totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } as never,
        ]),
      }),
    );
    const types = events.map(e => (e as { type: string }).type);
    // tool-input-* doesn't emit Responses events anymore — only the
    // final tool-call lands as output_item.done. No deltas on the wire.
    assert.deepEqual(types, [
      'response.created',
      'response.output_item.done',
      'response.completed',
    ]);
    const done = events[1] as { item: { type: string; call_id: string; name: string; arguments: string } };
    assert.equal(done.item.type, 'function_call');
    assert.equal(done.item.call_id, 'call_1');
    assert.equal(done.item.name, 'lookup');
    assert.equal(done.item.arguments, '{"q":"weather"}');
  });

  it('maps error to response.failed { response: { id, error: { code, message } } } per Codex app-server parser', async () => {
    // Phase 5b smoke round 6 (2026-05-16) — Codex's app-server SSE
    // parser only handles `response.failed` for stream errors. The
    // SDK fixture's `{type: 'error'}` form is unhandled and surfaces
    // as "stream closed before response.completed" silent failure.
    const events = await collectStream(
      translateStream({
        responseId: 'resp_x',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          { type: 'error', error: new Error('upstream boom') } as never,
        ]),
      }),
    );
    const last = events[events.length - 1] as {
      type: string;
      response: { id: string; error: { code: string; message: string } };
    };
    assert.equal(last.type, 'response.failed');
    assert.equal(last.response.id, 'resp_x');
    assert.match(last.response.error.message, /boom/);
    assert.ok(last.response.error.code, 'response.error.code is what Codex reads to classify the failure');
  });

  it('function_call sourced ONLY via tool-call (no tool-input-start) still lands cleanly', async () => {
    const events = await collectStream(
      translateStream({
        responseId: 'resp_x',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'lookup', input: { q: 'x' } } as never,
          { type: 'finish', finishReason: 'tool-calls', rawFinishReason: 'tool_calls', totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } as never,
        ]),
      }),
    );
    const types = events.map(e => (e as { type: string }).type);
    assert.deepEqual(types, [
      'response.created',
      'response.output_item.done',
      'response.completed',
    ]);
  });

  it('response.completed carries usage in SDK-fixture shape (input_tokens_details + output_tokens_details)', async () => {
    const events = await collectStream(
      translateStream({
        responseId: 'resp_x',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          {
            type: 'finish',
            finishReason: 'stop',
            rawFinishReason: 'stop',
            totalUsage: {
              inputTokens: 100,
              outputTokens: 200,
              totalTokens: 300,
              inputTokenDetails: { cacheReadTokens: 30 },
              outputTokenDetails: { reasoningTokens: 50 },
            },
          } as never,
        ]),
      }),
    );
    const completed = events[events.length - 1] as { response: { usage: { input_tokens: number; input_tokens_details: { cached_tokens: number } | null; output_tokens: number; output_tokens_details: { reasoning_tokens: number } | null; total_tokens: number } } };
    assert.equal(completed.response.usage.input_tokens, 100);
    assert.equal(completed.response.usage.input_tokens_details?.cached_tokens, 30);
    assert.equal(completed.response.usage.output_tokens, 200);
    assert.equal(completed.response.usage.output_tokens_details?.reasoning_tokens, 50);
    assert.equal(completed.response.usage.total_tokens, 300);
  });

  it('response.completed contains NO legacy `status` / `finish_reason` fields', async () => {
    // Pre-fix the completed shape had `{response: {id, status, usage, finish_reason}}`.
    // SDK fixture uses `{response: {id, usage}}` only. Pin the removal
    // so future "convenience" additions don't break Codex's parser.
    const events = await collectStream(
      translateStream({
        responseId: 'resp_x',
        body: baseBody,
        source: source([
          { type: 'start' } as never,
          { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } as never,
        ]),
      }),
    );
    const completed = events[events.length - 1] as { response: Record<string, unknown> };
    assert.equal((completed.response as { status?: unknown }).status, undefined, 'no `status` field on response per SDK fixture');
    assert.equal((completed.response as { finish_reason?: unknown }).finish_reason, undefined, 'no `finish_reason` field on response per SDK fixture');
  });
});

// ─────────────────────────────────────────────────────────────────────
// translateNonStreamResponse
// ─────────────────────────────────────────────────────────────────────

describe('translateNonStreamResponse — ai-sdk result → Responses JSON body', () => {
  it('builds a complete Responses object with assistant text', () => {
    const body = translateNonStreamResponse({
      responseId: 'resp_x',
      model: 'gpt-test',
      result: {
        text: 'all good',
        toolCalls: [],
        finishReason: 'stop',
        totalUsage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
      },
    });
    assert.equal(body.id, 'resp_x');
    assert.equal(body.object, 'response');
    assert.equal(body.status, 'completed');
    assert.equal(body.model, 'gpt-test');
    assert.equal(body.finish_reason, 'stop');
    assert.equal(body.output.length, 1);
    const msg = body.output[0] as { type: string; content: Array<{ type: string; text: string }> };
    assert.equal(msg.type, 'message');
    assert.equal(msg.content[0].type, 'output_text');
    assert.equal(msg.content[0].text, 'all good');
  });

  it('emits function_call output items for each tool call', () => {
    const body = translateNonStreamResponse({
      responseId: 'resp_y',
      model: 'gpt-test',
      result: {
        text: '',
        toolCalls: [
          { toolCallId: 'c1', toolName: 'lookup', input: { q: 'x' } },
          { toolCallId: 'c2', toolName: 'reply', input: 'literal-string' },
        ],
        finishReason: 'tool-calls',
        totalUsage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
      },
    });
    assert.equal(body.output.length, 2);
    const call1 = body.output[0] as { type: string; call_id: string; arguments: string };
    assert.equal(call1.type, 'function_call');
    assert.equal(call1.call_id, 'c1');
    assert.equal(call1.arguments, '{"q":"x"}');
    const call2 = body.output[1] as { type: string; arguments: string };
    assert.equal(call2.arguments, 'literal-string', 'string input passes through unchanged');
    assert.equal(body.finish_reason, 'tool_calls');
  });

  it('falls back to usage when totalUsage is absent', () => {
    const body = translateNonStreamResponse({
      responseId: 'r',
      model: 'm',
      result: {
        text: 'ok',
        toolCalls: [],
        finishReason: 'stop',
        usage: { inputTokens: 11, outputTokens: 22, totalTokens: 33 },
      },
    });
    assert.equal(body.usage.input_tokens, 11);
    assert.equal(body.usage.output_tokens, 22);
    assert.equal(body.usage.total_tokens, 33);
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildProviderOptions — forwarded fields for openai-oauth path
// ─────────────────────────────────────────────────────────────────────

describe('buildProviderOptions — forwards instructions + store for the Codex /responses endpoint', () => {
  it('always sets providerOptions.openai.store=false (Codex /responses rejects store:true)', () => {
    // Phase 5b smoke fix (2026-05-15). The openai-oauth Codex endpoint
    // (chatgpt.com/backend-api/codex/responses) returns HTTP 400
    // "Store must be set to false" unless we send store:false. ai-sdk's
    // openai responses(...) defaults this to true (public OpenAI dashboard
    // behaviour). buildProviderOptions must force false on every call so
    // the openai-oauth path stops returning 400.
    const opts = buildProviderOptions({ model: 'x', input: [] });
    assert.ok(opts, 'buildProviderOptions must return options even for a minimal body (so store gets set)');
    assert.equal(opts!.openai!.store, false);
  });

  it('honours an explicit body.store:false (the field round-trips from Codex through the parser)', () => {
    const opts = buildProviderOptions({ model: 'x', input: [], store: false });
    assert.equal(opts!.openai!.store, false);
  });

  it('honours an explicit body.store:true (the proxy doesn\'t silently override it)', () => {
    // Codex's Codex Account path never sends true, but the parser
    // accepts it. The adapter just trusts the body — if a caller
    // really wants store:true (e.g. against public OpenAI / OpenRouter
    // through codepilot_proxy), that's their call.
    const opts = buildProviderOptions({ model: 'x', input: [], store: true });
    assert.equal(opts!.openai!.store, true);
  });

  it('forwards body.instructions verbatim to providerOptions.openai.instructions', () => {
    // Codex's /responses endpoint also requires non-empty instructions
    // at the TOP level (not inside messages). ai-sdk's openai
    // responses(...) only puts it there from providerOptions.openai.
    // instructions. Codex always sends one; we forward it.
    const opts = buildProviderOptions({
      model: 'x',
      input: [],
      instructions: 'You are Codex.',
    });
    assert.equal(opts!.openai!.instructions, 'You are Codex.');
  });

  it('drops empty / whitespace-only instructions instead of forwarding a no-op', () => {
    const empty = buildProviderOptions({ model: 'x', input: [], instructions: '' });
    assert.equal((empty!.openai as Record<string, unknown>).instructions, undefined);
    const whitespace = buildProviderOptions({ model: 'x', input: [], instructions: '   ' });
    assert.equal((whitespace!.openai as Record<string, unknown>).instructions, undefined);
  });

  it('still forwards effort → anthropic.thinking + openai.reasoningEffort on the same options object', () => {
    // Regression guard: store/instructions sharing the same
    // out.openai bag must not clobber the existing reasoning effort
    // pass-through that powered the Anthropic / OpenAI reasoning
    // paths before this round.
    const opts = buildProviderOptions({
      model: 'x',
      input: [],
      reasoning: { effort: 'high' },
    });
    assert.equal((opts!.openai as Record<string, unknown>).reasoningEffort, 'high');
    assert.equal(opts!.openai!.store, false, 'store must still be set when other openai options are present');
    assert.ok(opts!.anthropic);
  });

  it('uses adaptive thinking + effort for Opus 5 instead of the legacy manual budget shape', () => {
    const opts = buildProviderOptions({
      model: 'opus-5',
      input: [],
      reasoning: { effort: 'high' },
    }, {
      anthropic: {
        model: 'claude-opus-5',
        isThirdPartyProxy: false,
      },
    });

    assert.deepEqual(opts!.anthropic, {
      thinking: { type: 'adaptive', display: 'summarized' },
      effort: 'high',
    });
    assert.equal(
      (opts!.anthropic!.thinking as Record<string, unknown>).budgetTokens,
      undefined,
      'manual budget tokens are rejected by the adaptive family',
    );
    assert.equal((opts!.openai as Record<string, unknown>).reasoningEffort, 'high');
  });

  it('preserves xhigh for an official adaptive Anthropic model', () => {
    const opts = buildProviderOptions({
      model: 'opus-5',
      input: [],
      reasoning: { effort: 'xhigh' },
    }, {
      anthropic: {
        model: 'claude-opus-5',
        isThirdPartyProxy: false,
      },
    });
    assert.deepEqual(opts!.anthropic, {
      thinking: { type: 'adaptive', display: 'summarized' },
      effort: 'xhigh',
    });
  });

  it('does not forward Codex xhigh to Sonnet 4.6, which supports max but not xhigh', () => {
    const opts = buildProviderOptions({
      model: 'sonnet',
      input: [],
      reasoning: { effort: 'xhigh' },
    }, {
      anthropic: {
        model: 'claude-sonnet-4-6',
        isThirdPartyProxy: false,
      },
    });
    assert.equal(
      (opts!.anthropic as Record<string, unknown>).effort,
      undefined,
      'a user Codex config can supply xhigh even though CodePilot hides it; the proxy boundary must still reject the tier',
    );
    assert.deepEqual((opts!.anthropic as Record<string, unknown>).thinking, {
      type: 'enabled',
      budgetTokens: 32000,
    });
  });

  it('removes manual budget thinking for every adaptive-family model', () => {
    for (const model of [
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-fable-5',
      'claude-sonnet-5',
      'claude-opus-5',
    ]) {
      const opts = buildProviderOptions({
        model,
        input: [],
        reasoning: { effort: 'high' },
      }, {
        anthropic: {
          model,
          isThirdPartyProxy: false,
        },
      });
      assert.deepEqual(opts!.anthropic, {
        thinking: { type: 'adaptive', display: 'summarized' },
        effort: 'high',
      }, model);
    }
  });

  it('does not send invalid manual thinking to an adaptive model through a third-party proxy', () => {
    const opts = buildProviderOptions({
      model: 'opus-5',
      input: [],
      reasoning: { effort: 'high' },
    }, {
      anthropic: {
        model: 'claude-opus-5',
        isThirdPartyProxy: true,
      },
    });
    assert.equal(opts!.anthropic, undefined);
  });
});

// ai@7 迁移回归（2026-07-03 用户实测抓到）：ai@7 禁止 messages 里出现
// role:'system'（"Use the instructions option instead"），旧 buildMessages 把
// body.instructions prepend 成 system message，Codex Runtime 发"你好"即抛错。
// buildPrompt 必须把一切 system 文本抽到 instructions 选项。
describe('buildPrompt — ai@7 system-in-messages regression', () => {
  it('instructions + 用户消息：system 文本走 instructions，messages 零 system（“你好”回归）', () => {
    const { instructions, messages } = buildPrompt({
      model: 'gpt-5.5-codex',
      instructions: 'You are Codex.',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '你好' }] }],
    });
    assert.equal(instructions, 'You are Codex.');
    assert.equal(messages.length, 1);
    assert.ok(messages.every((m) => m.role !== 'system'), 'messages must carry NO system role');
    assert.equal(messages[0].role, 'user');
  });

  it('input 里的 system/developer 项也被抽出合并进 instructions（body.instructions 在前）', () => {
    const { instructions, messages } = buildPrompt({
      model: 'gpt-5.5-codex',
      instructions: 'top-level',
      input: [
        { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'dev note' }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      ],
    });
    assert.ok(instructions!.startsWith('top-level'), 'body.instructions comes first');
    assert.ok(instructions!.includes('dev note'), 'developer item merged into instructions');
    assert.ok(messages.every((m) => m.role !== 'system'));
    assert.equal(messages.length, 1);
  });

  it('无任何 system 来源时 instructions 为 undefined', () => {
    const { instructions, messages } = buildPrompt({
      model: 'gpt-5.5-codex',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    });
    assert.equal(instructions, undefined);
    assert.equal(messages.length, 1);
  });
});
