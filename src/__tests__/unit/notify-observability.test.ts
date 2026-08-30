/**
 * #34 — Mac 定时任务到点执行但不弹系统通知。
 *
 * normal / urgent 通知只有 Electron Main 一个原生消费者，窗口可见性不再
 * 切换所有权。"无弹窗"仍可能是运行时条件——最可能 (a) dev Electron app 没拿到
 * macOS 通知权限（未签名 dev 二进制 → new Notification().show() 静默 no-op），或
 * (b) macOS 对 focused 应用抑制横幅（in-app toast 仍应出）。两者都需在运行的客户端
 * fire 一个任务 + 看日志才能确认。
 *
 * 本测试 source-pin 住"可观测性"：scheduler 不静默吞持久化失败，Electron Main
 * 记录 event_id 与最终 outcome，且明确检查 Notification.isSupported()。
 * 真实端到端验收（fire 任务 + 看 Notification Center / System Settings）见
 * preview-build-readiness Phase 3 / #34。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('#34 notification dispatch observability (source-pin)', () => {
  it('scheduler logs [notify] on enqueue success AND on failure (no more silent swallow)', () => {
    const src = read('src/lib/task-scheduler.ts');
    assert.match(src, /\[notify\] enqueued/);
    assert.match(src, /\[notify\] enqueue FAILED/);
  });

  it('the single Electron Main show path logs the durable event outcome', () => {
    const src = read('electron/main.ts');
    assert.match(src, /\[notify\] native delivery event_id=/);
    assert.match(src, /outcome=\$\{outcome\.status\}/);
    assert.match(src, /Notification\.isSupported\(\)/);
    assert.match(src, /process\.platform === 'darwin' && !app\.isPackaged/);
    assert.match(src, /NATIVE_NOTIFICATION_ERROR\.macosUnsignedDevelopment/);
    assert.doesNotMatch(src, /notification:show/);
  });
});
