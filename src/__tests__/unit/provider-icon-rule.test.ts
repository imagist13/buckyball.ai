/**
 * Brand-icon resolver — pure rule unit tests.
 *
 * Locks in the matching rules so future vendor additions don't quietly
 * steal icons from sibling brands. The motivating regression: a previous
 * Bailian rule of `url.includes('token-plan')` was added to recognize the
 * new Bailian Token Plan 团队版 host (`token-plan.cn-beijing.maas.aliyuncs.com`),
 * but it also matched Xiaomi MiMo Token Plan's host
 * (`token-plan-cn.xiaomimimo.com`) — Xiaomi MiMo Token Plan rows in the
 * Models / Providers UI silently rendered the Bailian brand icon.
 *
 * Fix: drop the bare `token-plan` URL match. `maas.aliyuncs.com` already
 * covers Bailian Token Plan, and Xiaomi MiMo's `xiaomimimo` host fragment
 * routes correctly to its own brand. Tests below pin both.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getProviderIconKey } from "../../lib/provider-icon-rule";

describe("getProviderIconKey — Token Plan host disambiguation", () => {
  it("Bailian Token Plan 团队版 host → bailian (via maas.aliyuncs.com)", () => {
    assert.equal(
      getProviderIconKey(
        "Aliyun Bailian Token Plan",
        "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
      ),
      "bailian",
    );
  });

  it("Xiaomi MiMo Token Plan host → xiaomi-mimo (NOT bailian)", () => {
    // The exact regression the user caught: a generic `token-plan` URL
    // match would steal this. The current rule uses `maas.aliyuncs.com`
    // to scope Bailian to Aliyun hosts only, so this row's
    // `xiaomimimo` host fragment hits Xiaomi MiMo's branch.
    const key = getProviderIconKey(
      "Xiaomi MiMo Token Plan",
      "https://token-plan-cn.xiaomimimo.com/anthropic",
    );
    assert.equal(key, "xiaomi-mimo");
    assert.notEqual(key, "bailian");
  });

  it("Bailian Coding Plan host → bailian (via dashscope)", () => {
    assert.equal(
      getProviderIconKey(
        "Aliyun Bailian",
        "https://coding.dashscope.aliyuncs.com/apps/anthropic",
      ),
      "bailian",
    );
  });

  it("Xiaomi MiMo PAYG host → xiaomi-mimo", () => {
    assert.equal(
      getProviderIconKey("Xiaomi MiMo", "https://api.xiaomimimo.com/anthropic"),
      "xiaomi-mimo",
    );
  });
});

describe("getProviderIconKey — first-match-wins ordering for shared fragments", () => {
  // Lock in vendors whose name or URL fragment overlaps with another rule.
  // A future contributor reordering blocks could silently flip these.

  it("OpenRouter beats Anthropic when name has both", () => {
    assert.equal(
      getProviderIconKey("OpenRouter (Anthropic)", "https://openrouter.ai/api/v1"),
      "openrouter",
    );
  });

  it("DeepSeek anthropic-compat host → deepseek (not anthropic — `/anthropic` path is generic)", () => {
    // Several vendors expose an Anthropic-compat endpoint under
    // `/anthropic`. The DeepSeek rule must take precedence over the
    // generic `url.includes('anthropic')` fallback.
    assert.equal(
      getProviderIconKey("DeepSeek", "https://api.deepseek.com/anthropic"),
      "deepseek",
    );
  });

  it("Ollama via localhost:11434 → ollama (URL-only match)", () => {
    assert.equal(
      getProviderIconKey("Custom Local Service", "http://localhost:11434/v1"),
      "ollama",
    );
  });

  it("Google Vertex name → google", () => {
    assert.equal(getProviderIconKey("Google Vertex", ""), "google");
  });

  it("AWS Bedrock name → bedrock (bedrock check beats `aws`)", () => {
    assert.equal(getProviderIconKey("AWS Bedrock", ""), "bedrock");
  });

  it("Pure unmatched provider → default", () => {
    assert.equal(
      getProviderIconKey("Some Random Service", "https://example.com/api"),
      "default",
    );
  });
});

describe("getProviderIconKey — OpenCode Go / ClinePass", () => {
  // OpenCode Go preset names carry a protocol suffix; the opencode rule must
  // win BEFORE the name-side openai/anthropic matchers, which would otherwise
  // steal the wrong brand logo. (OpenCode brand icon added in @lobehub/icons 4.9.0.)
  it("OpenCode Go (OpenAI) → opencode, NOT openai", () => {
    const key = getProviderIconKey("OpenCode Go (OpenAI)", "https://opencode.ai/zen/go/v1");
    assert.equal(key, "opencode");
    assert.notEqual(key, "openai");
  });

  it("OpenCode Go (Anthropic) → opencode, NOT anthropic", () => {
    const key = getProviderIconKey("OpenCode Go (Anthropic)", "https://opencode.ai/zen/go");
    assert.equal(key, "opencode");
    assert.notEqual(key, "anthropic");
  });

  it("ClinePass → cline (via host and name)", () => {
    assert.equal(getProviderIconKey("ClinePass", "https://api.cline.bot/api/v1"), "cline");
    assert.equal(getProviderIconKey("My ClinePass", "https://example.com"), "cline");
  });

  it("cline match is scoped — 'Decline Relay' on a generic host → default", () => {
    // Guards against a bare `cline` substring stealing icons.
    assert.equal(getProviderIconKey("Decline Relay", "https://example.com/api"), "default");
  });
});

describe("getProviderIconKey — legitimate Bailian matchers", () => {
  it("URL with bare aliyun (without maas/dashscope) still routes via name", () => {
    // The rule prefers Aliyun-scoped URL fragments, but name-side
    // matchers (`bailian` / `百炼` / `aliyun`) catch user-renamed
    // entries with non-canonical hosts.
    assert.equal(
      getProviderIconKey("Aliyun Custom Endpoint", "https://my-proxy.example.com"),
      "bailian",
    );
  });

  it("Chinese name 百炼 → bailian", () => {
    assert.equal(getProviderIconKey("百炼", "https://example.com"), "bailian");
  });
});
