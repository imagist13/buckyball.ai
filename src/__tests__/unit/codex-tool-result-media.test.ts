/**
 * Phase 5b smoke round 8 (2026-05-16) — Codex tool_result.media path.
 *
 * Pins the end-to-end path that makes GPT-Image-2.0 results actually
 * render as inline image cards in the chat:
 *
 *   Codex item/completed (imageGeneration / imageView)
 *   → translateCodexNotification
 *   → makeToolCompleted({ output, media: [MediaBlock] })
 *   → canonicalToSseLine emits `data: {"type":"tool_result", data:"{
 *       \"tool_use_id\":\"...\", \"content\":..., \"media\":[...]}"}`
 *   → useSSEStream handleSSEEvent's tool_result case forwards
 *     `resultData.media` array onto SSECallbacks.onToolResult
 *   → MediaPreview reads tool_result.media to render image inline.
 *
 * Earlier rounds (round 7) surfaced the imageGeneration completion
 * as a tool_completed event but didn't populate `media` — so the
 * SSE line carried the image data inside `content` as JSON and the
 * renderer had nothing to pick up. This file pins both halves:
 *
 *   1. translateCodexNotification emits a media field on the canonical
 *      tool_completed event for imageGeneration / imageView items.
 *   2. canonicalToSseLine in codex/runtime.ts source includes `media`
 *      in the tool_result SSE payload when present.
 *   3. useSSEStream's tool_result case parses `resultData.media` and
 *      forwards it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { translateCodexNotification } from '@/lib/codex/event-mapper';

const ctx = { sessionId: 's-1' } as const;

const runtimeSrc = fs.readFileSync(
  path.resolve(__dirname, '../../lib/codex/runtime.ts'),
  'utf8',
);
const useSseSrc = fs.readFileSync(
  path.resolve(__dirname, '../../hooks/useSSEStream.ts'),
  'utf8',
);

// ─────────────────────────────────────────────────────────────────────
// Step 1 — canonical event carries `media`
// ─────────────────────────────────────────────────────────────────────

describe('Codex tool_result media — canonical event populated for image items', () => {
  it('imageGeneration with savedPath → MediaBlock with localPath + inferred mimeType', () => {
    const event = translateCodexNotification(
      'item/completed',
      {
        item: {
          type: 'imageGeneration',
          id: 'img-1',
          status: 'completed',
          revisedPrompt: null,
          result: '<base64>',
          savedPath: '/tmp/codex/out.webp',
        },
        threadId: 't', turnId: 'u', completedAtMs: 0,
      },
      ctx,
    );
    if (event?.type !== 'tool_completed') throw new Error('unreachable');
    assert.ok(event.media);
    assert.equal(event.media!.length, 1);
    const m = event.media![0];
    assert.equal(m.type, 'image');
    assert.equal(m.localPath, '/tmp/codex/out.webp');
    assert.equal(m.mimeType, 'image/webp', 'mimeType resolved from .webp extension');
    // When savedPath exists we prefer localPath; don't double-ship the
    // base64 (saves a few KB on the wire).
    assert.equal(m.data, undefined);
  });

  it('imageGeneration with revisedPrompt: MediaBlock carries sourceMetadata so the library row gets the real prompt (2026-05-28)', () => {
    // The import layer (materializeCodexEventMedia) reads block.sourceMetadata
    // and passes its prompt + model into importFileToLibrary so gallery
    // rows are searchable by the actual generation prompt, not by filename.
    const event = translateCodexNotification(
      'item/completed',
      {
        item: {
          type: 'imageGeneration',
          id: 'img-prompted',
          status: 'completed',
          revisedPrompt: 'a calm pond at dusk with floating lanterns',
          result: '<base64>',
          savedPath: '/tmp/codex/out.webp',
        },
        threadId: 't', turnId: 'u', completedAtMs: 0,
      },
      ctx,
    );
    if (event?.type !== 'tool_completed') throw new Error('unreachable');
    const m = event.media![0];
    assert.deepEqual(m.sourceMetadata, {
      prompt: 'a calm pond at dusk with floating lanterns',
      model: 'codex-image',
      persistence: 'durable_asset',
    });
  });

  it('imageGeneration without revisedPrompt is still marked as a durable Asset', () => {
    const event = translateCodexNotification(
      'item/completed',
      {
        item: {
          type: 'imageGeneration',
          id: 'img-bare',
          status: 'completed',
          revisedPrompt: null,
          result: '<base64>',
          savedPath: '/tmp/codex/out.webp',
        },
        threadId: 't', turnId: 'u', completedAtMs: 0,
      },
      ctx,
    );
    if (event?.type !== 'tool_completed') throw new Error('unreachable');
    assert.deepEqual(event.media![0].sourceMetadata, {
      persistence: 'durable_asset',
    });
  });

  it('imageView always emits a media block', () => {
    const event = translateCodexNotification(
      'item/completed',
      { item: { type: 'imageView', id: 'view-1', path: '/Users/me/p.gif' }, threadId: 't', turnId: 'u', completedAtMs: 0 },
      ctx,
    );
    if (event?.type !== 'tool_completed') throw new Error('unreachable');
    assert.equal(event.media?.[0].localPath, '/Users/me/p.gif');
    assert.equal(event.media?.[0].mimeType, 'image/gif');
    assert.deepEqual(event.media?.[0].sourceMetadata, {
      persistence: 'preview_only',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Step 2 — canonicalToSseLine source carries `media` through
// ─────────────────────────────────────────────────────────────────────

describe('canonicalToSseLine emits tool_result.media (source-level pin)', () => {
  it('tool_completed arm includes media in the SSE payload when present', () => {
    // Look for the tool_result emission in canonicalToSseLine and
    // confirm `media: event.media` (or the conditional shape we use)
    // is in the SSE data payload. Source-grep rather than runtime so
    // the test doesn't have to mock the full event stream.
    // Window widened in round 10 — explanatory comment in the arm
    // grew past the old 1500-char ceiling after the is_error fix.
    const toolCompletedArm = runtimeSrc.match(/case 'tool_completed':[\s\S]{0,3000}?\n {4}case /);
    assert.ok(toolCompletedArm, 'tool_completed arm must exist in canonicalToSseLine');
    assert.match(
      toolCompletedArm![0],
      /event\.media[\s\S]{0,80}media:\s*event\.media/,
      'tool_completed SSE payload must conditionally include `media: event.media`',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Step 3 — useSSEStream forwards resultData.media to onToolResult
// ─────────────────────────────────────────────────────────────────────

describe('useSSEStream forwards tool_result.media to MediaPreview', () => {
  it('tool_result case picks up resultData.media when present', () => {
    // Existing pin in the source: `Array.isArray(resultData.media) &&
    // resultData.media.length > 0 ? { media: resultData.media } : {}`.
    // This test makes the contract explicit so a future refactor that
    // drops the forward trips immediately.
    assert.match(
      useSseSrc,
      /case 'tool_result':[\s\S]{0,800}Array\.isArray\(resultData\.media\)[\s\S]{0,80}media:\s*resultData\.media/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Step 4 — end-to-end shape on the SSE wire
// ─────────────────────────────────────────────────────────────────────

describe('Codex tool_result.media end-to-end SSE shape', () => {
  // We can't invoke canonicalToSseLine directly without booting Codex
  // (it lives inside runtime.ts behind the app-server boot), so
  // synthesise the SSE line the way runtime.ts would emit it given
  // a canonical event, and confirm the shape downstream consumers
  // expect. The two file-level pins above guarantee runtime.ts and
  // useSSEStream.ts both honour the same shape.
  it('synthesised tool_result SSE line carries media[] alongside content', () => {
    const event = translateCodexNotification(
      'item/completed',
      {
        item: {
          type: 'imageGeneration',
          id: 'img-end-to-end',
          status: 'completed',
          revisedPrompt: 'a robot',
          result: '<base64>',
          savedPath: '/tmp/robot.png',
        },
        threadId: 't', turnId: 'u', completedAtMs: 0,
      },
      ctx,
    );
    if (event?.type !== 'tool_completed') throw new Error('unreachable');
    // Mirror canonicalToSseLine's emission. If this stays in sync
    // with the runtime source it pins the wire payload that the chat
    // side parses.
    const sseLine = `data: ${JSON.stringify({
      type: 'tool_result',
      data: JSON.stringify({
        tool_use_id: event.toolId,
        content: event.output ?? '',
        ...(event.error ? { error: event.error } : {}),
        ...(event.media && event.media.length > 0 ? { media: event.media } : {}),
      }),
    })}\n\n`;
    // Parse it back the way useSSEStream does.
    const outer = JSON.parse(sseLine.slice('data: '.length, -2));
    assert.equal(outer.type, 'tool_result');
    const inner = JSON.parse(outer.data);
    assert.equal(inner.tool_use_id, 'img-end-to-end');
    assert.ok(Array.isArray(inner.media), 'tool_result.media must be an array');
    assert.equal(inner.media.length, 1);
    assert.equal(inner.media[0].type, 'image');
    assert.equal(inner.media[0].localPath, '/tmp/robot.png');
    assert.equal(inner.media[0].mimeType, 'image/png');
  });

  it('non-image tools omit media so the chat-side renderer skips them', () => {
    // commandExecution doesn't carry an image; the SSE line must NOT
    // include a media field (downstream would render nothing visible
    // but `Array.isArray(undefined)` would also short-circuit — pin
    // the omission directly to avoid wire bloat).
    const event = translateCodexNotification(
      'item/completed',
      { item: { type: 'commandExecution', id: 'cmd-1', command: 'ls', exitCode: 0, aggregatedOutput: 'a\nb' }, threadId: 't', turnId: 'u', completedAtMs: 0 },
      ctx,
    );
    if (event?.type !== 'tool_completed') throw new Error('unreachable');
    assert.equal(event.media, undefined, 'non-image tools must not invent a media payload');
  });
});
