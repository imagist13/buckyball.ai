/**
 * Phase 5 review round 5 (2026-05-13) — streamClaude routing for
 * codex_runtime sessions + codex_account provider.
 *
 * Codex CDP smoke caught a silent runtime mismatch: a session pinned
 * to `codex_runtime` was falling through to `claude-code-sdk` because
 * the pin→registry ternary in `streamClaude` only handled
 * `claude_code` and `codepilot_runtime`. The chat would then send a
 * Codex-only model (e.g. gpt-5.5) through Claude Code SDK and the
 * SDK rejected the model with "There's an issue with the selected
 * model".
 *
 * Source-level pin so a future edit can't quietly drop the codex
 * mapping again. Same style as round 3's runtime.ts pin (no live
 * codex binary in CI — we anchor on the source contract).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const clientSrc = fs.readFileSync(
  path.resolve(__dirname, '../../lib/claude-client.ts'),
  'utf8',
);

describe('streamClaude — codex_account provider force-route (P1 fix)', () => {
  it('declares an isCodexAccountProvider early branch parallel to isNonAnthropicProvider', () => {
    // The early branch must exist BEFORE the transport-based SDK
    // detection so codex_account never reaches the SDK fallback.
    assert.match(
      clientSrc,
      /const\s+isCodexAccountProvider\s*=\s*effectiveProvider\s*===\s*'codex_account'/,
    );
  });

  it('codex_account branch resolves codex_runtime from the registry', () => {
    assert.match(
      clientSrc,
      /if\s*\(\s*isCodexAccountProvider\s*\)\s*\{[\s\S]{0,400}getRuntime\(\s*'codex_runtime'\s*\)/,
    );
  });

  it('codex_account branch fails closed when codex_runtime is unavailable', () => {
    // No silent fallthrough to claude-code-sdk / native — Codex
    // models cannot survive any other transport.
    assert.match(
      clientSrc,
      /isCodexAccountProvider[\s\S]{0,500}throw\s+new\s+Error\(\s*['"`]codex_account provider selected/,
    );
  });

  it('codex_account branch is ordered before isNonAnthropicProvider', () => {
    // Ordering matters: a future provider id that happens to be in
    // both buckets must hit the Codex branch first because Codex's
    // wire format is stricter than Native's "POST /chat/completions".
    const codexIdx = clientSrc.indexOf('if (isCodexAccountProvider)');
    const nonAnthIdx = clientSrc.indexOf('else if (isNonAnthropicProvider)');
    assert.ok(codexIdx > 0, 'isCodexAccountProvider branch must exist');
    assert.ok(nonAnthIdx > 0, 'isNonAnthropicProvider branch must exist');
    assert.ok(
      codexIdx < nonAnthIdx,
      'isCodexAccountProvider branch must come before isNonAnthropicProvider branch',
    );
  });
});

describe('streamClaude — pin→registry mapping includes codex_runtime (P1 core fix)', () => {
  it('pin codex_runtime maps to registry id codex_runtime (identity)', () => {
    // Phase 3 decided the canonical RuntimeId for Codex matches its
    // registry id (no legacy alias). The ternary must reflect that
    // so a session pin of `codex_runtime` survives the translation.
    assert.match(
      clientSrc,
      /sessionRuntimePin\s*===\s*'codex_runtime'[\s\S]{0,80}\?\s*'codex_runtime'/,
    );
  });

  it('legacy mappings stay intact', () => {
    // The fix MUST NOT silently drop the existing translations.
    assert.match(
      clientSrc,
      /sessionRuntimePin\s*===\s*'claude_code'[\s\S]{0,80}\?\s*'claude-code-sdk'/,
    );
    assert.match(
      clientSrc,
      /sessionRuntimePin\s*===\s*'codepilot_runtime'[\s\S]{0,80}\?\s*'native'/,
    );
  });
});

describe('streamClaude — codex_runtime pin guardrail (P1 fail-closed)', () => {
  it('throws when pin === codex_runtime but resolver returned a different runtime', () => {
    // This is the load-bearing assertion: if anything in the routing
    // ladder above this guardrail decides "I'll just use Claude Code
    // SDK for this codex_runtime session", we surface a clear error
    // instead of silently sending GPT-5.5 to the wrong transport.
    assert.match(
      clientSrc,
      /options\.sessionRuntimePin\s*===\s*'codex_runtime'\s*&&\s*runtime\.id\s*!==\s*'codex_runtime'[\s\S]{0,500}throw\s+new\s+Error/,
    );
  });

  it('guardrail message names the pin + the resolved runtime for debuggability', () => {
    // The error message has to be diagnosable — include the actual
    // runtime.id so the user (and any future bug-report copy/paste)
    // pinpoints which fallback fired.
    assert.match(
      clientSrc,
      /Session is pinned to codex_runtime but resolver returned[\s\S]{0,300}\$\{runtime\.id\}/,
    );
  });
});
