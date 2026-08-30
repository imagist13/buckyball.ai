/**
 * runtime-selection.test.ts — Tests for runtime selection and OAuth status.
 *
 * - OAuth status: inlined (real getOAuthStatus reads host DB, non-deterministic)
 * - Runtime selection: inlined because registry.ts depends on runtime
 *   registration side effects that conflict with isolated unit tests.
 *   The inlined logic is documented as a mirror of registry.ts and
 *   should be updated when the source changes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Suite 1: predictNativeRuntime (inlined — registry.ts has side effects) ──
// Mirrors registry.ts predictNativeRuntime() — update if source changes.
//
// Phase 6 IA correction round 2 (2026-05-14): codex_account provider AND
// `agent_runtime='codex_runtime'` setting both route to Codex Runtime,
// NOT native. cli_enabled=false no longer hijacks codex.

function predictNativeRuntime(
  providerId: string | undefined,
  cliEnabled: boolean,
  agentRuntime: string,
  sdkAvailable: boolean,
  hasAnyCreds: boolean,
): boolean {
  // Phase 6 IA correction round 2 (2026-05-14) — Codex Runtime is its
  // own subprocess. cli_enabled=false doesn't mean "force native" for
  // Codex. Both the provider-level signal (`codex_account`) and the
  // engine-level signal (`agent_runtime=codex_runtime`) must short-
  // circuit BEFORE the cli_enabled check so Codex doesn't get
  // downgraded.
  //
  // Phase 5b smoke follow-up (2026-05-15) — the codex_runtime setting
  // check ALSO has to beat the legacy openai-oauth → native heuristic.
  // openai-oauth speaks OpenAI Responses-API which is exactly what
  // Codex's proxy supports, so under a global Codex default the user's
  // openai-oauth selection should route through Codex, not Native.
  if (providerId === 'codex_account') return false;
  if (agentRuntime === 'codex_runtime') return false;
  // Only AFTER the Codex short-circuits does the openai-oauth → native
  // heuristic apply (it's the right default when Codex Runtime isn't
  // the active engine).
  if (providerId === 'openai-oauth') return true;
  if (!cliEnabled) return true;
  if (agentRuntime === 'native') return true;
  if (agentRuntime === 'claude-code-sdk') return !sdkAvailable; // fallback if no CLI
  // auto: SDK only if CLI + has credentials
  if (sdkAvailable && hasAnyCreds) return false;
  return true;
}

describe('predictNativeRuntime (mirrors registry.ts)', () => {
  it('openai-oauth → native when no Codex pin/default', () => {
    assert.equal(predictNativeRuntime('openai-oauth', true, 'auto', true, true), true);
  });
  it('openai-oauth UNDER codex_runtime default → NOT native (routes through Codex proxy)', () => {
    // Phase 5b: Codex's wire format matches openai-oauth, so the
    // proxy adapter handles it. Forcing Native here was the pre-fix
    // bug that broke openai-oauth sends under Codex Runtime.
    assert.equal(predictNativeRuntime('openai-oauth', true, 'codex_runtime', true, true), false);
  });
  it('cli disabled → always native', () => {
    assert.equal(predictNativeRuntime(undefined, false, 'auto', true, true), true);
  });
  it('setting=native → native', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'native', true, true), true);
  });
  it('setting=claude-code-sdk + CLI → not native', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'claude-code-sdk', true, true), false);
  });
  it('setting=claude-code-sdk + no CLI → native (fallback)', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'claude-code-sdk', false, true), true);
  });
  it('auto + SDK + has creds → not native', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'auto', true, true), false);
  });
  it('auto + SDK + no creds → native (#456)', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'auto', true, false), true);
  });
  it('auto + no SDK → native', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'auto', false, true), true);
  });
  // Phase 6 IA correction round 2 — Codex Runtime is sticky.
  it('codex_account provider → NOT native (routes to Codex Runtime)', () => {
    assert.equal(predictNativeRuntime('codex_account', true, 'auto', true, true), false);
  });
  it('setting=codex_runtime → NOT native (even with cli_enabled=false)', () => {
    assert.equal(predictNativeRuntime(undefined, false, 'codex_runtime', true, true), false);
    assert.equal(predictNativeRuntime(undefined, true, 'codex_runtime', false, false), false);
  });
});

// ── Suite 2: resolveRuntime auto semantics (mirrors registry.ts) ──
//
// Phase 6 IA correction round 2 (2026-05-14): codex_runtime explicit
// (override OR stored setting) beats cli_enabled. Selecting Codex
// Runtime in Settings → Runtime saves agent_runtime='codex_runtime' +
// cli_enabled='false' (Codex doesn't need the Claude CLI), and the
// old "cli_enabled=false → always native" rule would hijack the
// resolution back to native — the misroute that left Models filtering
// on codepilot_runtime instead of codex_runtime.

function resolveRuntime(
  cliDisabled: boolean,
  overrideId: string | undefined,
  settingId: string | undefined,
  sdkAvailable: boolean,
  hasAnyCreds: boolean,
  codexAvailable: boolean = false,
): string {
  // 0. Codex Runtime explicit — beats cli_enabled.
  const wantsCodex =
    overrideId === 'codex_runtime'
    || ((!overrideId || overrideId === 'auto') && settingId === 'codex_runtime');
  if (wantsCodex && codexAvailable) return 'codex_runtime';

  // 1. Explicit override (Phase 5e round 8 — runs BEFORE cli_enabled).
  //    If override targets SDK and SDK is unavailable, mirror throws.
  if (overrideId && overrideId !== 'auto' && overrideId !== 'codex_runtime') {
    if (overrideId === 'native') return 'native';
    if (overrideId === 'claude-code-sdk') {
      if (sdkAvailable) return 'claude-code-sdk';
      throw new Error('Claude Code is pinned but the Claude Code CLI is not available.');
    }
  }

  // 2. cli_enabled=false short-circuit — only when no explicit override above.
  if (cliDisabled) return 'native';

  // 3. Explicit setting — try, fall through if unavailable (legacy
  //    semantics, intentionally NOT fail-closed; that's reserved for
  //    explicit overrides in step 1).
  if (settingId && settingId !== 'auto') {
    if (settingId === 'claude-code-sdk' && !sdkAvailable) return 'native'; // fallback
    return settingId;
  }

  // 4. Auto
  if (sdkAvailable && hasAnyCreds) return 'claude-code-sdk';
  return 'native';
}

describe('resolveRuntime (mirrors registry.ts)', () => {
  // Phase 5e round 8 (2026-05-18) — session pin / explicit override now
  // beats cli_enabled=false. Previously this returned 'native' (the
  // bug). Now: explicit SDK override + SDK available → SDK, regardless
  // of cli_enabled. This is the headline regression pin.
  it('explicit claude-code-sdk override + cli_enabled=false + SDK available → claude-code-sdk (NOT native)', () => {
    assert.equal(
      resolveRuntime(true, 'claude-code-sdk', 'claude-code-sdk', true, true),
      'claude-code-sdk',
    );
  });
  // Phase 5e round 8 — fail-closed when explicit SDK pin can't be honored.
  it('explicit claude-code-sdk override + SDK NOT available → THROWS (never silently demotes to native)', () => {
    assert.throws(
      () => resolveRuntime(false, 'claude-code-sdk', undefined, false, true),
      /Claude Code is pinned/,
    );
  });
  it('explicit claude-code-sdk override + cli_enabled=false + SDK NOT available → THROWS', () => {
    // The other half of the round 8 fix: even when cli_enabled=false is
    // set globally, a session pinned to SDK gets a fail-closed error
    // instead of a silent demotion. UI must surface this to the user.
    assert.throws(
      () => resolveRuntime(true, 'claude-code-sdk', undefined, false, true),
      /Claude Code is pinned/,
    );
  });
  it('explicit override takes precedence', () => {
    assert.equal(resolveRuntime(false, 'native', 'claude-code-sdk', true, true), 'native');
  });
  it('global setting=claude-code-sdk + cli_enabled=false (no session pin) → native (LEGACY behavior preserved)', () => {
    // Phase 5e round 8 deliberately preserves this case as-is. The
    // round 8 fix only narrows behavior for EXPLICIT session pin /
    // override (step 1) — not for a stale global setting. Reason:
    // global preference is a stored value that may be out of sync
    // with cli_enabled (Settings page auto-flips them together, but
    // legacy DB rows could drift); the long-standing UX is that an
    // outdated global silently falls back, while an explicit override
    // is a strong signal for THIS request and gets fail-closed.
    assert.equal(resolveRuntime(true, undefined, 'claude-code-sdk', true, true), 'native');
  });
  it('global setting=claude-code-sdk + no CLI + cli_enabled=true → native (fallback, no throw — legacy)', () => {
    assert.equal(resolveRuntime(false, undefined, 'claude-code-sdk', false, true), 'native');
  });
  it('cli_enabled=false + no explicit override + no SDK pref → native (legacy gate still works for auto)', () => {
    // The cli_enabled gate STILL applies when there's no explicit
    // override / SDK setting — typical case: global default is
    // CodePilot/Codex, no session pin. We still want native then.
    assert.equal(resolveRuntime(true, undefined, undefined, true, true), 'native');
  });
  it('setting takes precedence over auto', () => {
    assert.equal(resolveRuntime(false, undefined, 'native', true, true), 'native');
  });
  it('auto + SDK + has creds → sdk', () => {
    assert.equal(resolveRuntime(false, undefined, undefined, true, true), 'claude-code-sdk');
  });
  it('auto + SDK + no creds → native (#456)', () => {
    assert.equal(resolveRuntime(false, undefined, undefined, true, false), 'native');
  });
  it('auto + no SDK → native', () => {
    assert.equal(resolveRuntime(false, undefined, undefined, false, true), 'native');
  });
  // Phase 6 IA correction round 2 — codex_runtime stickiness.
  it('codex_runtime override + codex available → codex_runtime', () => {
    assert.equal(resolveRuntime(false, 'codex_runtime', undefined, true, true, true), 'codex_runtime');
  });
  it('codex_runtime override + cli_enabled=false → STILL codex_runtime (not native)', () => {
    // The P1 misroute pre-fix: this used to short-circuit to native
    // because cli_enabled=false was treated as the absolute override.
    assert.equal(resolveRuntime(true, 'codex_runtime', undefined, true, true, true), 'codex_runtime');
  });
  it('setting=codex_runtime + cli_enabled=false → STILL codex_runtime', () => {
    // The user-spec scenario: RuntimePanel saves agent_runtime=codex_runtime
    // + cli_enabled=false. Settings page should agree with the resolver.
    assert.equal(resolveRuntime(true, undefined, 'codex_runtime', true, true, true), 'codex_runtime');
  });
  it('codex_runtime explicit + codex NOT available → falls through (claude-client guardrail catches it)', () => {
    // If codex isn't registered, resolution falls through to the legacy
    // chain. The chat send path's Round 5 fail-closed throws BEFORE the
    // resolution is acted on, so users get a clear "Codex Runtime not
    // available" error instead of silently routing GPT-5.5 to SDK.
    assert.equal(resolveRuntime(true, 'codex_runtime', undefined, true, true, false), 'native');
  });
});

// ── Suite 3: OpenAI OAuth status (inlined — real impl reads host DB) ──

describe('OpenAI OAuth status (inlined logic)', () => {
  // All OAuth status tests are inlined because the real getOAuthStatus()
  // reads from the host machine's DB — test results would depend on
  // whether the developer has logged into OpenAI, making it non-deterministic.

  function deriveOAuthStatus(
    accessToken: string | null,
    expiresAt: number,
    refreshToken: string | null,
  ): { authenticated: boolean; needsRefresh?: boolean } {
    if (!accessToken) return { authenticated: false };
    const REFRESH_BUFFER_MS = 5 * 60 * 1000;
    if (expiresAt && Date.now() > expiresAt && !refreshToken) {
      return { authenticated: false };
    }
    const needsRefresh = expiresAt > 0 && Date.now() > expiresAt - REFRESH_BUFFER_MS;
    return { authenticated: true, needsRefresh };
  }

  it('valid token → authenticated', () => {
    const r = deriveOAuthStatus('tok', Date.now() + 3600_000, null);
    assert.equal(r.authenticated, true);
    assert.equal(r.needsRefresh, false);
  });

  it('expired + no refresh → not authenticated', () => {
    const r = deriveOAuthStatus('tok', Date.now() - 1000, null);
    assert.equal(r.authenticated, false);
  });

  it('expired + has refresh → authenticated + needsRefresh', () => {
    const r = deriveOAuthStatus('tok', Date.now() - 1000, 'ref');
    assert.equal(r.authenticated, true);
    assert.equal(r.needsRefresh, true);
  });

  it('near expiry (within 5min buffer) → needsRefresh', () => {
    const r = deriveOAuthStatus('tok', Date.now() + 60_000, 'ref');
    assert.equal(r.authenticated, true);
    assert.equal(r.needsRefresh, true);
  });

  it('expiresAt=0 → no expiry check', () => {
    const r = deriveOAuthStatus('tok', 0, null);
    assert.equal(r.authenticated, true);
    assert.equal(r.needsRefresh, false);
  });
});

// ── Suite 4: SDK availability matrix (mirrors sdk-runtime.ts isAvailable) ──

describe('SDK isAvailable matrix (inlined logic)', () => {
  // Mirrors the 3-layer check in sdk-runtime.ts:76-97.
  // Mirrors sdk-runtime.ts isAvailable() — now a simple CLI binary check.
  // Auth is managed by the CLI itself; availability only depends on binary.

  function sdkIsAvailable(cliBinaryExists: boolean): boolean {
    return cliBinaryExists;
  }

  it('no CLI binary → unavailable', () => {
    assert.equal(sdkIsAvailable(false), false);
  });

  it('CLI binary exists → available', () => {
    assert.equal(sdkIsAvailable(true), true);
  });
});

// ── Suite 5: Announcement dismiss persistence (mirrors FeatureAnnouncementDialog) ──

describe('Announcement dismiss persistence (inlined logic)', () => {
  // Mirrors the dismiss check in FeatureAnnouncementDialog.tsx:24-39.
  // LIMITATION: tests the decision matrix only, not the actual API persistence
  // path (settings/app whitelist, localStorage sync). The whitelist regression
  // we fixed requires a running Next.js server to exercise — belongs in smoke/e2e.

  function shouldShowAnnouncement(opts: {
    localStorageDismissed: boolean;
    dbSettingDismissed: boolean;
    setupCompleted: boolean;
  }): { show: boolean; syncLocalStorage: boolean } {
    // Fast check: localStorage says dismissed
    if (opts.localStorageDismissed) return { show: false, syncLocalStorage: false };

    // DB says dismissed (localStorage was lost) → don't show, sync back
    if (opts.dbSettingDismissed) return { show: false, syncLocalStorage: true };

    // Only show if setup is completed (existing user)
    if (opts.setupCompleted) return { show: true, syncLocalStorage: false };

    // New user (setup not done) → don't show
    return { show: false, syncLocalStorage: false };
  }

  it('localStorage dismissed → do not show', () => {
    const r = shouldShowAnnouncement({ localStorageDismissed: true, dbSettingDismissed: false, setupCompleted: true });
    assert.equal(r.show, false);
    assert.equal(r.syncLocalStorage, false);
  });

  it('DB dismissed but localStorage lost → do not show + sync localStorage', () => {
    const r = shouldShowAnnouncement({ localStorageDismissed: false, dbSettingDismissed: true, setupCompleted: true });
    assert.equal(r.show, false);
    assert.equal(r.syncLocalStorage, true);
  });

  it('neither dismissed + setup completed → show (existing user upgrading)', () => {
    const r = shouldShowAnnouncement({ localStorageDismissed: false, dbSettingDismissed: false, setupCompleted: true });
    assert.equal(r.show, true);
  });

  it('neither dismissed + setup not completed → do not show (new user)', () => {
    const r = shouldShowAnnouncement({ localStorageDismissed: false, dbSettingDismissed: false, setupCompleted: false });
    assert.equal(r.show, false);
  });

  it('both dismissed → do not show (redundant but safe)', () => {
    const r = shouldShowAnnouncement({ localStorageDismissed: true, dbSettingDismissed: true, setupCompleted: true });
    assert.equal(r.show, false);
  });
});
