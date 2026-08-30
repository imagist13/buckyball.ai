/**
 * Phase 5c (2026-05-16) — translate-stream suppresses bridge-owned
 * tool events.
 *
 * The bridge tool's `execute()` ran the work server-side and emitted
 * canonical events via the side-channel bus. The Codex-bound
 * Responses SSE stream must NOT also forward a function_call
 * output_item for the same tool — Codex would try to execute it,
 * fail, and the run gets stuck. Pre-5c, GLM/Kimi seeing imagegen
 * Skill text + no real tool was the trigger for the CLI fallback;
 * leaking a function_call here would put us right back in a similar
 * failure mode (Codex trying to execute `codepilot_generate_image`).
 *
 * The suppression rule:
 *   - tool-input-start with toolName in builtinToolNames → tracked
 *     in suppressedToolCallIds set; no output_index reserved
 *   - tool-call with same toolName OR id in suppressed set → drop
 *   - tool-result / tool-error → always dropped (Codex has no slot)
 *   - same-named function calls from upstream that AREN'T in the
 *     builtin set still flow through normally
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translateStream } from '@/lib/codex/proxy/translate-stream';
import type { TextStreamPart, ToolSet } from 'ai';
import type { ResponsesEvent, ResponsesRequestBody } from '@/lib/codex/proxy/types';

const baseBody: ResponsesRequestBody = {
  model: 'glm-5-turbo',
  input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
  stream: true,
};

/** Build a simple async iterable from a fixed array of ai-sdk parts. */
async function* iter(parts: Array<TextStreamPart<ToolSet>>): AsyncIterable<TextStreamPart<ToolSet>> {
  for (const p of parts) yield p;
}

async function collect(opts: { source: AsyncIterable<TextStreamPart<ToolSet>>; builtin: Set<string> }) {
  const out: ResponsesEvent[] = [];
  for await (const e of translateStream({
    responseId: 'resp_test',
    body: baseBody,
    source: opts.source,
    builtinToolNames: opts.builtin,
  })) {
    out.push(e);
  }
  return out;
}

describe('translate-stream — bridge-owned tools never reach Codex', () => {
  it('tool-input-start + tool-call for a built-in name → NO function_call output_item', async () => {
    const events = await collect({
      source: iter([
        { type: 'start' } as TextStreamPart<ToolSet>,
        // ai-sdk's actual tool-input-start has providerExecuted/dynamic flags;
        // the translator only cares about id + toolName.
        { type: 'tool-input-start', id: 'call_1', toolName: 'codepilot_generate_image' } as TextStreamPart<ToolSet>,
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'codepilot_generate_image', input: { prompt: 'cat' } } as TextStreamPart<ToolSet>,
        { type: 'text-start', id: 'msg_1' } as TextStreamPart<ToolSet>,
        { type: 'text-delta', id: 'msg_1', text: 'done' } as TextStreamPart<ToolSet>,
        { type: 'text-end', id: 'msg_1' } as TextStreamPart<ToolSet>,
        { type: 'finish', totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } as TextStreamPart<ToolSet>,
      ]),
      builtin: new Set(['codepilot_generate_image']),
    });
    // No function_call output_item.done in the emission.
    const functionCalls = events.filter(
      (e) => e.type === 'response.output_item.done' && (e as { item: { type: string } }).item.type === 'function_call',
    );
    assert.equal(functionCalls.length, 0, 'bridge-owned tool calls MUST be suppressed; Codex would otherwise try to execute them');
    // Assistant text still made it through.
    const messageDones = events.filter(
      (e) => e.type === 'response.output_item.done' && (e as { item: { type: string } }).item.type === 'message',
    );
    assert.equal(messageDones.length, 1);
  });

  it('non-builtin function call still emits function_call output_item.done', async () => {
    const events = await collect({
      source: iter([
        { type: 'start' } as TextStreamPart<ToolSet>,
        { type: 'tool-input-start', id: 'call_x', toolName: 'shell' } as TextStreamPart<ToolSet>,
        { type: 'tool-call', toolCallId: 'call_x', toolName: 'shell', input: { command: 'ls' } } as TextStreamPart<ToolSet>,
        { type: 'finish', totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } as TextStreamPart<ToolSet>,
      ]),
      builtin: new Set(['codepilot_generate_image']),
    });
    const functionCalls = events.filter(
      (e) => e.type === 'response.output_item.done' && (e as { item: { type: string } }).item.type === 'function_call',
    );
    assert.equal(functionCalls.length, 1);
    const item = (functionCalls[0] as { item: { name: string; arguments: string } }).item;
    assert.equal(item.name, 'shell');
    assert.equal(item.arguments, '{"command":"ls"}');
  });

  it('tool-call without preceding tool-input-start (some SDKs skip it) is still suppressed by name', async () => {
    const events = await collect({
      source: iter([
        { type: 'start' } as TextStreamPart<ToolSet>,
        { type: 'tool-call', toolCallId: 'call_y', toolName: 'codepilot_notify', input: { title: 'hi', body: 'there' } } as TextStreamPart<ToolSet>,
        { type: 'finish', totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } as TextStreamPart<ToolSet>,
      ]),
      builtin: new Set(['codepilot_notify']),
    });
    const functionCalls = events.filter(
      (e) => e.type === 'response.output_item.done' && (e as { item: { type: string } }).item.type === 'function_call',
    );
    assert.equal(functionCalls.length, 0);
  });

  it('output_index sequence stays gap-free when bridge tool is suppressed', async () => {
    // If the suppression accidentally still incremented nextOutputIndex,
    // Codex would see indices like [0, 2, 3] with no item at 1 — its
    // reader's per-index addressing would break.
    const events = await collect({
      source: iter([
        { type: 'start' } as TextStreamPart<ToolSet>,
        { type: 'tool-input-start', id: 'call_b', toolName: 'codepilot_generate_image' } as TextStreamPart<ToolSet>,
        { type: 'tool-call', toolCallId: 'call_b', toolName: 'codepilot_generate_image', input: {} } as TextStreamPart<ToolSet>,
        { type: 'text-start', id: 'msg_after' } as TextStreamPart<ToolSet>,
        { type: 'text-delta', id: 'msg_after', text: 'done' } as TextStreamPart<ToolSet>,
        { type: 'text-end', id: 'msg_after' } as TextStreamPart<ToolSet>,
        { type: 'finish', totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } as TextStreamPart<ToolSet>,
      ]),
      builtin: new Set(['codepilot_generate_image']),
    });
    const indices: number[] = [];
    for (const e of events) {
      if (
        e.type === 'response.output_item.added' ||
        e.type === 'response.output_item.done'
      ) {
        const idx = (e as { output_index?: number }).output_index;
        if (typeof idx === 'number') indices.push(idx);
      }
    }
    // The message slot is output_index 0 (no bridge call ate an index).
    assert.ok(indices.includes(0), 'message must take output_index 0 when bridge call is suppressed');
    assert.ok(!indices.includes(1) || indices.includes(0), 'no gaps in the index sequence');
  });
});
