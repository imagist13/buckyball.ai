/**
 * Phase 5d Phase 2 P0 (2026-05-17) — Codex proxy adapter MUST send
 * the compiler-produced prompt through the `messages[]` channel,
 * not only through `providerOptions.openai.instructions`.
 *
 * Pre-fix the adapter called `buildMessages(input.body)` BEFORE
 * `compileContext` and `bodyWithBridgePrompt`, so the compiler
 * prompt only travelled via `providerOptions.openai.instructions`.
 * That field is consumed by OpenAI Responses-API paths; Anthropic-
 * compatible / CodePlan / OpenAI chat-completions paths read the
 * messages array and would have lost the wire-format spec + every
 * capability prompt on the send path.
 *
 * Two layers of pin here:
 *   1. Source-grep: forbid `buildMessages(input.body)` in
 *      unified-adapter.ts (must be `buildMessages(bodyWithBridgePrompt)`).
 *   2. Behavioural: drive a real `createUnifiedAdapter` against a
 *      mock provider stub via `registerAdapter`-free path is hard,
 *      so verify via source-pin that bodyWithBridgePrompt is what
 *      flows into buildMessages.
 *
 * If the proxy ever invokes a real `streamText`, the system message
 * the upstream model receives is `bodyWithBridgePrompt.instructions`
 * (which contains the compiler's `systemPromptText` spliced via
 * `combineInstructions`). The pin below confirms the ordering that
 * makes this true.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ADAPTER_SRC_RAW = fs.readFileSync(
  path.resolve(__dirname, '../../lib/codex/proxy/unified-adapter.ts'),
  'utf-8',
);

/** Strip line + block comments + JSDoc-continuation lines so the
 *  source-pins can target actual code rather than the slice's
 *  explanatory comments (which intentionally quote pre-fix shapes
 *  like `buildMessages(input.body)` for context). */
function stripComments(src: string): string {
  const lines: string[] = [];
  let inBlock = false;
  for (const raw of src.split('\n')) {
    const trimmed = raw.trimStart();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true;
      continue;
    }
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('*')) continue;
    // Strip trailing `// ...` line comments.
    const idx = raw.indexOf('//');
    lines.push(idx >= 0 ? raw.slice(0, idx) : raw);
  }
  return lines.join('\n');
}

const ADAPTER_SRC = stripComments(ADAPTER_SRC_RAW);

describe('unified-adapter — compiler prompt reaches the model (P0 regression)', () => {
  // ai@7 迁移（2026-07-03）：投递载具从 "messages[] 里的 role:system" 换成
  // streamText/generateText 的 `instructions` 选项 —— ai@7 直接拒绝 messages
  // 里的 system role（"Use the instructions option instead"）；SDK core 会在
  // 非 Responses 家族的 wire 上把 instructions 还原为 system message
  // （node_modules/ai/dist/index.js convertToLanguageModelPrompt），所以
  // P0 的"所有 provider 家族都能收到编译器 prompt"不变量依然由本组 pin 保护。
  it('source MUST NOT call buildPrompt(input.body) anywhere', () => {
    assert.equal(
      /buildPrompt\(\s*input\.body\s*\)/.test(ADAPTER_SRC),
      false,
      'buildPrompt(input.body) is the pre-P0 shape — re-introducing it loses the compiler prompt for every provider path',
    );
  });

  it('source MUST call buildPrompt(bodyWithBridgePrompt) — the spliced body', () => {
    assert.match(
      ADAPTER_SRC,
      /buildPrompt\(\s*bodyWithBridgePrompt\s*\)/,
      'adapter must feed buildPrompt the body that already has compiler prompt spliced into instructions',
    );
  });

  it('source MUST run adaptForCodexProxy BEFORE buildPrompt', () => {
    // Phase 5d Phase 3 (2026-05-17) — the compile call moved into
    // the Runtime Capability Adapter facade (`adaptForCodexProxy`).
    // The ordering invariant is the same: the facade call (which
    // internally runs `compileContext`) must finish before
    // `buildMessages` reads `bodyWithBridgePrompt.instructions`.
    // Pin shifted from `compileContext({` to `adaptForCodexProxy({`.
    const compileIdx = ADAPTER_SRC.indexOf('adaptForCodexProxy({');
    const buildMessagesIdx = ADAPTER_SRC.indexOf('buildPrompt(bodyWithBridgePrompt)');
    assert.ok(compileIdx > 0, 'adaptForCodexProxy({...}) call must exist');
    assert.ok(buildMessagesIdx > 0, 'buildPrompt(bodyWithBridgePrompt) call must exist');
    assert.ok(
      compileIdx < buildMessagesIdx,
      `adaptForCodexProxy (idx=${compileIdx}) must run BEFORE buildPrompt (idx=${buildMessagesIdx}); reversing the order is the P0 regression`,
    );
  });

  it('source MUST run bodyWithBridgePrompt construction BEFORE buildPrompt', () => {
    // The body splice happens in a `const bodyWithBridgePrompt =`
    // line. Confirm it precedes the buildMessages call so the
    // spliced instructions are actually what buildMessages reads.
    const bodySpliceIdx = ADAPTER_SRC.indexOf('const bodyWithBridgePrompt');
    const buildMessagesIdx = ADAPTER_SRC.indexOf('buildPrompt(bodyWithBridgePrompt)');
    assert.ok(bodySpliceIdx > 0);
    assert.ok(buildMessagesIdx > 0);
    assert.ok(
      bodySpliceIdx < buildMessagesIdx,
      'bodyWithBridgePrompt must be constructed before buildPrompt is called',
    );
  });
});

describe('unified-adapter — instructions travel via the ai@7 `instructions` OPTION (downstream contract)', () => {
  it('buildPrompt must NOT prepend role:system into messages (ai@7 rejects it)', () => {
    assert.equal(
      /role:\s*['"]system['"]\s*,\s*content:\s*body\.instructions/.test(ADAPTER_SRC),
      false,
      'prepending body.instructions as role:system is the pre-ai@7 shape — ai@7 throws "System messages are not allowed in the prompt or messages fields"',
    );
  });

  it('streamText and generateText both receive the instructions option', () => {
    const spreads = ADAPTER_SRC.match(/\.\.\.\(instructions \? \{ instructions \} : \{\}\)/g) ?? [];
    assert.ok(
      spreads.length >= 2,
      `both send paths must spread the instructions option (found ${spreads.length}) — dropping it silently loses the compiled prompt for ALL providers`,
    );
  });
});
