/**
 * Tests for `src/lib/runtime/effective.ts`. Locks in two contracts:
 *
 *   1. `computeEffectiveRuntime` mirrors `registry.ts:resolveRuntime`'s
 *      priority chain — `cli_enabled=false` is the highest-priority
 *      override, beating the stored `agent_runtime` value.
 *   2. `resolveNewChatDefault` enforces the Phase 2C contract:
 *      - **Pinned mode** demands an exact match; missing target →
 *        `'invalid-default'` with a reason. **No fallback.**
 *      - **Auto mode** walks the saved → apiDefault → first chain and
 *        always lands on `'auto-resolved'` when groups is non-empty.
 *      - Empty groups → `'no-compatible'` regardless of mode.
 *
 * Both helpers run on the Settings Runtime page AND the chat header
 * RuntimeBadge AND the chat init path. Drift between any of those
 * surfaces is what triggered this refactor in the first place.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeEffectiveRuntime,
  resolveNewChatDefault,
  runtimeDisplayLabel,
} from "../../lib/runtime/effective";

// ---------------------------------------------------------------------------
// computeEffectiveRuntime
// ---------------------------------------------------------------------------

describe("computeEffectiveRuntime", () => {
  it("returns stored agent_runtime when cli_enabled is true and CLI is connected", () => {
    assert.equal(computeEffectiveRuntime("claude-code-sdk", true, true), "claude-code-sdk");
    assert.equal(computeEffectiveRuntime("native", true, true), "native");
  });

  it("forces 'native' when cli_enabled is false (highest priority for LEGACY pair)", () => {
    // Drift case: stored preference says Claude Code but cli_enabled=false
    // routes chat to AI SDK regardless. Settings panel + chat badge must
    // both see this consistently. Phase 6 IA correction round 2
    // (2026-05-14) narrowed this rule: it now only applies to the
    // legacy `claude-code-sdk` / `native` pair; codex_runtime is exempt
    // (see test below).
    assert.equal(computeEffectiveRuntime("claude-code-sdk", false, true), "native");
    assert.equal(computeEffectiveRuntime("native", false, true), "native");
  });

  it("codex_runtime is sticky — cli_enabled=false does NOT downgrade it", () => {
    // Phase 6 IA correction round 2 (2026-05-14). RuntimePanel saves
    // `agent_runtime='codex_runtime'` + `cli_enabled='false'` when the
    // user picks Codex as global default (Codex doesn't need the Claude
    // CLI). The earlier "cli_enabled=false → always native" rule would
    // hijack this back to native, and the Models page filter would then
    // run on `codepilot_runtime` instead of `codex_runtime` — the exact
    // misroute the user caught in P1.
    assert.equal(computeEffectiveRuntime("codex_runtime", false, true), "codex_runtime");
    assert.equal(computeEffectiveRuntime("codex_runtime", false, false), "codex_runtime");
    assert.equal(computeEffectiveRuntime("codex_runtime", true, true), "codex_runtime");
  });

  it("falls back to 'native' when stored is claude-code-sdk but CLI not connected", () => {
    // This is the second drift case (the user-reported P2): registry's
    // resolveRuntime gates step 2 on `r?.isAvailable()`. If the user
    // picked Claude Code but CLI isn't installed/detected, registry
    // falls through to native — the helper must too, so the badge in
    // the chat header doesn't claim Claude Code is running.
    assert.equal(computeEffectiveRuntime("claude-code-sdk", true, false), "native");
  });

  it("native is always available regardless of CLI connection state", () => {
    // CodePilot Runtime ships in-app; cliConnected is irrelevant for it.
    assert.equal(computeEffectiveRuntime("native", true, false), "native");
    assert.equal(computeEffectiveRuntime("native", true, true), "native");
  });

  it("treats string 'false' the same as boolean false (DB stores strings)", () => {
    assert.equal(computeEffectiveRuntime("claude-code-sdk", "false", true), "native");
  });

  it("treats string 'true' the same as boolean true", () => {
    assert.equal(computeEffectiveRuntime("claude-code-sdk", "true", true), "claude-code-sdk");
  });

  it("defaults to enabled when cli_enabled is null / undefined (legacy rows)", () => {
    assert.equal(computeEffectiveRuntime("claude-code-sdk", null, true), "claude-code-sdk");
    assert.equal(computeEffectiveRuntime("claude-code-sdk", undefined, true), "claude-code-sdk");
  });

  it("coerces legacy 'auto' value to whichever matches CLI state", () => {
    // 'auto' isn't a real concrete runtime; resolveLegacyRuntimeForDisplay
    // picks claude-code-sdk when CLI is connected, native otherwise.
    assert.equal(computeEffectiveRuntime("auto", true, true), "claude-code-sdk");
    assert.equal(computeEffectiveRuntime("auto", true, false), "native");
  });

  it("legacy 'auto' still loses to cli_enabled=false override", () => {
    // Even if CLI is connected, cli_enabled=false short-circuits.
    assert.equal(computeEffectiveRuntime("auto", false, true), "native");
  });
});

// ---------------------------------------------------------------------------
// runtimeDisplayLabel
// ---------------------------------------------------------------------------

describe("runtimeDisplayLabel", () => {
  it("returns short user-facing display strings", () => {
    // Phase 6 UI收口 P1 fix-up (2026-05-14): three short product
    // names. "AI SDK" was an internal implementation detail leaking
    // into the UI label; the user-visible name is "CodePilot". Same
    // for "Codex Runtime" → "Codex" — the page title + section header
    // carry the runtime framing, repeating it here was redundant.
    assert.equal(runtimeDisplayLabel("claude-code-sdk"), "Claude Code");
    assert.equal(runtimeDisplayLabel("native"), "CodePilot");
    assert.equal(runtimeDisplayLabel("codex_runtime"), "Codex");
  });
});

// ---------------------------------------------------------------------------
// resolveNewChatDefault
// ---------------------------------------------------------------------------

const groupA = {
  provider_id: "anthropic-official",
  provider_name: "Anthropic",
  models: [
    { value: "sonnet", label: "Sonnet 4.6" },
    { value: "opus", label: "Opus 4.7" },
  ],
};
const groupB = {
  provider_id: "openrouter",
  provider_name: "OpenRouter",
  models: [
    { value: "anthropic/claude-3-opus", label: "Claude 3 Opus" },
  ],
};

describe("resolveNewChatDefault — empty groups (precedence over mode)", () => {
  it("Pinned + valid pin still returns 'no-compatible' when groups is empty", () => {
    // 'no-compatible' wins over Pinned validity — empty groups means the
    // current Runtime can't run anything; "fix runtime" comes before
    // "fix pin" in the user's mental order.
    const result = resolveNewChatDefault({
      groups: [],
      mode: "pinned",
      pinnedProviderId: "anthropic-official",
      pinnedModel: "sonnet",
    });
    assert.equal(result.status, "no-compatible");
  });

  it("Auto + empty groups returns 'no-compatible'", () => {
    const result = resolveNewChatDefault({
      groups: [],
      mode: "auto",
      savedProviderId: "anthropic-official",
      savedModel: "sonnet",
    });
    assert.equal(result.status, "no-compatible");
  });
});

describe("resolveNewChatDefault — Pinned mode", () => {
  it("'ok' when pinned provider + model both valid in the runtime-filtered group", () => {
    const result = resolveNewChatDefault({
      groups: [groupA, groupB],
      mode: "pinned",
      pinnedProviderId: "anthropic-official",
      pinnedModel: "opus",
    });
    assert.equal(result.status, "ok");
    assert.equal(result.providerId, "anthropic-official");
    assert.equal(result.modelValue, "opus");
    assert.equal(result.modelLabel, "Opus 4.7");
  });

  it("'invalid-default' with reason='provider-missing' when pinned provider not in groups", () => {
    // Most likely: user pinned an OpenAI model while on Claude Code
    // Runtime, so the provider is filtered out entirely.
    const result = resolveNewChatDefault({
      groups: [groupA],
      mode: "pinned",
      pinnedProviderId: "openrouter",
      pinnedModel: "anthropic/claude-3-opus",
    });
    assert.equal(result.status, "invalid-default");
    assert.equal(result.reason, "provider-missing");
    // Pinned values returned so UI can name what's broken.
    assert.equal(result.providerId, "openrouter");
    assert.equal(result.modelValue, "anthropic/claude-3-opus");
  });

  it("'invalid-default' with reason='model-missing' when provider OK but model not in its group", () => {
    const result = resolveNewChatDefault({
      groups: [groupA],
      mode: "pinned",
      pinnedProviderId: "anthropic-official",
      pinnedModel: "deprecated-model",
    });
    assert.equal(result.status, "invalid-default");
    assert.equal(result.reason, "model-missing");
    assert.equal(result.providerId, "anthropic-official");
    assert.equal(result.providerName, "Anthropic");
    assert.equal(result.modelValue, "deprecated-model");
  });

  it("'invalid-default' with reason='pin-incomplete' when mode='pinned' but pin values empty", () => {
    // Defensive — migration shouldn't create this state, but if it
    // exists we surface it instead of silently coercing to Auto.
    const result = resolveNewChatDefault({
      groups: [groupA],
      mode: "pinned",
      pinnedProviderId: "",
      pinnedModel: "",
    });
    assert.equal(result.status, "invalid-default");
    assert.equal(result.reason, "pin-incomplete");
  });

  it("Pinned mode does NOT fall through to savedPair / apiDefault / first when pin is invalid", () => {
    // The whole point of the contract: even when a sensible substitute
    // exists, Pinned must fail loudly so the user knows their explicit
    // commitment isn't being honored.
    const result = resolveNewChatDefault({
      groups: [groupA, groupB],
      mode: "pinned",
      pinnedProviderId: "openrouter",
      pinnedModel: "non-existent",
      // Plenty of fallback signals — all should be ignored:
      apiDefaultProviderId: "anthropic-official",
      savedProviderId: "anthropic-official",
      savedModel: "sonnet",
    });
    assert.equal(result.status, "invalid-default");
    assert.equal(result.reason, "model-missing");
    // None of the fallback hints leak into the resolved fields.
    assert.notEqual(result.providerId, "anthropic-official");
  });
});

describe("resolveNewChatDefault — Auto mode", () => {
  it("'auto-resolved' via saved pair when validated against a runtime-compatible group", () => {
    const result = resolveNewChatDefault({
      groups: [groupA, groupB],
      mode: "auto",
      savedProviderId: "openrouter",
      savedModel: "anthropic/claude-3-opus",
    });
    assert.equal(result.status, "auto-resolved");
    assert.equal(result.providerId, "openrouter");
    assert.equal(result.modelValue, "anthropic/claude-3-opus");
  });

  it("saved provider with invalid saved model uses that provider's first model", () => {
    const result = resolveNewChatDefault({
      groups: [groupA, groupB],
      mode: "auto",
      savedProviderId: "anthropic-official",
      savedModel: "deprecated-model-id",
    });
    assert.equal(result.status, "auto-resolved");
    assert.equal(result.providerId, "anthropic-official");
    assert.equal(result.modelValue, "sonnet");
  });

  it("saved provider missing → falls through to API default", () => {
    const result = resolveNewChatDefault({
      groups: [groupA, groupB],
      mode: "auto",
      apiDefaultProviderId: "openrouter",
      savedProviderId: "deleted-provider",
      savedModel: "x",
    });
    assert.equal(result.status, "auto-resolved");
    assert.equal(result.providerId, "openrouter");
  });

  it("no saved + no API default → falls through to first compatible group", () => {
    const result = resolveNewChatDefault({
      groups: [groupA, groupB],
      mode: "auto",
    });
    assert.equal(result.status, "auto-resolved");
    assert.equal(result.providerId, "anthropic-official");
    assert.equal(result.modelValue, "sonnet");
  });

  it("Auto ignores stored pinned hints (those belong to Pinned mode)", () => {
    // If the user has stale pinned values in storage but flipped to Auto,
    // the resolver must NOT honour them. Auto is Auto.
    const result = resolveNewChatDefault({
      groups: [groupA, groupB],
      mode: "auto",
      pinnedProviderId: "openrouter",
      pinnedModel: "anthropic/claude-3-opus",
      // Saved pair points elsewhere — this should win, not the pin.
      savedProviderId: "anthropic-official",
      savedModel: "sonnet",
    });
    assert.equal(result.status, "auto-resolved");
    assert.equal(result.providerId, "anthropic-official");
    assert.equal(result.modelValue, "sonnet");
  });
});
