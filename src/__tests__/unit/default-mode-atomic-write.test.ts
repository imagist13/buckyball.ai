/**
 * Phase 2C contract — default-mode atomic write protection.
 *
 * The bug this test prevents: the `/api/providers/options` PUT route
 * merges incoming options with existing storage before calling
 * `setProviderOptions` (route.ts: `const merged = { ...existing,
 * ...options }`). For `__global__`, that means a request like
 * `{ providerId: '__global__', options: { default_mode: 'auto' } }`
 * arrives at `setProviderOptions` carrying the user's stale
 * `default_model_provider` and `default_model` from the previous
 * Pinned commitment. Without the early-return at db.ts:1680, the
 * per-field branches would re-write those stale values and the
 * resolver would still see a pinned provider while the user thinks
 * they switched to Auto.
 *
 * The contract this locks in: when `setProviderOptions('__global__',
 * { default_mode: 'auto' })` runs — even with merged-in stale
 * `default_model_*` keys — the function MUST clear them and return.
 * No silent re-pin under Auto.
 *
 * Phase 1 (Step 1) of refactor-closeout: default-model contract audit.
 * If a future refactor drops the early-return, this test fails loudly.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  setProviderOptions,
  getSetting,
  setSetting,
} from "../../lib/db";
import type { ProviderOptions } from "../../types";

describe("Default-mode atomic write (Phase 2C contract)", () => {
  let snapMode: string;
  let snapProvider: string;
  let snapModel: string;
  let snapLegacy: string;

  before(() => {
    snapMode = getSetting("global_default_mode") ?? "";
    snapProvider = getSetting("global_default_model_provider") ?? "";
    snapModel = getSetting("global_default_model") ?? "";
    snapLegacy = getSetting("default_provider_id") ?? "";
  });

  after(() => {
    setSetting("global_default_mode", snapMode);
    setSetting("global_default_model_provider", snapProvider);
    setSetting("global_default_model", snapModel);
    setSetting("default_provider_id", snapLegacy);
  });

  it("Pinned → Auto: clears stale pin even when merged in by the API route", () => {
    // Simulate prior Pinned state.
    setSetting("global_default_mode", "pinned");
    setSetting("global_default_model_provider", "stale-pid");
    setSetting("global_default_model", "stale-model");
    setSetting("default_provider_id", "stale-pid");

    // Simulate exactly what `/api/providers/options` PUT delivers when
    // the user clicks "切回 Auto": route merges existing options with
    // body, so the merged blob still carries stale default_model* keys.
    const mergedFromRoute: ProviderOptions = {
      default_mode: "auto",
      default_model_provider: "stale-pid",   // ← merged in from existing
      default_model: "stale-model",          // ← merged in from existing
      legacy_default_provider_id: "",
    } as ProviderOptions;

    setProviderOptions("__global__", mergedFromRoute);

    assert.equal(
      getSetting("global_default_mode"),
      "auto",
      "mode should switch to Auto",
    );
    assert.equal(
      getSetting("global_default_model_provider"),
      "",
      "stale pinned provider must be cleared, not re-pinned via merge",
    );
    assert.equal(
      getSetting("global_default_model"),
      "",
      "stale pinned model must be cleared, not re-pinned via merge",
    );
    assert.equal(
      getSetting("default_provider_id"),
      "",
      "legacy default_provider_id should follow the explicit clear",
    );
  });

  it("Auto → Pinned: writes mode + provider + model atomically when sent as a bundle", () => {
    setSetting("global_default_mode", "auto");
    setSetting("global_default_model_provider", "");
    setSetting("global_default_model", "");
    setSetting("default_provider_id", "");

    setProviderOptions("__global__", {
      default_mode: "pinned",
      default_model_provider: "new-pid",
      default_model: "new-model",
      legacy_default_provider_id: "new-pid",
    } as ProviderOptions);

    assert.equal(getSetting("global_default_mode"), "pinned");
    assert.equal(getSetting("global_default_model_provider"), "new-pid");
    assert.equal(getSetting("global_default_model"), "new-model");
    assert.equal(getSetting("default_provider_id"), "new-pid");
  });

  it("Pinned → Pinned (different model): replaces all three together", () => {
    setSetting("global_default_mode", "pinned");
    setSetting("global_default_model_provider", "old-pid");
    setSetting("global_default_model", "old-model");
    setSetting("default_provider_id", "old-pid");

    // Re-pin to a different model (same UI flow as picking a new pin
    // on the Models page). Route merges; we get a fresh bundle.
    setProviderOptions("__global__", {
      default_mode: "pinned",
      default_model_provider: "fresh-pid",
      default_model: "fresh-model",
      legacy_default_provider_id: "fresh-pid",
    } as ProviderOptions);

    assert.equal(getSetting("global_default_mode"), "pinned");
    assert.equal(getSetting("global_default_model_provider"), "fresh-pid");
    assert.equal(getSetting("global_default_model"), "fresh-model");
    assert.equal(getSetting("default_provider_id"), "fresh-pid");
  });

  it("Auto → Auto with leftover stale keys: still clears (idempotent defense)", () => {
    // Defensive: if for any reason both global_* keys were stale and
    // mode was already 'auto', a re-write of mode='auto' should still
    // sweep them. (This guards against partial-migration DBs and
    // double-click race conditions.)
    setSetting("global_default_mode", "auto");
    setSetting("global_default_model_provider", "leftover-pid");
    setSetting("global_default_model", "leftover-model");
    setSetting("default_provider_id", "leftover-pid");

    setProviderOptions("__global__", {
      default_mode: "auto",
      default_model_provider: "leftover-pid",
      default_model: "leftover-model",
      legacy_default_provider_id: "",
    } as ProviderOptions);

    assert.equal(getSetting("global_default_mode"), "auto");
    assert.equal(
      getSetting("global_default_model_provider"),
      "",
      "leftover pinned provider must be cleared on any Auto write",
    );
    assert.equal(
      getSetting("global_default_model"),
      "",
      "leftover pinned model must be cleared on any Auto write",
    );
  });
});
