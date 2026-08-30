/**
 * Phase 5 review round 4 — codex_account virtual provider + atomic
 * runtime_pin coherence on session PATCH.
 *
 * Codex CDP smoke (2026-05-13) caught two real wiring bugs:
 *
 *   P1.1 — Sending under (provider_id=codex_account, model=gpt-5.5)
 *          returned 409 "provider deleted" because
 *          `resolveProviderForSession` treated codex_account as a
 *          regular DB-row id and didn't find it (it's virtual,
 *          produced by buildCodexProviderModelGroup).
 *
 *   P1.2 — Picking a codex_account model in the picker persisted
 *          provider_id=codex_account but left runtime_pin
 *          =codepilot_runtime. The composer's PATCH whitelist
 *          rejected runtime_pin='codex_runtime' (hardcoded two-id
 *          allowlist) so even when the UI tried to switch the
 *          runtime, the server returned 400.
 *
 * Fixes pinned here:
 *   - provider-resolver.ts treats 'codex_account' as a virtual provider
 *     in BOTH resolveProvider (main entry) and resolveProviderForSession
 *     (session-validated wrapper).
 *   - The PATCH route's runtime_pin validation now goes through
 *     `isRuntimeId` (covers RUNTIME_IDS) and 400s with the up-to-date
 *     set listed.
 *   - The PATCH route enforces atomic coherence: provider_id=codex_account
 *     automatically forces runtime_pin to codex_runtime when the client
 *     didn't include one. Response carries `coherence.forcedRuntimePin`
 *     so the UI can show a toast.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveProvider } from '@/lib/provider-resolver';

const repoRoot = path.resolve(__dirname, '../..');

describe('resolveProvider — codex_account virtual provider (P1.1 fix)', () => {
  it('codex_account is recognized as a virtual provider — no DB lookup, no 409', () => {
    const resolved = resolveProvider({ providerId: 'codex_account', model: 'gpt-5.5' });
    // Virtual: no `invalidReason`, `hasCredentials: true` (account-managed),
    // `_codexAccount: true` marker so downstream code can branch.
    assert.equal(resolved.invalidReason, undefined);
    assert.equal((resolved as { _codexAccount?: boolean })._codexAccount, true);
    assert.equal(resolved.hasCredentials, true);
    assert.equal(resolved.model, 'gpt-5.5');
    assert.equal(resolved.upstreamModel, 'gpt-5.5');
  });

  it('codex_account never falls through to env / default fallback', () => {
    // If the route accidentally fell through, `provider` would be the
    // default DB provider (or undefined for env) — not what we want.
    // The marker is the load-bearing pin.
    const resolved = resolveProvider({ providerId: 'codex_account' });
    assert.equal((resolved as { _codexAccount?: boolean })._codexAccount, true);
  });
});

describe('Provider-resolver virtual-provider exception list — source-level pin', () => {
  const resolverSrc = fs.readFileSync(
    path.join(repoRoot, 'lib/provider-resolver.ts'),
    'utf8',
  );

  it('resolveProviderForSession exempts codex_account from the DB-missing check', () => {
    // The same exception list that handles env / openai-oauth must
    // include codex_account so the session-validated path doesn't 409
    // when Codex Account models are persisted on a chat session.
    assert.match(
      resolverSrc,
      /effectiveProviderId\s*!==\s*'codex_account'/,
    );
  });

  it('resolveProvider has an early branch for codex_account', () => {
    // Mirror the buildOpenAIOAuthResolution path so codex_account
    // never reaches getProvider() with a virtual id.
    assert.match(
      resolverSrc,
      /effectiveProviderId\s*===\s*'codex_account'[\s\S]{0,500}buildCodexAccountResolution/,
    );
  });
});

describe('Session PATCH route — runtime_pin whitelist via isRuntimeId (P1.2 fix)', () => {
  const routeSrc = fs.readFileSync(
    path.join(repoRoot, 'app/api/chat/sessions/[id]/route.ts'),
    'utf8',
  );

  it('runtime_pin validation imports isRuntimeId + RUNTIME_IDS', () => {
    assert.match(
      routeSrc,
      /import\s*\{[^}]*\bisRuntimeId\b[^}]*\bRUNTIME_IDS\b[^}]*\}\s*from\s*['"]@\/lib\/runtime\/runtime-id['"]/,
    );
  });

  it('runtime_pin validation no longer hard-codes the two-id allowlist', () => {
    // The earlier `body.runtime_pin !== 'claude_code' && body.runtime_pin !== 'codepilot_runtime'`
    // check rejected codex_runtime. Round 4 fix replaced it with isRuntimeId.
    assert.doesNotMatch(
      routeSrc,
      /body\.runtime_pin\s*!==\s*'claude_code'\s*&&\s*body\.runtime_pin\s*!==\s*'codepilot_runtime'/,
    );
  });

  it('runtime_pin validation accepts empty + any RuntimeId, 400s on other input', () => {
    const validationBlock = routeSrc.match(/body\.runtime_pin[\s\S]{0,600}status:\s*400/);
    assert.ok(validationBlock, 'must validate runtime_pin and 400 on bad input');
    assert.match(validationBlock![0], /isRuntimeId\(/);
    assert.match(validationBlock![0], /RUNTIME_IDS/);
    assert.match(validationBlock![0], /''/);
  });
});

describe('Session PATCH route — atomic coherence for codex_account + codex_runtime', () => {
  const routeSrc = fs.readFileSync(
    path.join(repoRoot, 'app/api/chat/sessions/[id]/route.ts'),
    'utf8',
  );

  it('forces runtime_pin = codex_runtime when provider_id is set to codex_account', () => {
    // The coherence guard fires when the client PATCHes provider_id
    // alone (model picker) and the server fixes runtime_pin so the
    // chat send route resolves a coherent (provider, runtime) pair.
    assert.match(
      routeSrc,
      /body\.provider_id\s*===\s*'codex_account'[\s\S]{0,500}updateSessionRuntime\(id,\s*'codex_runtime'\)/,
    );
  });

  it('skips coherence force when client explicitly passes a runtime_pin', () => {
    // Don't override an explicit client choice (e.g. a future flow
    // that PATCHes both atomically). The guard only fires when
    // body.runtime_pin === undefined.
    assert.match(
      routeSrc,
      /body\.provider_id\s*===\s*'codex_account'\s*&&\s*body\.runtime_pin\s*===\s*undefined/,
    );
  });

  it('surfaces the coherence force-set in the response so UI can toast', () => {
    // `coherence.forcedRuntimePin: 'codex_runtime'` on the response
    // payload lets the composer show a small toast / inline marker
    // instead of silently swapping the runtime under the user.
    assert.match(routeSrc, /coherence:\s*\{\s*forcedRuntimePin:\s*coherenceForcedRuntime\s*\}/);
  });
});
