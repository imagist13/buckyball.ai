/**
 * v8 fix — Tasks 页"新建任务"跳到 /chat?prefill=… 时输入框必须真的回填
 * prefill 文本。Pre-fix 有两层独立 staleness：
 *
 *   1. `src/app/chat/page.tsx` 用 `useMemo([])` 读 `window.location.search`，
 *      只在 mount 那一次执行；如果 /chat 已经挂着 (warm 导航 / 浏览器
 *      back-forward / router.replace) 再换 ?prefill=…，缓存值不更新。
 *
 *   2. `src/components/chat/MessageInput.tsx` 用 `useState(() =>
 *      initialValue || draft)` 只在 mount 时读 `initialValue` prop；
 *      之后即使父组件把新 prefill 喂给 prop，textarea 也不动。
 *
 * 修法：(1) chat/page.tsx 拆出内层组件、外层 export 包 Suspense，
 *       内层用 `useSearchParams()` 读 prefill —— React 会在 URL 变化时
 *       自然 re-render；(2) MessageInput 用 React 官方"prop 变化时渲染期
 *       调整 state"模式（render time，非 useEffect）：用 `seenInitialValue`
 *       state 追踪上次 reconcile 的 prop，`initialValue !== seenInitialValue`
 *       时记录转变并在非空时 `setInputValueRaw(initialValue)` —— 跟 mount 时
 *       "prefill 战胜 draft" 的优先级一致。
 *
 * 2026-06-01 P0.4：(2) 从 `useEffect + adoptedInitialValueRef` 迁到渲染期
 *       seenInitialValue 模式，顺带清掉 set-state-in-effect / refs 两条
 *       React Compiler error（#35 on-touch）。下方 pin 已同步新结构。
 *
 * 这个文件是 source-grep 契约：钉死两层修复都不被未来重构默默退回
 * 静态读取。无需 React Testing Library 也能跑。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CHAT_PAGE = readFileSync(
  path.resolve(__dirname, '../../app/chat/page.tsx'),
  'utf-8',
);
const MESSAGE_INPUT = readFileSync(
  path.resolve(__dirname, '../../components/chat/MessageInput.tsx'),
  'utf-8',
);

describe('chat/page.tsx prefill must be reactive to URL changes', () => {
  it('imports Suspense from react and useSearchParams from next/navigation', () => {
    assert.match(
      CHAT_PAGE,
      /from\s+['"]react['"];?\s*(?:\/\/.*)?$|import[^;]*\bSuspense\b[^;]*from\s+['"]react['"]/m,
      'chat/page.tsx must import Suspense (needed for useSearchParams in App Router)',
    );
    assert.match(
      CHAT_PAGE,
      /import\s*\{[^}]*\buseSearchParams\b[^}]*\}\s*from\s+['"]next\/navigation['"]/,
      'chat/page.tsx must import useSearchParams from next/navigation — `useMemo([])` reading `window.location.search` is the pre-fix pattern that ignored warm-navigation URL changes',
    );
  });

  it('does NOT use the pre-fix `useMemo([])` + window.location.search pattern for prefill', () => {
    // The exact regression: a useMemo with an empty deps array that
    // reads window.location.search for the prefill query param. That
    // freezes prefillText to its first-mount value.
    assert.doesNotMatch(
      CHAT_PAGE,
      /useMemo\(\s*\(\)\s*=>\s*\{[\s\S]*?window\.location\.search[\s\S]*?prefill[\s\S]*?\}\s*,\s*\[\s*\]\s*\)/,
      'chat/page.tsx must NOT read prefill via `useMemo([])` over window.location.search — that pattern caches the URL forever and breaks warm navigation. Use `useSearchParams().get("prefill")` inside a Suspense-wrapped inner component.',
    );
  });

  it('default export wraps the body in <Suspense> so useSearchParams is legal', () => {
    // The default export must mount a Suspense boundary; the inner
    // function (where useSearchParams lives) renders inside it.
    const exportBlock = CHAT_PAGE.match(/export\s+default\s+function\s+\w+[\s\S]*?\n\}/);
    assert.ok(exportBlock, 'chat/page.tsx must have a default-exported function');
    assert.match(
      exportBlock![0],
      /<Suspense\b[\s\S]*?>[\s\S]*?<\/Suspense>/,
      'the default export must mount a <Suspense> boundary so useSearchParams() inside the inner component does not throw under static prerender',
    );
  });

  it('reads prefill via searchParams.get("prefill") (the reactive path)', () => {
    assert.match(
      CHAT_PAGE,
      /searchParams\.get\(\s*['"]prefill['"]\s*\)/,
      'chat/page.tsx must call `searchParams.get("prefill")` — that is what makes prefill react to URL changes after mount',
    );
  });
});

describe('MessageInput initialValue prop must propagate after mount (warm-navigation sync)', () => {
  it('tracks the last reconciled initialValue in STATE (render-time prop-transition pattern)', () => {
    // React's "adjust state when a prop changes" pattern records the last
    // seen prop in STATE (not a ref) so the reconcile can run during render
    // without a ref read — reading a ref during render is itself a React
    // Compiler bailout. Without this guard the sync would re-adopt prefill
    // every time the user types and the parent re-renders with the same prop.
    assert.match(
      MESSAGE_INPUT,
      /const\s*\[\s*seenInitialValue\s*,\s*setSeenInitialValue\s*\]\s*=\s*useState\(\s*initialValue\s*\)/,
      'MessageInput must track the last reconciled prefill in state — `const [seenInitialValue, setSeenInitialValue] = useState(initialValue)`',
    );
  });

  it('adopts a changed non-empty initialValue at RENDER time (not in a useEffect)', () => {
    // The adoption is a render-time prop-transition guard:
    //   if (initialValue !== seenInitialValue) {
    //     setSeenInitialValue(initialValue);
    //     if (initialValue) setInputValueRaw(initialValue);
    //   }
    const guard = MESSAGE_INPUT.match(
      /if\s*\(\s*initialValue\s*!==\s*seenInitialValue\s*\)\s*\{[\s\S]*?setInputValueRaw\(\s*initialValue\s*\)/,
    );
    assert.ok(
      guard,
      'MessageInput must reconcile prefill at render time: `if (initialValue !== seenInitialValue) { … setInputValueRaw(initialValue) }` — the warm-navigation adoption path',
    );
    assert.match(
      guard![0],
      /setSeenInitialValue\(\s*initialValue\s*\)/,
      'the reconcile must record the transition via setSeenInitialValue(initialValue) so it runs at most once per prop change',
    );
  });

  it('does NOT re-introduce the pre-fix effect-with-ref pattern (regression guard)', () => {
    // The render-time pattern replaced `useEffect` + `adoptedInitialValueRef`.
    // An effect that setState synchronously, and a ref read during render,
    // are both React Compiler bailouts (#35). Pin that the ref is gone.
    assert.doesNotMatch(
      MESSAGE_INPUT,
      /adoptedInitialValueRef/,
      'the prefill sync must not use adoptedInitialValueRef — superseded by the render-time seenInitialValue pattern',
    );
  });

  it('records EVERY transition (incl. → empty) so re-arrival of the same prefill re-adopts', () => {
    // setSeenInitialValue runs for ANY transition (it's the first statement,
    // before the non-empty adoption), so prefill "hi" → "" → "hi" re-adopts:
    // the second "hi" !== seen("") . This is the 新建任务 re-click scenario;
    // a regression that only updated `seen` on non-empty values would pin it
    // to the old prefill and silently drop the re-click.
    const guard = MESSAGE_INPUT.match(
      /if\s*\(\s*initialValue\s*!==\s*seenInitialValue\s*\)\s*\{[\s\S]*?\}/,
    );
    assert.ok(guard, 'reconcile guard not found');
    const seenIdx = guard![0].indexOf('setSeenInitialValue');
    const adoptIdx = guard![0].indexOf('setInputValueRaw');
    assert.ok(
      seenIdx !== -1 && (adoptIdx === -1 || seenIdx < adoptIdx),
      'setSeenInitialValue must run for every transition (before the non-empty adoption) so a → empty transition is recorded too',
    );
  });
});
