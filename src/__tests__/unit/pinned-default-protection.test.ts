/**
 * Phase 2C contract — pinned default protection.
 *
 * Locks in the silent-substitution fix from `7e74200`. Before that
 * commit, `setDefaultProviderId(id)` rewrote both the legacy
 * `default_provider_id` AND the user's pin keys
 * (`global_default_model_provider`, clearing `global_default_model`).
 * The auto-heal in `/api/providers/models` calls `setDefaultProviderId`
 * on every fetch when the default provider is missing — so a Pinned
 * user with a broken pin would silently lose their commitment on each
 * chat-page mount.
 *
 * The contract: **`setDefaultProviderId` writes only the legacy key.
 * The user's pin (`global_default_*`) stays untouched, so the resolver
 * still detects 'invalid-default' and the UI prompts for explicit
 * recovery instead of replacing the user's choice silently.**
 *
 * If a future refactor reintroduces the silent rewrite, these tests
 * fail loudly — keeping the contract honest.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  setDefaultProviderId,
  getSetting,
  setSetting,
} from "../../lib/db";

describe("Pinned default protection (Phase 2C contract)", () => {
  // Snapshot the user's real settings so the test doesn't trash them.
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
    // Restore exactly what was there.
    setSetting("global_default_mode", snapMode);
    setSetting("global_default_model_provider", snapProvider);
    setSetting("global_default_model", snapModel);
    setSetting("default_provider_id", snapLegacy);
  });

  it("setDefaultProviderId does NOT rewrite the user's pin (mode=pinned)", () => {
    // Pretend the user explicitly pinned something.
    setSetting("global_default_mode", "pinned");
    setSetting("global_default_model_provider", "user-pinned-pid");
    setSetting("global_default_model", "user-pinned-model");

    // Backend / auto-heal calls setDefaultProviderId — historically this
    // also clobbered the user's pin. The contract now: legacy key only.
    setDefaultProviderId("auto-healed-pid");

    assert.equal(
      getSetting("global_default_mode"),
      "pinned",
      "mode must be unchanged",
    );
    assert.equal(
      getSetting("global_default_model_provider"),
      "user-pinned-pid",
      "pinned provider must NOT be rewritten by setDefaultProviderId",
    );
    assert.equal(
      getSetting("global_default_model"),
      "user-pinned-model",
      "pinned model must NOT be cleared by setDefaultProviderId",
    );
    // Legacy key is the only thing this writer is allowed to touch.
    assert.equal(
      getSetting("default_provider_id"),
      "auto-healed-pid",
      "legacy default_provider_id should reflect the heal",
    );
  });

  it("setDefaultProviderId does NOT touch global_default_* in Auto mode either", () => {
    // The function's contract is mode-independent: write only the legacy
    // key. In Auto mode the global_* keys should already be empty post-
    // migration, but a passing legacy DB with stale values shouldn't be
    // disturbed (or "fixed") by a backend writer.
    setSetting("global_default_mode", "auto");
    setSetting("global_default_model_provider", "");
    setSetting("global_default_model", "");

    setDefaultProviderId("legacy-pid");

    assert.equal(
      getSetting("global_default_model_provider"),
      "",
      "Auto-mode global provider stays empty after legacy write",
    );
    assert.equal(
      getSetting("global_default_model"),
      "",
      "Auto-mode global model stays empty after legacy write",
    );
    assert.equal(
      getSetting("default_provider_id"),
      "legacy-pid",
      "legacy key reflects the write",
    );
  });
});
