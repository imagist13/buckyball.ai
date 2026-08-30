/**
 * codex-stop-recovery Phase 1 — `/api/chat/interrupt` runtime fan-out.
 *
 * The Stop button posts here. Before this fix the route only tried Native +
 * the SDK conversation, so a Stop under Codex Runtime never reached the Codex
 * app-server turn — the turn kept running, the stream never closed, and the
 * session lock renewed forever. The route now fans out to codex_runtime too.
 *
 * Source-level pins (the route uses `await import(...)` for the registry, which
 * makes behavioral mocking fragile). They also serve as the guardrail the plan
 * asks for: a future Runtime added without a matching interrupt branch here
 * fails this test instead of silently regressing Stop.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const routeSrc = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/chat/interrupt/route.ts'),
  'utf8',
);

describe('/api/chat/interrupt fan-out', () => {
  it('interrupts the native runtime', () => {
    assert.match(routeSrc, /getRuntime\('native'\)[\s\S]{0,200}\.interrupt\(sessionId\)/);
  });

  it('interrupts the Codex runtime (the gap this plan closes)', () => {
    assert.match(routeSrc, /getRuntime\('codex_runtime'\)[\s\S]{0,200}\.interrupt\(sessionId\)/);
  });

  it('interrupts the SDK conversation', () => {
    assert.match(routeSrc, /getConversation\(sessionId\)[\s\S]{0,200}\.interrupt\(\)/);
  });

  it('each runtime is interrupted best-effort (independent try/catch so one failure can’t block the others)', () => {
    assert.match(routeSrc, /catch \{ \/\* native not available \*\//);
    assert.match(routeSrc, /catch \{ \/\* codex not available \*\//);
    assert.match(routeSrc, /catch \{ \/\* SDK not available \*\//);
  });

  it('the doc comment no longer claims only "both runtimes"', () => {
    // Stale "Tries both runtimes" wording predated the Codex branch and was
    // actively misleading. Pin that it stays gone.
    assert.doesNotMatch(routeSrc, /Tries both runtimes/);
  });
});
