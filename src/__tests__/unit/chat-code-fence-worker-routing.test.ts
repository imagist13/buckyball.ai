/**
 * Chat code-fence highlighting regression — route fenced code through the Shiki Worker.
 *
 * The reviewer's production smoke found real chat messages rendered fenced code
 * as un-highlighted `<pre><code class="... language-x">` — the `code` override
 * (ChatInlineCode) had SWALLOWED fenced blocks as inline pills, so they never
 * reached `highlightCode()` → the Shiki Worker. The bundling/worker layers were
 * green but the chat main path didn't use them.
 *
 * These tests drive the fix at the seam that regressed:
 *
 * 1) ROUTING (pure) — `isChatFenceBlock` classifies inline vs fenced exactly
 *    like streamdown (single-line node.position ⇒ inline), with language-class /
 *    embedded-newline fallbacks. Proves a fence is NOT treated as inline.
 * 2) RENDER (react-dom/server, real components) — the actual
 *    `CHAT_MARKDOWN_COMPONENTS.code` renders:
 *      - a fenced block → a worker-aware Widget-card block (data-language +
 *        data-codepilot-chat-code-block) whose body is CodeBlockContent (the
 *        highlightCode → Worker seam), with the raw code shown immediately so
 *        it is NEVER blank, and NOT the inline pill;
 *      - inline code → the muted pill, with NO block markers.
 *    This is the assertion that would have caught the P1: before the fix the
 *    fenced markup was the inline pill and carried no data-language.
 *
 * The worker-offload vs main-thread FALLBACK dispatch itself
 * (`tokenizeWithFallback`, real-driven) is covered by
 * `shiki-worker-highlight.test.ts`; here we prove the CHAT path actually enters
 * that seam. The forced-Worker-failure browser check is an operator smoke.
 *
 * Run: node --import tsx --test --import ./src/__tests__/db-isolation.setup.ts \
 *   src/__tests__/unit/chat-code-fence-worker-routing.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CHAT_MARKDOWN_COMPONENTS,
  isChatFenceBlock,
} from "@/components/chat/markdown-components";

// A multi-line fenced block: streamdown gives it a multi-line node.position and
// a `language-xxx` className. An inline span is single-line, no language class.
const FENCE_NODE = { position: { start: { line: 1 }, end: { line: 4 } } };
const INLINE_NODE = { position: { start: { line: 7 }, end: { line: 7 } } };
const FENCE_CODE = "const answer: number = 42;\nconsole.log(answer);";

describe("isChatFenceBlock — 围栏块不再被当成 inline code", () => {
  it("多行 node.position + language 类 → block", () => {
    assert.equal(
      isChatFenceBlock({
        node: FENCE_NODE,
        className: "language-typescript",
        text: FENCE_CODE,
      }),
      true,
    );
  });

  it("单行 node.position 且无 language 类 → inline", () => {
    assert.equal(
      isChatFenceBlock({ node: INLINE_NODE, className: undefined, text: "answer" }),
      false,
    );
  });

  it("无 node.position 时回退：有 language 类 → block", () => {
    assert.equal(
      isChatFenceBlock({ className: "language-json", text: "{}" }),
      true,
    );
  });

  it("无 node.position 时回退：含换行 → block（无语言的裸围栏）", () => {
    assert.equal(isChatFenceBlock({ text: "line1\nline2" }), true);
  });

  it("无 node.position、单行、无 language 类 → inline", () => {
    assert.equal(isChatFenceBlock({ text: "inlineToken" }), false);
  });
});

describe("CHAT_MARKDOWN_COMPONENTS.code — 真实渲染：围栏块进 worker-aware 结构，不被 inline 吞掉", () => {
  const Code = CHAT_MARKDOWN_COMPONENTS.code;
  const Pre = CHAT_MARKDOWN_COMPONENTS.pre;

  // Inline pill's distinguishing class (ChatInlineCode). Fenced blocks must NOT
  // render this — that was exactly the P1 symptom.
  const INLINE_PILL_CLASS = /text-\[0\.875em\]/;

  it("围栏块 → Widget 卡片块：data-language + block 标记 + CodeBlockContent 主体，且立即显示源码（never blank）", () => {
    // Render exactly how streamdown wires it: <pre> wraps the <code> node.
    const html = renderToStaticMarkup(
      createElement(
        Pre,
        null,
        createElement(
          Code,
          {
            node: FENCE_NODE,
            className: "language-typescript",
          },
          FENCE_CODE,
        ),
      ),
    );

    // Worker-aware, stable block contract (reviewer's example: data-language).
    assert.match(html, /data-language="typescript"/, "块携带 data-language 契约");
    assert.match(
      html,
      /data-codepilot-chat-code-block/,
      "渲染为独立代码块卡片，而非 inline",
    );
    // CodeBlockContent body renders a <pre> (the highlightCode → Worker seam).
    assert.match(html, /<pre/, "主体是 CodeBlockContent 的 <pre>（走 highlightCode/Worker）");
    // Never blank: raw source is visible immediately (before async tokens land).
    assert.match(html, /const answer/, "源码立即可见，绝不空白");
    // Regression guard: the fence is NOT the inline pill.
    assert.doesNotMatch(html, INLINE_PILL_CLASS, "围栏块不得渲染成 inline 药丸");
  });

  it("inline code → 药丸，无任何 block 标记 / data-language", () => {
    const html = renderToStaticMarkup(
      createElement(
        Code,
        { node: INLINE_NODE },
        "inlineToken",
      ),
    );
    assert.match(html, INLINE_PILL_CLASS, "inline 仍是药丸");
    assert.match(html, /inlineToken/);
    assert.doesNotMatch(html, /data-language/, "inline 不应带 data-language");
    assert.doesNotMatch(
      html,
      /data-codepilot-chat-code-block/,
      "inline 不应被当成 block",
    );
  });

  it("无语言的裸围栏（含换行）→ 仍进 block 卡片，data-language 回退 text", () => {
    const html = renderToStaticMarkup(
      createElement(
        Pre,
        null,
        createElement(
          Code,
          { node: FENCE_NODE },
          "plain line 1\nplain line 2",
        ),
      ),
    );
    assert.match(html, /data-codepilot-chat-code-block/);
    assert.match(html, /data-language="text"/, "无语言时 data-language 回退 text");
    assert.match(html, /plain line 1/, "源码立即可见");
    assert.doesNotMatch(html, INLINE_PILL_CLASS);
  });
});
