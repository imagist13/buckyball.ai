/**
 * 稳定性审计 Phase 2 ③ — 首轮导航劫持修复。
 *
 * 旧 `app/chat/page.tsx`：首轮 SSE 流跑完后无条件 `router.push('/chat/<newId>')`。
 * 若用户在首轮流式期间切到别的会话（本页卸载），异步完成回调仍会 push 把用户
 * 拽回刚建的会话 —— 导航劫持。
 *
 * 修复：把 push 交给一个「挂载期才放行」的 guard；page 在卸载 cleanup 里
 * `deactivate()`（并 abort 在途 controller）。本文件真实驱动 guard 机制，复现
 * 「首轮流式期间切走 → 完成后 push 被抑制 → 用户仍停在切到的会话」；再加源码钉
 * 确认 page.tsx 两处 push 都走 guard、且有卸载 cleanup。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createFirstTurnNavGuard } from '@/lib/first-turn-navigation';

describe('FirstTurnNavGuard 行为（Phase 2 ③）', () => {
  it('挂载期（active）navigate 会真正执行 push 并返回 true', () => {
    const guard = createFirstTurnNavGuard();
    let pushed: string | null = null;
    assert.equal(guard.active, true, '初始应为 active');
    const ran = guard.navigate(() => { pushed = '/chat/new'; });
    assert.equal(ran, true, 'active 时 navigate 返回 true');
    assert.equal(pushed, '/chat/new', 'active 时 push 真正执行');
  });

  it('复现劫持场景：首轮流式期间切走(deactivate) → 完成回调的 push 被抑制', () => {
    const guard = createFirstTurnNavGuard();
    let pushCount = 0;
    // 用户切到别的会话 → 本页卸载 → cleanup 调 deactivate()
    guard.deactivate();
    assert.equal(guard.active, false, 'deactivate 后 active=false');
    // 首轮流在后台完成 → 完成回调尝试 push
    const ran = guard.navigate(() => { pushCount += 1; });
    assert.equal(ran, false, 'deactivate 后 navigate 返回 false');
    assert.equal(pushCount, 0, '切走后完成的 push 必须被抑制（用户仍停在切到的会话，不被拽回）');
  });

  it('deactivate 幂等 + 不影响其它 guard 实例（每个新会话页各自一个 guard）', () => {
    const a = createFirstTurnNavGuard();
    const b = createFirstTurnNavGuard();
    a.deactivate();
    a.deactivate(); // 幂等
    let bPushed = false;
    b.navigate(() => { bPushed = true; });
    assert.equal(a.active, false);
    assert.equal(bPushed, true, '一个页面的 guard 卸载不应影响另一个仍挂载页面的 guard');
  });

  it('StrictMode 循环安全：reactivate 能把 cleanup 里 deactivate 的 guard 重新武装', () => {
    // dev StrictMode: mount(effect reactivate) → unmount(cleanup deactivate)
    //               → remount(effect reactivate)。最终必须回到 active，否则
    // 真实首轮完成的 push 会被误抑制、用户建了会话却进不去。
    const guard = createFirstTurnNavGuard();
    guard.reactivate();   // mount effect
    guard.deactivate();   // strictmode 模拟卸载 cleanup
    guard.reactivate();   // remount effect
    let pushed = false;
    const ran = guard.navigate(() => { pushed = true; });
    assert.equal(guard.active, true, 'reactivate 后必须回到 active');
    assert.equal(ran, true);
    assert.equal(pushed, true, 'StrictMode 循环后首轮 push 仍应正常执行');
  });
});

describe('page.tsx 接线源码钉（Phase 2 ③）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../app/chat/page.tsx'), 'utf8');
  const chatRouteSrc = fs.readFileSync(path.resolve(__dirname, '../../app/api/chat/route.ts'), 'utf8');

  it('创建 guard、mount 重新武装、卸载 cleanup deactivate + abort 发送 controller', () => {
    assert.match(src, /createFirstTurnNavGuard\(\)/, '必须创建首轮导航 guard');
    // mount effect 里 reactivate（StrictMode 循环安全）
    assert.match(src, /guard\?\.reactivate\(\)/, 'mount effect 必须 reactivate（防 StrictMode 循环误杀）');
    // 卸载 cleanup：deactivate + abort controller
    assert.match(
      src,
      /guard\?\.deactivate\(\)[\s\S]{0,120}abortControllerRef\.current\?\.abort\(\)/,
      '卸载 cleanup 必须同时 deactivate guard 与 abort 在途发送 controller',
    );
  });

  it('两处首轮 router.push 都经 guard.navigate（不再无条件 push）', () => {
    // 成功完成路径 + AbortError 路径都必须走 guard.navigate
    const navigateCalls = src.match(/navGuardRef\.current\?\.navigate\(\(\) => router\.push\(/g) ?? [];
    assert.equal(
      navigateCalls.length,
      2,
      '首轮完成 push 与 abort 后 push 两处都必须经 guard.navigate（共 2 处）',
    );
    // abort 路径的 `${sessionId}`（局部变量）跳转是首轮流独有；改后它只能经
    // guard.navigate 出现，不得再有裸的、不经 guard 的版本（其余 `${session.id}`
    // 的 push 属 onboarding wizard 等无关流程，不在本项范围）。
    assert.doesNotMatch(
      src,
      /(?<!navigate\(\(\) => )router\.push\(`\/chat\/\$\{sessionId\}`\)/,
      'abort 后的首轮跳转不得存在不经 guard 的裸 router.push(`/chat/${sessionId}`)',
    );
  });

  it('切换会话只分离 renderer，显式 Stop 才中断 server-owned Runtime', () => {
    assert.doesNotMatch(
      chatRouteSrc,
      /request\.signal\.addEventListener\(['"]abort['"][\s\S]{0,160}abortController\.abort\(\)/,
      'renderer transport disconnect must not abort the server-owned Runtime',
    );
    assert.match(
      src,
      /const stopStreaming = useCallback\(\(\) => \{[\s\S]{0,500}fetch\(['"]\/api\/chat\/interrupt['"][\s\S]{0,500}abortControllerRef\.current\?\.abort\(\)/,
      'the first-turn Stop action must explicitly interrupt the Runtime before detaching its local fetch',
    );
  });
});
