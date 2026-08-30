/**
 * Route-level regression for `/api/providers/options` — Phase 2C
 * default-mode contract at the API boundary.
 *
 * Why this exists separately from `default-mode-atomic-write.test.ts`:
 *   - That test locks `setProviderOptions('__global__', { default_mode:
 *     'auto' })` at the DB layer. The actual write is correct.
 *   - But the route returns `{ options: <pre-write merged blob> }`.
 *     When the client switches to Auto, the merged blob still carries
 *     the user's prior pinned values (the route's generic merge has no
 *     idea about Auto's clear semantics; only `setProviderOptions`'s
 *     early-return at db.ts:1680 does). Returning `merged` directly
 *     means the API contract lies: write succeeded with cleared keys,
 *     but the response still shows a pinned pair.
 *   - Some clients refetch via `provider-changed` events and recover.
 *     A future client that trusts the PUT response — or a test like
 *     ModelsSection's optimistic state — would silently re-pin.
 *
 * The contract this test locks in: PUT response always reflects the
 * post-write DB state, not the pre-write merged input. If a future
 * refactor stops refetching, this test fails loudly.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { getSetting, setSetting } from "../../lib/db";
import { PUT as optionsPUT, GET as optionsGET } from "../../app/api/providers/options/route";

function putReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/providers/options", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getReq(providerId: string): NextRequest {
  return new NextRequest(`http://localhost/api/providers/options?providerId=${providerId}`);
}

describe("/api/providers/options PUT — default-mode response shape", () => {
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

  it("Pinned → Auto: response.options has empty pinned keys (no stale leak)", async () => {
    // Prior Pinned state.
    setSetting("global_default_mode", "pinned");
    setSetting("global_default_model_provider", "stale-pid");
    setSetting("global_default_model", "stale-model");

    // Client sends only the mode flip + legacy clear (the actual UI
    // payload from ModelsSection.handleRevertToAuto). The route merges
    // with existing storage internally, so the merged blob carries
    // stale `default_model_*` keys; if we return `merged`, the client
    // would see a pinned pair on a successful Auto switch.
    const res = await optionsPUT(putReq({
      providerId: "__global__",
      options: { default_mode: "auto", legacy_default_provider_id: "" },
    }));

    assert.equal(res.status, 200);
    const body = (await res.json()) as { options: Record<string, unknown> };

    assert.equal(body.options.default_mode, "auto", "response mode should be 'auto'");
    assert.equal(
      body.options.default_model_provider ?? "",
      "",
      "response must NOT carry stale pinned provider after Auto switch",
    );
    assert.equal(
      body.options.default_model ?? "",
      "",
      "response must NOT carry stale pinned model after Auto switch",
    );
    // Sanity: GET returns the same post-write shape.
    const getRes = await optionsGET(getReq("__global__"));
    const getBody = (await getRes.json()) as { options: Record<string, unknown> };
    assert.equal(getBody.options.default_mode, "auto");
    assert.equal(getBody.options.default_model_provider ?? "", "");
    assert.equal(getBody.options.default_model ?? "", "");
  });

  it("Auto → Pinned: response.options reflects the new pinned bundle", async () => {
    setSetting("global_default_mode", "auto");
    setSetting("global_default_model_provider", "");
    setSetting("global_default_model", "");

    const res = await optionsPUT(putReq({
      providerId: "__global__",
      options: {
        default_mode: "pinned",
        default_model_provider: "fresh-pid",
        default_model: "fresh-model",
        legacy_default_provider_id: "fresh-pid",
      },
    }));

    assert.equal(res.status, 200);
    const body = (await res.json()) as { options: Record<string, unknown> };
    assert.equal(body.options.default_mode, "pinned");
    assert.equal(body.options.default_model_provider, "fresh-pid");
    assert.equal(body.options.default_model, "fresh-model");
  });

  it("Pinned → Pinned (different model): response replaces all three", async () => {
    setSetting("global_default_mode", "pinned");
    setSetting("global_default_model_provider", "old-pid");
    setSetting("global_default_model", "old-model");

    const res = await optionsPUT(putReq({
      providerId: "__global__",
      options: {
        default_mode: "pinned",
        default_model_provider: "next-pid",
        default_model: "next-model",
        legacy_default_provider_id: "next-pid",
      },
    }));

    assert.equal(res.status, 200);
    const body = (await res.json()) as { options: Record<string, unknown> };
    assert.equal(body.options.default_model_provider, "next-pid");
    assert.equal(body.options.default_model, "next-model");
  });
});
