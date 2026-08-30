/**
 * shiki tokenization offloaded to a Web Worker,
 * main-thread highlight kept as fallback.
 *
 * Four layers, all real-driving (not just source-pins) where a headless node
 * process can drive the logic:
 *
 * 1) HIGHLIGHT CORE (real shiki in node) — `createHighlightEngine` is the
 *    exact code the Worker runs. Driving it with real shiki proves tokenization
 *    actually produces themed tokens and that the unknown-language guard
 *    degrades to plain text instead of throwing (p5b-worker-offload logic +
 *    never-blank).
 * 2) WORKER CLIENT (fake worker) — request↔response correlation by id,
 *    out-of-order responses, ok:false, worker `error`/`messageerror`, spawn
 *    throw and postMessage throw all mark the client failed and reject so the
 *    caller can fall back.
 * 3) DISPATCH — `tokenizeWithFallback`: worker success returns the worker
 *    result WITHOUT calling the fallback (proves offload); worker reject / null
 *    client falls back to the main-thread tokenizer (proves p5b-fallback, never
 *    blank). Real-driving with spies, not source-pins.
 * 4) SOURCE PINS — the wiring that can't be behavior-tested headlessly: the
 *    code-block seam routes through the worker (no main-thread codeToTokens on
 *    the hot path), the contract shapes (tokensCache/subscribers/TokenSpan/
 *    createSharedCodePlugin/toTokensResult) are preserved, the Turbopack worker
 *    URL form is used, the Appearance preview stays a documented main-thread
 *    exception, and no new dependency / renderer CSP / sandbox-worker-src change
 *    sneaks in (p5b-no-overreach).
 *
 * Run with `node --import tsx --test` to dodge the reviewer sandbox's tsx IPC
 * EPERM false-negative.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHighlighter, bundledLanguages } from "shiki";
import type { BundledLanguage, BundledTheme, ThemedToken } from "shiki";
import {
  createHighlightEngine,
  type TokenizedCode,
} from "@/components/ai-elements/shiki-highlight-core";
import {
  createShikiWorkerClient,
  tokenizeWithFallback,
  type WorkerLike,
  type TokenizeParams,
} from "@/components/ai-elements/shiki-worker-client";
import type {
  ShikiTokenizeRequest,
  ShikiWorkerResponse,
} from "@/components/ai-elements/shiki-worker-protocol";

const AI_ELEMENTS = path.resolve(__dirname, "../../components/ai-elements");
const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

const LIGHT = "github-light" as BundledTheme;
const DARK = "github-dark" as BundledTheme;

/** TokenizedCode with an identifying fg/bg so tests can tell results apart. */
function mk(tag: string): TokenizedCode {
  return { tokens: [], fg: tag, bg: tag };
}

/**
 * True when a token carries real theme styling. In shiki's dual-theme mode
 * (themes: {light, dark}) the color lives in `htmlStyle` ({ color, --shiki-dark }),
 * not `token.color`. Raw fallback tokens (createRawTokens) have neither — so a
 * non-empty htmlStyle (or a concrete non-"inherit" color) proves this is real
 * highlighting, not plain text.
 */
function hasThemeStyling(tok: ThemedToken): boolean {
  const hs = (tok as { htmlStyle?: Record<string, string> }).htmlStyle;
  if (hs && Object.keys(hs).length > 0) return true;
  return typeof tok.color === "string" && !!tok.color && tok.color !== "inherit";
}

const PARAMS: TokenizeParams = {
  code: "const x = 1;",
  language: "typescript" as BundledLanguage,
  lightTheme: LIGHT,
  darkTheme: DARK,
};

// ── Layer 1: highlight core (real shiki) ──────────────────────────────────

describe("shiki-highlight-core — 真实 shiki 驱动（Worker 跑的正是这段逻辑）", () => {
  function realEngine() {
    return createHighlightEngine({
      createHighlighter,
      loadBundledLanguages: async () =>
        bundledLanguages as Record<string, unknown>,
      defaultLight: LIGHT,
      defaultDark: DARK,
    });
  }

  it("tokenize：真实 TS 片段 → 非空 themed tokens + fg/bg 字符串", async () => {
    const engine = realEngine();
    const result = await engine.tokenize(
      "const x = 1;",
      "typescript" as BundledLanguage,
      LIGHT,
      DARK,
    );
    assert.ok(Array.isArray(result.tokens), "tokens 是数组");
    assert.ok(result.tokens.length > 0, "至少一行");
    assert.ok(
      result.tokens.some((line) => line.length > 0),
      "至少一行有 token",
    );
    assert.ok(
      result.tokens.some((line) => line.some(hasThemeStyling)),
      "至少一个 token 带主题样式（htmlStyle）——确实高亮，不是裸文本",
    );
    assert.equal(typeof result.fg, "string");
    assert.equal(typeof result.bg, "string");
  });

  it("tokenize：未知语言 → getLoadedLanguages 守卫回退 text，仍返回 tokens 不抛（never-blank）", async () => {
    const engine = realEngine();
    const result = await engine.tokenize(
      "hello unknown language body",
      "totally-not-a-real-language" as BundledLanguage,
      LIGHT,
      DARK,
    );
    assert.ok(result.tokens.length > 0, "未知语言也能拿到 text tokens");
    assert.ok(
      result.tokens.some((line) =>
        line.some((tok) => tok.content.includes("hello")),
      ),
      "内容原样保留",
    );
  });
});

// ── Layer 2: worker client (fake worker) ──────────────────────────────────

/** Fake WorkerLike the client can drive without a real DOM/Worker. */
class FakeWorker implements WorkerLike {
  posted: ShikiTokenizeRequest[] = [];
  terminated = false;
  private listeners = new Map<string, Array<(ev: unknown) => void>>();

  postMessage(message: ShikiTokenizeRequest): void {
    this.posted.push(message);
  }
  addEventListener(type: string, listener: (ev: unknown) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }
  terminate(): void {
    this.terminated = true;
  }

  // test drivers
  emitMessage(data: ShikiWorkerResponse): void {
    for (const l of this.listeners.get("message") ?? []) l({ data });
  }
  emitError(message?: string): void {
    for (const l of this.listeners.get("error") ?? []) l({ message });
  }
  emitMessageError(): void {
    for (const l of this.listeners.get("messageerror") ?? []) l({});
  }
}

describe("shiki-worker-client — request↔response 关联 + 失败即 fallback 信号", () => {
  it("happy path：resolve worker tokens，且 postMessage 收到正确 RPC（id/code/themes）", async () => {
    const fake = new FakeWorker();
    const client = createShikiWorkerClient(() => fake);
    const p = client.tokenize(PARAMS);

    // postMessage runs synchronously inside tokenize()
    assert.equal(fake.posted.length, 1, "发出一条 RPC");
    const sent = fake.posted[0];
    assert.equal(sent.code, PARAMS.code);
    assert.equal(sent.language, PARAMS.language);
    assert.equal(sent.lightTheme, LIGHT);
    assert.equal(sent.darkTheme, DARK);
    assert.equal(typeof sent.id, "number");

    fake.emitMessage({ id: sent.id, ok: true, tokenized: mk("W") });
    const result = await p;
    assert.equal(result.fg, "W", "拿到 worker 返回的 tokenized");
  });

  it("按 id 关联：乱序返回也各自对上，不串号", async () => {
    const fake = new FakeWorker();
    const client = createShikiWorkerClient(() => fake);
    const p1 = client.tokenize({ ...PARAMS, code: "a" });
    const p2 = client.tokenize({ ...PARAMS, code: "b" });
    const [r1, r2] = fake.posted;

    // respond in reverse order
    fake.emitMessage({ id: r2.id, ok: true, tokenized: mk("B") });
    fake.emitMessage({ id: r1.id, ok: true, tokenized: mk("A") });

    assert.equal((await p1).fg, "A");
    assert.equal((await p2).fg, "B");
  });

  it("ok:false 响应 → reject 带 error message（触发上游 fallback）", async () => {
    const fake = new FakeWorker();
    const client = createShikiWorkerClient(() => fake);
    const p = client.tokenize(PARAMS);
    fake.emitMessage({ id: fake.posted[0].id, ok: false, error: "grammar boom" });
    await assert.rejects(p, /grammar boom/);
    // a single tokenize failure is NOT a hard worker failure
    assert.equal(client.failed, false);
  });

  it("worker error 事件 → 在途 reject + failed=true + 后续 tokenize 立即 reject", async () => {
    const fake = new FakeWorker();
    const client = createShikiWorkerClient(() => fake);
    const p = client.tokenize(PARAMS);
    fake.emitError("worker chunk 404");
    await assert.rejects(p, /worker chunk 404/);
    assert.equal(client.failed, true, "硬失败置位");
    await assert.rejects(client.tokenize(PARAMS), /previously failed/);
  });

  it("messageerror（不可克隆载荷）→ 硬失败", async () => {
    const fake = new FakeWorker();
    const client = createShikiWorkerClient(() => fake);
    const p = client.tokenize(PARAMS);
    fake.emitMessageError();
    await assert.rejects(p, /messageerror/);
    assert.equal(client.failed, true);
  });

  it("spawn 抛错（无法构造 Worker）→ tokenize reject + failed=true", async () => {
    const client = createShikiWorkerClient(() => {
      throw new Error("Worker undefined");
    });
    await assert.rejects(client.tokenize(PARAMS), /Worker undefined/);
    assert.equal(client.failed, true);
  });

  it("postMessage 抛错（worker 已 detached）→ reject + failed=true", async () => {
    const fake = new FakeWorker();
    fake.postMessage = () => {
      throw new Error("worker detached");
    };
    const client = createShikiWorkerClient(() => fake);
    await assert.rejects(client.tokenize(PARAMS), /worker detached/);
    assert.equal(client.failed, true);
  });

  it("terminate 调用底层 worker.terminate", () => {
    const fake = new FakeWorker();
    const client = createShikiWorkerClient(() => fake);
    // spawn lazily on first tokenize
    void client.tokenize(PARAMS);
    client.terminate();
    assert.equal(fake.terminated, true);
  });
});

// ── Layer 3: dispatch (worker-offload vs fallback) ────────────────────────

describe("tokenizeWithFallback — offload 走 worker，失败绝不空白", () => {
  it("client=null（SSR/无 Worker）→ 直接主线程 fallback，参数透传", async () => {
    let seen: unknown = null;
    const fallback = async (
      code: string,
      language: BundledLanguage,
      lightTheme: BundledTheme,
      darkTheme: BundledTheme,
    ) => {
      seen = { code, language, lightTheme, darkTheme };
      return mk("FB");
    };
    const result = await tokenizeWithFallback(PARAMS, null, fallback);
    assert.equal(result.fg, "FB");
    assert.deepEqual(seen, {
      code: PARAMS.code,
      language: PARAMS.language,
      lightTheme: LIGHT,
      darkTheme: DARK,
    });
  });

  it("worker resolve → 返回 worker 结果，且 fallback 绝不被调用（证明真卸载）", async () => {
    let fallbackCalled = false;
    const client = { tokenize: async () => mk("WORKER") };
    const result = await tokenizeWithFallback(PARAMS, client, async () => {
      fallbackCalled = true;
      return mk("FB");
    });
    assert.equal(result.fg, "WORKER");
    assert.equal(fallbackCalled, false, "worker 成功时主线程不 highlight");
  });

  it("worker reject → 回退主线程，返回 fallback 结果（p5b-fallback，never blank）", async () => {
    let fallbackCalled = false;
    const client = {
      tokenize: async () => {
        throw new Error("worker exploded");
      },
    };
    const result = await tokenizeWithFallback(PARAMS, client, async () => {
      fallbackCalled = true;
      return mk("FB");
    });
    assert.equal(result.fg, "FB");
    assert.equal(fallbackCalled, true, "worker 失败必须回退");
  });

  it("worker reject + fallback 用真实 engine → 仍产出真实高亮 tokens（端到端 fallback）", async () => {
    const engine = createHighlightEngine({
      createHighlighter,
      loadBundledLanguages: async () =>
        bundledLanguages as Record<string, unknown>,
      defaultLight: LIGHT,
      defaultDark: DARK,
    });
    const client = {
      tokenize: async () => {
        throw new Error("worker init failed");
      },
    };
    const result = await tokenizeWithFallback(PARAMS, client, engine.tokenize);
    assert.ok(result.tokens.length > 0, "回退后仍有真实 tokens，不空白");
    assert.ok(
      result.tokens.some((line) => line.some(hasThemeStyling)),
      "回退路径也是真高亮（有 htmlStyle 主题样式）",
    );
  });
});

// ── Layer 4: source pins (headless-untestable wiring + no-overreach) ──────

describe("source pins — seam 接线 / 契约保持 / 打包 URL / no-overreach", () => {
  const codeBlock = read("components/ai-elements/code-block.tsx");
  const core = read("components/ai-elements/shiki-highlight-core.ts");
  const worker = read("components/ai-elements/shiki.worker.ts");
  const clientSrc = read("components/ai-elements/shiki-worker-client.ts");
  const appearance = read("components/settings/AppearanceSection.tsx");

  it("code-block 热路径改走 worker：tokenizeWithFallback + getShikiWorkerClient + fallbackEngine", () => {
    assert.match(codeBlock, /tokenizeWithFallback\(/);
    assert.match(codeBlock, /getShikiWorkerClient\(\)/);
    assert.match(codeBlock, /fallbackEngine\.tokenize/);
    assert.match(codeBlock, /createHighlightEngine\(/);
  });

  it("code-block 主线程热路径不再 codeToTokens/getLoadedLanguages（仅 fallback engine 内）", () => {
    assert.doesNotMatch(
      codeBlock,
      /codeToTokens\(/,
      "codeToTokens 应已移出 code-block，只在 core（worker + fallback 共用）",
    );
    assert.doesNotMatch(codeBlock, /getLoadedLanguages\(/);
    // createHighlighter only survives as the fallback engine's injected dep
    assert.match(codeBlock, /createHighlighter,/);
  });

  it("对外契约形状保持不变：tokensCache / subscribers / TokenSpan / createSharedCodePlugin / toTokensResult", () => {
    assert.match(codeBlock, /const tokensCache = new LRUMap/);
    assert.match(codeBlock, /const subscribers = new Map/);
    assert.match(codeBlock, /const TokenSpan =/);
    assert.match(codeBlock, /export function createSharedCodePlugin/);
    assert.match(codeBlock, /function toTokensResult/);
  });

  it("core 承载 tokenization：codeToTokens + getLoadedLanguages 守卫 + createHighlightEngine", () => {
    assert.match(core, /codeToTokens\(/);
    assert.match(core, /getLoadedLanguages\(\)/);
    assert.match(core, /export function createHighlightEngine/);
  });

  it("worker entry：createHighlightEngine + engine.tokenize + 监听 message + postMessage ok:true/false", () => {
    assert.match(worker, /createHighlightEngine\(/);
    assert.match(worker, /engine\s*\.\s*tokenize\(/);
    assert.match(worker, /addEventListener\(\s*["']message["']/);
    assert.match(worker, /postMessage\(\{ id: req\.id, ok: true/);
    assert.match(worker, /ok: false/);
  });

  it("worker client 用 Turbopack 可识别的 worker URL 形式（same-origin module chunk）", () => {
    assert.match(
      clientSrc,
      /new Worker\(\s*new URL\(\s*["']\.\/shiki\.worker\.ts["']\s*,\s*import\.meta\.url\s*\)/,
    );
    assert.match(clientSrc, /type:\s*["']module["']/);
  });

  it("Appearance 预览是被文档化的主线程一次性例外（未塞进 worker）", () => {
    assert.match(appearance, /codeToHtml\(/, "预览仍走主线程 codeToHtml");
    assert.match(appearance, /Phase 5B/, "有例外说明");
    assert.match(appearance, /Web Worker/, "说明解释为何不进 worker");
  });

  it("worker 文件确实存在于 ai-elements 下", () => {
    assert.ok(fs.existsSync(path.join(AI_ELEMENTS, "shiki.worker.ts")));
    assert.ok(fs.existsSync(path.join(AI_ELEMENTS, "shiki-highlight-core.ts")));
    assert.ok(fs.existsSync(path.join(AI_ELEMENTS, "shiki-worker-client.ts")));
  });
});

describe("no-overreach — 无新依赖 / 无渲染进程 CSP / 不碰沙箱 worker-src", () => {
  it("package.json 未新增 @shikijs/stream 或其它 worker 依赖", () => {
    const pkg = read("../package.json");
    assert.doesNotMatch(pkg, /@shikijs\/stream/);
    // shiki 本身早已是依赖（Worker 内复用），未变
    assert.match(pkg, /"shiki":/);
  });

  it("next.config.ts 未新增渲染进程 CSP headers", () => {
    const nextCfg = read("../next.config.ts");
    assert.doesNotMatch(nextCfg, /Content-Security-Policy/i);
    assert.doesNotMatch(nextCfg, /async headers\(/);
  });

  it("inline-html 沙箱 worker-src 'none' 未被动，也没把 shiki worker 塞进去", () => {
    const csp = read("lib/inline-html-csp.ts");
    assert.match(csp, /worker-src 'none'/, "沙箱 iframe worker-src 仍为 none");
    assert.doesNotMatch(csp, /shiki/i, "shiki worker 未混入沙箱 CSP");
  });
});
