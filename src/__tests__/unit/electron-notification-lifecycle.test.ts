import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNativeNotificationOptions,
  deliverNativeNotification,
  NativeNotificationRetention,
  type NativeNotificationAdapter,
} from '../../../electron/notification-lifecycle';
import {
  NotificationClickQueue,
  resolveNotificationActionRoute,
} from '../../../electron/notification-click-queue';

class FakeNotification implements NativeNotificationAdapter {
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  constructor(private readonly onShow: (self: FakeNotification) => void = (self) => self.emit('show')) {}
  once(event: string, listener: (...args: unknown[]) => void): void { this.on(event, listener); }
  on(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) || []), listener]);
  }
  show(): void { this.onShow(this); }
  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) || []) listener(...args);
  }
}

describe('Electron native notification lifecycle', () => {
  it('waits for show before reporting delivered', async () => {
    assert.deepEqual(
      await deliverNativeNotification({
        platform: 'darwin',
        supported: true,
        notification: new FakeNotification(),
      }),
      { status: 'delivered' },
    );
  });

  it('reports unsupported, throw, timeout and Windows failed distinctly', async () => {
    assert.deepEqual(
      await deliverNativeNotification({
        platform: 'darwin',
        supported: true,
        notification: null,
        unavailableReason: 'native_notification_macos_unsigned_development',
      }),
      {
        status: 'error',
        error: 'native_notification_macos_unsigned_development',
        retryable: false,
      },
    );
    assert.deepEqual(
      await deliverNativeNotification({ platform: 'linux', supported: false, notification: null }),
      { status: 'error', error: 'native notifications are unsupported', retryable: false },
    );
    const throwing = new FakeNotification(() => { throw new Error('show exploded'); });
    assert.deepEqual(
      await deliverNativeNotification({ platform: 'darwin', supported: true, notification: throwing }),
      { status: 'error', error: 'show exploded', retryable: true },
    );
    const hanging = new FakeNotification(() => {});
    assert.deepEqual(
      await deliverNativeNotification({ platform: 'linux', supported: true, notification: hanging, timeoutMs: 5 }),
      { status: 'error', error: 'native notification show timed out', retryable: true },
    );
    const failed = new FakeNotification((self) => self.emit('failed', 'toast rejected'));
    assert.deepEqual(
      await deliverNativeNotification({ platform: 'win32', supported: true, notification: failed }),
      { status: 'error', error: 'toast rejected', retryable: true },
    );
  });

  it('uses explicit default sound on macOS and platform defaults elsewhere', () => {
    assert.deepEqual(buildNativeNotificationOptions('darwin', 'Title', 'Body'), {
      title: 'Title', body: 'Body', silent: false, sound: 'default',
    });
    assert.deepEqual(buildNativeNotificationOptions('win32', 'Title', 'Body'), { title: 'Title', body: 'Body' });
    assert.deepEqual(buildNativeNotificationOptions('linux', 'Title', 'Body'), { title: 'Title', body: 'Body' });
  });

  it('retains shown notifications for click delivery with a bounded lifetime set', () => {
    const first = {};
    const second = {};
    const third = {};
    const retention = new NativeNotificationRetention<object>(2, 60_000);
    retention.retain(first);
    retention.retain(second);
    retention.retain(third);
    assert.equal(retention.has(first), false);
    assert.equal(retention.has(second), true);
    assert.equal(retention.has(third), true);
    assert.equal(retention.size, 2);
    retention.release(second);
    assert.equal(retention.size, 1);
    retention.clear();
    assert.equal(retention.size, 0);
  });
});

describe('notification click startup queue', () => {
  it('accepts only bounded same-app routes from persisted actions', () => {
    assert.equal(
      resolveNotificationActionRoute('route', '/settings/assistant?notificationTest=1'),
      '/settings/assistant?notificationTest=1',
    );
    for (const payload of ['https://evil.example', '//evil.example', '/\\evil', '/ok\nnext']) {
      assert.equal(resolveNotificationActionRoute('route', payload), undefined);
    }
    assert.equal(resolveNotificationActionRoute('open_external', '/settings/assistant'), undefined);
  });

  it('buffers until ready, flushes in order and deduplicates event ids', () => {
    const delivered: string[] = [];
    const queue = new NotificationClickQueue((action) => delivered.push(action.event_id || ''), 2);
    queue.push({ event_id: 'one' });
    queue.push({ event_id: 'two' });
    queue.push({ event_id: 'three' });
    queue.push({ event_id: 'two' });
    assert.deepEqual(delivered, []);
    queue.setReady(true);
    assert.deepEqual(delivered, ['two', 'three']);
    queue.push({ event_id: 'four' });
    assert.deepEqual(delivered, ['two', 'three', 'four']);
  });

  it('buffers again after a renderer navigation', () => {
    const delivered: string[] = [];
    const queue = new NotificationClickQueue((action) => delivered.push(action.event_id || ''));
    queue.setReady(true);
    queue.push({ event_id: 'before-navigation' });
    queue.setReady(false);
    queue.push({ event_id: 'during-navigation' });
    assert.deepEqual(delivered, ['before-navigation']);
    queue.setReady(true);
    assert.deepEqual(delivered, ['before-navigation', 'during-navigation']);
  });
});
