/**
 * Phase 5c (2026-05-16) — parse-request tool classification.
 *
 * Pre-5c `parse-request.ts` silently dropped every non-function tool.
 * The drop was the surface manifestation of "CodePilot built-in tool
 * bridge isn't wired" — GLM/Kimi saw `imagegen` Skill text but had
 * no actual tool to call, and started CLI / auth.json / npm install
 * fallback chains.
 *
 * New behaviour:
 *   1. function tools: same path as before
 *   2. known non-function types (custom / plugin / web_search / ...):
 *      preserved in `passthroughTools` for diagnostic + future bridge
 *   3. unknown types: `unsupported_tool_kind` structured error
 *      instead of silent drop
 *
 * These tests pin all three branches so a future refactor that
 * "simplifies" the parser can't accidentally restore the silent drop.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponsesRequest } from '@/lib/codex/proxy/parse-request';

const baseBody = {
  model: 'gpt-4o',
  input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
  stream: true,
};

describe('parseResponsesRequest — tool classification (Phase 5c)', () => {
  it('function tools land on body.tools and have no passthroughTools', () => {
    const result = parseResponsesRequest({
      ...baseBody,
      tools: [
        { type: 'function', name: 'shell', description: 'run cmd', parameters: { type: 'object' } },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.tools?.length, 1);
    assert.equal(result.body.tools?.[0].name, 'shell');
    assert.equal(result.body.passthroughTools, undefined);
  });

  it('Codex `custom` tool (e.g. apply_patch / shell native surface) lands in passthroughTools, NOT silently dropped', () => {
    const result = parseResponsesRequest({
      ...baseBody,
      tools: [
        { type: 'custom', name: 'apply_patch', description: "Codex's native patch tool" },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.tools, undefined, 'no function tools → tools should be undefined, not []');
    assert.equal(result.body.passthroughTools?.length, 1);
    assert.equal(result.body.passthroughTools?.[0].rawType, 'custom');
    assert.equal(result.body.passthroughTools?.[0].name, 'apply_patch');
  });

  it('mixed tools split correctly between tools and passthroughTools', () => {
    const result = parseResponsesRequest({
      ...baseBody,
      tools: [
        { type: 'function', name: 'lookup' },
        { type: 'custom', name: 'apply_patch' },
        { type: 'function', name: 'compute' },
        { type: 'web_search' },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.body.tools?.map((t) => t.name),
      ['lookup', 'compute'],
      'function tools preserve order, with non-function entries filtered out',
    );
    assert.deepEqual(
      result.body.passthroughTools?.map((t) => t.rawType),
      ['custom', 'web_search'],
      'non-function entries preserve order too — log line wants to show what Codex sent',
    );
  });

  it('unknown tool type → unsupported_tool_kind structured error (NOT silent drop)', () => {
    const result = parseResponsesRequest({
      ...baseBody,
      tools: [
        { type: 'function', name: 'lookup' },
        { type: 'totally-new-codex-shape-2026', somefield: 'x' },
      ],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    // Field-level message names the offending index so a smoke run
    // can pinpoint which tool entry caused the rejection.
    assert.match(result.field ?? '', /tools\[1\]\.type/);
    assert.match(
      result.message,
      /unsupported type "totally-new-codex-shape-2026"/,
      'message must name the offending type verbatim so the bridge author knows what to add',
    );
    assert.match(
      result.message,
      /Known non-function types/,
      'message must enumerate the recognised types so the user sees the recoverable set',
    );
  });

  it('passthrough payload preserves Codex original entry (deep copy, no shared reference)', () => {
    const customTool = {
      type: 'custom',
      name: 'apply_patch',
      // Real Codex shapes carry nested config; we don't validate the
      // contents but we MUST preserve them so future bridge work
      // can read the shape from the saved request.
      config: { dryRun: false, allowList: ['*.ts'] },
    };
    const result = parseResponsesRequest({ ...baseBody, tools: [customTool] });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const preserved = result.body.passthroughTools?.[0];
    assert.deepEqual(preserved?.payload, customTool, 'payload must mirror Codex original entry verbatim');
    // Mutating the parsed payload must NOT mutate the caller's input
    // (parse-request did a shallow spread copy of the object).
    if (preserved && typeof preserved.payload.config === 'object' && preserved.payload.config !== null) {
      // Shallow spread doesn't deep-clone — but the top level is
      // independent, and that's enough to keep diagnostic logs from
      // surprising the caller mid-flight.
      assert.notStrictEqual(preserved.payload, customTool, 'top-level payload must be a fresh object, not the same reference');
    }
  });

  it('tools whose `type` field is missing/not-a-string → invalid_request, NOT unsupported_tool_kind', () => {
    const result = parseResponsesRequest({
      ...baseBody,
      tools: [{ name: 'no-type-field' }],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.field ?? '', /tools\[0\]\.type/);
    assert.match(result.message, /must be a string/);
  });

  it('all tools filtered (zero function, zero recognised non-function) → both fields undefined', () => {
    const result = parseResponsesRequest({ ...baseBody, tools: [] });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.tools, undefined);
    assert.equal(result.body.passthroughTools, undefined);
  });
});
