/**
 * 稳定性审计 ⑤ — seedSnapshotPatch 占位 stream 必须 scheduleGC。
 *
 * seedSnapshotPatch 直接以终态 phase='completed' 注册占位 stream，从不经过会
 * 触发 GC 的正常流生命周期。修复前它永远留在模块级 map 里泄漏；修复 = 注册后
 * scheduleGC，GC 窗口后回收（占位为非 active，回收成立）。
 *
 * 行为钉（对照泄漏前）：seed 后快照可读；推进 GC 窗口后快照被回收（返回 null）。
 * 修复前推进同样时长快照仍在 → 该断言只在修复后为真。
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { seedSnapshotPatch, getSnapshot } from '@/lib/stream-session-manager';

const GC_DELAY_MS = 5 * 60 * 1000; // 与 stream-session-manager 内常量一致

describe('seedSnapshotPatch scheduleGC（⑤行为钉）', () => {
  it('占位快照在 GC 窗口后被回收，不再永久泄漏', () => {
    mock.timers.enable({ apis: ['setTimeout'] }); // 只 mock setTimeout，保留真实 Date.now
    try {
      const sid = 'seed-gc-test-session-⑤';
      seedSnapshotPatch(sid, { error: 'boom' });

      // 立即可读（startedAt 为真实非零，非 stale-placeholder）。
      const before = getSnapshot(sid);
      assert.ok(before, 'seed 后快照必须可读');
      assert.equal(before?.error, 'boom', 'patch 已合入');

      // 推进 GC 窗口 → 占位（非 active）被回收。
      mock.timers.tick(GC_DELAY_MS + 1);
      assert.equal(getSnapshot(sid), null, 'GC 窗口后占位快照必须被回收（否则泄漏）');
    } finally {
      mock.timers.reset();
    }
  });

  it('GC 窗口未到时快照仍在（GC 不会提前误删）', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const sid = 'seed-gc-test-session-early';
      seedSnapshotPatch(sid, { error: 'boom' });
      mock.timers.tick(GC_DELAY_MS - 1000);
      assert.ok(getSnapshot(sid), 'GC 窗口未到，快照应仍可读');
      mock.timers.tick(2000);
      assert.equal(getSnapshot(sid), null, '越过窗口后回收');
    } finally {
      mock.timers.reset();
    }
  });
});
