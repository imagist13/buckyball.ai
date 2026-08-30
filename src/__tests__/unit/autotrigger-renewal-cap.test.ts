/**
 * Session lock renewal — autoTrigger 续租上限 + renew-false 停租。
 *
 * 背景：POST /api/chat 每 60s 续租一次 session 锁。两类失控必须收口：
 *   - I3（仅 autoTrigger 背景/心跳回合）：若回合迟迟不发终态，会永远续租、打败 TTL，
 *     session 永远无法被回收。前台回合有 Stop/abort watchdog 兜底，背景回合没有——
 *     所以背景回合必须在 AUTO_TRIGGER_MAX_RENEWALS(=30, ≈30min) 次后强制 settle。
 *   - DP3（两类回合）：renewSessionLock 返回 false 表示 lockId 已不 own 该行（被接管 /
 *     已释放），继续空转 interval 无意义且有 race —— 立即停租。
 *
 * 决策抽成纯函数 evaluateRenewal(session-lock-renewal.ts)，route.ts 的 interval 只做
 * 映射（renew → 决策 → clearInterval / settleLock）。本测试三层：
 *   1) 纯函数真值表（真实输入驱动，count=29→continue / count=30→settle-cap /
 *      renewed=false→stop-renew-false / 非 autoTrigger+count=100→continue）。
 *   2) mock timer 真实驱动一个真 setInterval，回调镜像 route 的映射并调用真 evaluateRenewal，
 *      断言 30 次后 settle('interrupted') 且续租停止；renew-false 后不再调 renew；
 *      非 autoTrigger 无 cap。
 *   3) route.ts 接线源码钉（route.ts 因 Electron ABI 无法单测导入，参照
 *      chat-watchdog-cleanup.test.ts 的既有模式钉住 wiring，作为纯函数测试的补充而非唯一）。
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateRenewal, type RenewalDecision } from '../../lib/session-lock-renewal';

const MAX = 30;

describe('evaluateRenewal 纯函数真值表（真实输入驱动）', () => {
  it('autoTrigger + count=29 + renewed → continue（上限内）', () => {
    assert.equal(
      evaluateRenewal({ autoTrigger: true, renewalCount: 29, renewed: true, max: MAX }),
      'continue',
    );
  });

  it('autoTrigger + count=30 + renewed → settle-cap（达上限 I3）', () => {
    assert.equal(
      evaluateRenewal({ autoTrigger: true, renewalCount: 30, renewed: true, max: MAX }),
      'settle-cap',
    );
  });

  it('autoTrigger + count=31 + renewed → settle-cap（超上限仍 settle）', () => {
    assert.equal(
      evaluateRenewal({ autoTrigger: true, renewalCount: 31, renewed: true, max: MAX }),
      'settle-cap',
    );
  });

  it('renewed=false → stop-renew-false（DP3，autoTrigger 回合）', () => {
    assert.equal(
      evaluateRenewal({ autoTrigger: true, renewalCount: 5, renewed: false, max: MAX }),
      'stop-renew-false',
    );
  });

  it('renewed=false → stop-renew-false（DP3，非 autoTrigger 回合也停）', () => {
    assert.equal(
      evaluateRenewal({ autoTrigger: false, renewalCount: 999, renewed: false, max: MAX }),
      'stop-renew-false',
    );
  });

  it('renew-false 优先于 cap：autoTrigger + count 已超上限 + renewed=false → stop-renew-false', () => {
    // 已不 own 锁时无需 settle（settle 会试图释放我们并不持有的锁），直接停即可。
    assert.equal(
      evaluateRenewal({ autoTrigger: true, renewalCount: 100, renewed: false, max: MAX }),
      'stop-renew-false',
    );
  });

  it('非 autoTrigger + count=100 + renewed → continue（无 cap，靠 watchdog 兜底）', () => {
    assert.equal(
      evaluateRenewal({ autoTrigger: false, renewalCount: 100, renewed: true, max: MAX }),
      'continue',
    );
  });
});

/**
 * mock timer 真实驱动：构造一个真 setInterval，回调镜像 route.ts:790 的映射
 * （renew → evaluateRenewal → clearInterval / settle）。决策用真 evaluateRenewal，
 * renew / settle 用 mock。断言 runaway 真的被收口，而非只看常量。
 */
function makeRenewalTick(deps: {
  autoTrigger: boolean;
  max: number;
  state: { renewalCount: number };
  renew: () => boolean;
  settle: (status: string) => void;
  clear: () => void;
}): () => void {
  // 镜像 route.ts lockRenewalInterval 回调：只做决策→副作用映射，决策本身是共享真码。
  return () => {
    let renewed: boolean;
    try {
      renewed = deps.renew();
    } catch {
      return; // 瞬时错误：best effort，保活 interval（不把 throw 当 renew-false）
    }
    if (deps.autoTrigger && renewed) deps.state.renewalCount++;
    const decision: RenewalDecision = evaluateRenewal({
      autoTrigger: deps.autoTrigger,
      renewalCount: deps.state.renewalCount,
      renewed,
      max: deps.max,
    });
    if (decision === 'stop-renew-false') {
      deps.clear();
      return;
    }
    if (decision === 'settle-cap') {
      deps.settle('interrupted'); // route 中 settleLock 的 clearRenewal 会 clearInterval
      return;
    }
  };
}

describe('续租 interval 真实驱动（node:test mock timer）', () => {
  it('autoTrigger：正好 30 次续租后 settle(interrupted) 并停止续租（c-cap-test）', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    let active = true;
    const state = { renewalCount: 0 };
    const renew = mock.fn(() => true); // 始终成功续租 → 只有 cap 能停它
    const settle = mock.fn((_status: string) => { active = false; }); // mirrors settleLock.clearRenewal
    const renewalTick = makeRenewalTick({
      autoTrigger: true, max: MAX, state, renew, settle,
      clear: () => { active = false; },
    });
    const tick = () => { if (active) renewalTick(); };
    setInterval(tick, 60_000);

    // 推进 50 分钟（远超 30 次上限），验证到 30 次即封顶、之后不再空转。
    t.mock.timers.tick(60_000 * 50);

    assert.equal(state.renewalCount, 30, '计数应停在 30');
    assert.equal(renew.mock.callCount(), 30, 'renew 只应被调用 30 次，之后停止（未无限续租）');
    assert.equal(settle.mock.callCount(), 1, 'settle 恰好一次');
    assert.deepEqual(settle.mock.calls[0].arguments, ['interrupted'], "settle 状态应为 'interrupted'");
  });

  it('renew 返回 false → 立即停止续租，不再调用 renewSessionLock（c-renew-false-stops-test）', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    let active = true;
    const state = { renewalCount: 0 };
    let n = 0;
    const renew = mock.fn(() => { n++; return n < 3; }); // 第 1、2 次 true，第 3 次 false
    const settle = mock.fn((_status: string) => { active = false; });
    const renewalTick = makeRenewalTick({
      autoTrigger: true, max: MAX, state, renew, settle,
      clear: () => { active = false; },
    });
    const tick = () => { if (active) renewalTick(); };
    setInterval(tick, 60_000);

    t.mock.timers.tick(60_000 * 20); // 推进远超第 3 次

    assert.equal(renew.mock.callCount(), 3, 'renew 在返回 false 后不应再被调用（停租，不空转）');
    assert.equal(settle.mock.callCount(), 0, 'renew-false 是停租不是 settle（未 own 锁无需 settle）');
    assert.equal(state.renewalCount, 2, '第 3 次 false 不计入 cap 计数');
  });

  it('非 autoTrigger：100 次 tick 均续租，无 cap（c-non-autotrigger-unchanged）', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const state = { renewalCount: 0 };
    const renew = mock.fn(() => true);
    const settle = mock.fn((_status: string) => { clearInterval(handle); });
    const tick = makeRenewalTick({
      autoTrigger: false, max: MAX, state, renew, settle,
      clear: () => clearInterval(handle),
    });
    const handle = setInterval(tick, 60_000);

    t.mock.timers.tick(60_000 * 100);

    assert.equal(renew.mock.callCount(), 100, '非 autoTrigger 无 cap，续租应持续（仍靠 abort watchdog 兜底）');
    assert.equal(settle.mock.callCount(), 0, '非 autoTrigger 不因 cap 触发 settle');
    assert.equal(state.renewalCount, 0, '非 autoTrigger 不推进 cap 计数');
  });

  it('瞬时 renew throw 不停租（best effort，保活 interval）', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const state = { renewalCount: 0 };
    let n = 0;
    const renew = mock.fn(() => { n++; if (n === 2) throw new Error('transient'); return true; });
    const settle = mock.fn((_status: string) => { clearInterval(handle); });
    const tick = makeRenewalTick({
      autoTrigger: true, max: MAX, state, renew, settle,
      clear: () => clearInterval(handle),
    });
    const handle = setInterval(tick, 60_000);

    t.mock.timers.tick(60_000 * 5);

    // 第 2 次 throw 被吞、不停租；后续继续续租。cap 计数只在成功 renew 时推进（5 次中 1 次 throw → 4）。
    assert.equal(renew.mock.callCount(), 5, 'throw 后 interval 应保活，继续续租');
    assert.equal(settle.mock.callCount(), 0, '未达 cap 不 settle');
    assert.equal(state.renewalCount, 4, 'throw 的那次不计入 cap 计数');
  });
});

/**
 * route.ts 接线源码钉（补充，非唯一）——route.ts 因 Electron ABI 无法单测导入，
 * 参照 chat-watchdog-cleanup.test.ts 钉住 wiring：常量值、决策映射、终态释放。
 */
const ROUTE_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../app/api/chat/route.ts'),
  'utf-8',
);

describe('route.ts 续租上限接线（源码钉，补充）', () => {
  it('定义 AUTO_TRIGGER_MAX_RENEWALS = 30（c-renewal-cap-30）', () => {
    assert.ok(
      /const AUTO_TRIGGER_MAX_RENEWALS = 30;/.test(ROUTE_SRC),
      'route.ts 必须定义 AUTO_TRIGGER_MAX_RENEWALS = 30',
    );
  });

  it('interval 委托 evaluateRenewal 决策', () => {
    assert.ok(ROUTE_SRC.includes("import { evaluateRenewal } from '@/lib/session-lock-renewal'"),
      'route.ts 必须从 session-lock-renewal 导入 evaluateRenewal');
    assert.ok(/evaluateRenewal\(\{/.test(ROUTE_SRC), 'interval 回调必须调用 evaluateRenewal');
    assert.ok(/max: AUTO_TRIGGER_MAX_RENEWALS/.test(ROUTE_SRC), 'evaluateRenewal 的 max 必须传 AUTO_TRIGGER_MAX_RENEWALS');
  });

  it('stop-renew-false → clearInterval 停租（DP3，c-renew-false-stops）', () => {
    const idx = ROUTE_SRC.indexOf("=== 'stop-renew-false'");
    assert.ok(idx > -1, 'route 必须处理 stop-renew-false 决策');
    const block = ROUTE_SRC.slice(idx, idx + 300);
    assert.ok(/clearInterval\(lockRenewalInterval\)/.test(block), 'stop-renew-false 分支必须 clearInterval 停租');
  });

  it('settle-cap → settleLock(interrupted)（I3，c-renewal-cap-30）', () => {
    const idx = ROUTE_SRC.indexOf("=== 'settle-cap'");
    assert.ok(idx > -1, 'route 必须处理 settle-cap 决策');
    const block = ROUTE_SRC.slice(idx, idx + 300);
    assert.ok(/settleLock\('interrupted'\)/.test(block), 'settle-cap 分支必须 settleLock(interrupted)');
  });
});
