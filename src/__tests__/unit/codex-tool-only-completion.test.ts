/**
 * Phase 5b smoke round 10 (2026-05-16) — live-stream completion
 * consistency for tool-only turns.
 *
 * Round 9 fixed "image path 403". Round 10 fixes "image visible NOW
 * vs after switching chats". Three behaviour gaps closed here:
 *
 *   1. `buildFinalMessageContent` (stream-session-manager) used to
 *      return null when only tools were present (image generation
 *      with no continuation text). That left finalMessageContent
 *      null on the snapshot → ChatView never appended the assistant
 *      message → user had to switch sessions for the DB re-fetch
 *      to pick it up. Helper now treats text / thinking / tool_use
 *      / tool_result as independent signals: any single one builds
 *      a non-null final content.
 *
 *   2. Orphan tool_results (matching result with no matching
 *      tool_use in the same turn) were dropped on persistence.
 *      MessageItem.pairTools() already renders orphans; the helper
 *      now writes each unconsumed result as a standalone block so
 *      they survive history reload.
 *
 *   3. `canonicalToSseLine` for tool_completed now stringifies
 *      object `output` (imageGeneration hands us a ThreadItem
 *      object) and maps `event.error` onto `is_error: true` (which
 *      is what `useSSEStream` actually reads — the pre-fix raw
 *      `error` field was silently ignored).
 *
 * Together these unblock the "active stream → tool_use + media →
 * completion → immediate render" path so GPT-Image-2.0 results
 * become visible in the current ChatView without a session switch.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFinalMessageContent } from '@/lib/stream-session-manager';
import type { ToolUseInfo, ToolResultInfo, MediaBlock } from '@/types';

// ─────────────────────────────────────────────────────────────────────
// buildFinalMessageContent — accepts every shape of completion
// ─────────────────────────────────────────────────────────────────────

describe('buildFinalMessageContent — covers text-only, thinking-only, tool-only, orphan-result', () => {
  it('text only → returns the trimmed string (back-compat fast path)', () => {
    const out = buildFinalMessageContent({
      accumulated: '  hello world  ',
      thinking: '',
      toolUses: [],
      toolResults: [],
    });
    assert.equal(out, 'hello world', 'pure-text completions stay as plain strings');
  });

  it('completely empty → null (no message worth persisting)', () => {
    const out = buildFinalMessageContent({
      accumulated: '',
      thinking: '',
      toolUses: [],
      toolResults: [],
    });
    assert.equal(out, null);
  });

  it('TOOL-ONLY turn (image gen with no text) → non-null JSON blocks including media (P0 fix)', () => {
    // The GPT-Image-2.0 shape: assistant calls a tool, tool returns
    // with media, no follow-up text. Pre-fix this returned null →
    // ChatView never appended → user switched sessions to see it.
    const toolUse: ToolUseInfo = { id: 'tu_img_1', name: 'gpt_image_2', input: { prompt: 'a cat' } };
    const media: MediaBlock[] = [
      { type: 'image', mimeType: 'image/png', localPath: '/home/me/.codepilot/.codepilot-media/x.png', mediaId: 'm1' },
    ];
    const toolResult: ToolResultInfo = {
      tool_use_id: 'tu_img_1',
      content: '{"status":"completed"}',
      media,
    };
    const out = buildFinalMessageContent({
      accumulated: '',
      thinking: '',
      toolUses: [toolUse],
      toolResults: [toolResult],
    });
    assert.ok(out, 'tool-only turn must produce non-null finalMessageContent (this is the live-stream display bug)');
    const blocks = JSON.parse(out!) as Array<{ type: string; media?: unknown[]; tool_use_id?: string; name?: string }>;
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, 'tool_use');
    assert.equal(blocks[0].name, 'gpt_image_2');
    assert.equal(blocks[1].type, 'tool_result');
    assert.equal(blocks[1].tool_use_id, 'tu_img_1');
    assert.ok(Array.isArray(blocks[1].media), 'media must survive into the persisted content');
    assert.equal(blocks[1].media!.length, 1);
  });

  it('ORPHAN tool_result (no matching tool_use) → still written into blocks (P0 fix)', () => {
    // Codex sometimes emits item/completed without the matching
    // tool_started having been pushed into the array (race / reorder
    // / partial event drop). Pre-fix the orphan was discarded by the
    // persistence layer even though MessageItem.pairTools renders it
    // correctly. Now they ride alongside the paired ones.
    const orphan: ToolResultInfo = {
      tool_use_id: 'tu_orphan',
      content: '{"image":"<base64>","saved_path":"/tmp/orphan.png"}',
      media: [{ type: 'image', mimeType: 'image/png', localPath: '/home/me/.codepilot/.codepilot-media/orphan.png' }],
    };
    const out = buildFinalMessageContent({
      accumulated: '',
      thinking: '',
      toolUses: [],
      toolResults: [orphan],
    });
    assert.ok(out, 'orphan-only tool_result must still produce a persisted message');
    const blocks = JSON.parse(out!) as Array<{ type: string; tool_use_id?: string; media?: unknown[] }>;
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'tool_result');
    assert.equal(blocks[0].tool_use_id, 'tu_orphan');
    assert.ok(Array.isArray(blocks[0].media), 'orphan media survives');
  });

  it('matched pairs + orphans coexist in the same turn', () => {
    const matchedUse: ToolUseInfo = { id: 'tu_paired', name: 'lookup', input: {} };
    const matchedResult: ToolResultInfo = { tool_use_id: 'tu_paired', content: 'ok' };
    const orphanResult: ToolResultInfo = { tool_use_id: 'tu_orphan', content: 'orphan-payload' };
    const out = buildFinalMessageContent({
      accumulated: 'wrapping text',
      thinking: '',
      toolUses: [matchedUse],
      toolResults: [matchedResult, orphanResult],
    });
    const blocks = JSON.parse(out!) as Array<{ type: string; tool_use_id?: string; text?: string }>;
    // Expect text → tool_use → tool_result(matched) → tool_result(orphan)
    assert.equal(blocks.length, 4);
    assert.equal(blocks[0].type, 'text');
    assert.equal(blocks[0].text, 'wrapping text');
    assert.equal(blocks[1].type, 'tool_use');
    assert.equal(blocks[2].type, 'tool_result');
    assert.equal(blocks[2].tool_use_id, 'tu_paired');
    assert.equal(blocks[3].type, 'tool_result');
    assert.equal(blocks[3].tool_use_id, 'tu_orphan');
  });

  it('tool_result.content stays string when normalised', () => {
    // Defensive — SSE boundary stringifies, but the helper must not
    // re-introduce object types. Feed an object-typed `content` and
    // confirm the JSON output has it as a string.
    const orphan = {
      tool_use_id: 'tu_x',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content: { foo: 'bar' } as any,
    };
    const out = buildFinalMessageContent({
      accumulated: '',
      thinking: '',
      toolUses: [],
      toolResults: [orphan as unknown as ToolResultInfo],
    });
    const blocks = JSON.parse(out!) as Array<{ content: unknown }>;
    assert.equal(typeof blocks[0].content, 'string', 'tool_result.content type contract: always string');
    assert.equal(blocks[0].content, '{"foo":"bar"}', 'object content is JSON-stringified');
  });

  it('thinking only → wraps in [thinking] block', () => {
    const out = buildFinalMessageContent({
      accumulated: '',
      thinking: 'pondering...',
      toolUses: [],
      toolResults: [],
    });
    const blocks = JSON.parse(out!) as Array<{ type: string }>;
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'thinking');
  });

  it('tool_use + tool_result with consumed pairing avoids double-counting orphans', () => {
    // Pin that consumed results are NOT also emitted as orphans.
    const use: ToolUseInfo = { id: 'tu_1', name: 'fn', input: {} };
    const result: ToolResultInfo = { tool_use_id: 'tu_1', content: 'r' };
    const out = buildFinalMessageContent({
      accumulated: '',
      thinking: '',
      toolUses: [use],
      toolResults: [result],
    });
    const blocks = JSON.parse(out!) as Array<{ type: string; tool_use_id?: string }>;
    assert.equal(blocks.length, 2, 'paired tool_use + tool_result → exactly 2 blocks');
    assert.equal(blocks[0].type, 'tool_use');
    assert.equal(blocks[1].type, 'tool_result');
  });

  it('tool_use without a received result persists an honest terminal error pair', () => {
    const out = buildFinalMessageContent({
      accumulated: '',
      thinking: '',
      toolUses: [{ id: 'tu_stopped', name: 'Read', input: { file_path: 'README.md' } }],
      toolResults: [],
    });
    const blocks = JSON.parse(out!) as Array<{
      type: string;
      tool_use_id?: string;
      content?: string;
      is_error?: boolean;
    }>;
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, 'tool_use');
    assert.deepEqual(blocks[1], {
      type: 'tool_result',
      tool_use_id: 'tu_stopped',
      content: '[CodePilot: no tool result was received before this turn ended.]',
      is_error: true,
    });
  });

  it('persists provider-reported external sources on the matching tool result', () => {
    const out = buildFinalMessageContent({
      accumulated: '',
      thinking: '',
      toolUses: [{ id: 'x-search-1', name: 'x_search', input: {} }],
      toolResults: [{
        tool_use_id: 'x-search-1',
        content: '{}',
        sources: [{
          id: 'source-1',
          url: 'https://x.com/example/status/1',
          title: 'Example post',
          trust: 'external',
        }],
      }],
    });
    const blocks = JSON.parse(out!) as Array<{ type: string; sources?: Array<{ url: string; trust: string }> }>;
    assert.deepEqual(blocks[1].sources, [{
      id: 'source-1',
      url: 'https://x.com/example/status/1',
      title: 'Example post',
      trust: 'external',
    }]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// canonicalToSseLine (SSE boundary) — content stringification + is_error
// ─────────────────────────────────────────────────────────────────────

describe('codex/runtime.canonicalToSseLine — tool_result wire shape', () => {
  it('stringifyToolResultContent normalises object output to JSON string', async () => {
    const { stringifyToolResultContent } = await import('@/lib/codex/runtime');
    assert.equal(stringifyToolResultContent('plain'), 'plain', 'strings pass through');
    assert.equal(stringifyToolResultContent(null), '', 'null → empty');
    assert.equal(stringifyToolResultContent(undefined), '', 'undefined → empty');
    assert.equal(stringifyToolResultContent({ a: 1 }), '{"a":1}', 'objects stringify');
    assert.equal(stringifyToolResultContent([1, 2]), '[1,2]', 'arrays stringify');
    assert.equal(stringifyToolResultContent(42), '42', 'primitives stringify');
  });

  it('circular reference falls back to String() rather than throwing', async () => {
    const { stringifyToolResultContent } = await import('@/lib/codex/runtime');
    const circular: Record<string, unknown> = { name: 'x' };
    circular.self = circular;
    // Should NOT throw; should return something non-empty.
    const out = stringifyToolResultContent(circular);
    assert.ok(typeof out === 'string' && out.length > 0);
  });
});

describe('codex/runtime.canonicalToSseLine source — tool_result emits is_error + stringified content (round 10)', () => {
  // The canonicalToSseLine function is private inside codex/runtime.ts.
  // Source-grep is the cheapest pin that catches a regression
  // without booting the runtime (which requires Codex app-server).
  // Pairs with the live unit tests on stringifyToolResultContent above.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../lib/codex/runtime.ts'),
    'utf8',
  );

  it('tool_completed arm calls stringifyToolResultContent on event.output', () => {
    const arm = src.match(/case 'tool_completed':\s*\{[\s\S]{0,2500}\}/);
    assert.ok(arm, 'tool_completed case must be present in canonicalToSseLine');
    assert.match(
      arm![0],
      /stringifyToolResultContent\(event\.output\)/,
      'content must run through stringifyToolResultContent so downstream ToolResultInfo.content stays a string',
    );
  });

  it('tool_completed arm maps event.error → is_error: true (NOT raw error field)', () => {
    const arm = src.match(/case 'tool_completed':\s*\{[\s\S]{0,2500}\}/);
    assert.ok(arm);
    assert.match(
      arm![0],
      /is_error:\s*true/,
      'useSSEStream reads resultData.is_error; raw `error` field is not consumed',
    );
    // Belt-and-braces: the error message must land in content so the
    // UI's error rendering picks up some text.
    assert.match(
      arm![0],
      /event\.error/,
      'event.error must still be inspected so we know when to set is_error',
    );
  });

  it('tool_completed arm forwards provider sources into tool_result', () => {
    const arm = src.match(/case 'tool_completed':\s*\{[\s\S]{0,3000}\}/);
    assert.ok(arm);
    assert.match(arm![0], /event\.sources/);
  });
});
