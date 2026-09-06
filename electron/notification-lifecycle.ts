export interface NativeNotificationAdapter {
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  show(): void;
}

export type NativeNotificationOutcome =
  | { status: 'delivered' }
  | { status: 'error'; error: string; retryable: boolean };

/** Keep shown notifications alive until click/close without an unbounded set. */
export class NativeNotificationRetention<T extends object> {
  private readonly active = new Map<T, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly maxEntries = 50,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  retain(notification: T): void {
    this.release(notification);
    while (this.active.size >= Math.max(1, this.maxEntries)) {
      const oldest = this.active.keys().next().value as T | undefined;
      if (!oldest) break;
      this.release(oldest);
    }
    const timer = setTimeout(() => this.release(notification), this.ttlMs);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    this.active.set(notification, timer);
  }

  release(notification: T): void {
    const timer = this.active.get(notification);
    if (!timer) return;
    clearTimeout(timer);
    this.active.delete(notification);
  }

  clear(): void {
    for (const notification of [...this.active.keys()]) this.release(notification);
  }

  has(notification: T): boolean { return this.active.has(notification); }
  get size(): number { return this.active.size; }
}

export function buildNativeNotificationOptions(
  platform: NodeJS.Platform,
  title: string,
  body: string,
): { title: string; body: string; silent?: boolean; sound?: string } {
  if (platform === 'darwin') {
    return { title, body, silent: false, sound: 'default' };
  }
  // Windows/Linux use the OS/default notification sound policy. Do not pass a
  // macOS-only sound name and pretend it is portable.
  return { title, body };
}

export function deliverNativeNotification(args: {
  platform: NodeJS.Platform;
  supported: boolean;
  notification: NativeNotificationAdapter | null;
  unavailableReason?: string;
  timeoutMs?: number;
  onClick?: () => void;
}): Promise<NativeNotificationOutcome> {
  if (args.unavailableReason) {
    return Promise.resolve({
      status: 'error',
      error: args.unavailableReason,
      retryable: false,
    });
  }
  if (!args.supported || !args.notification) {
    return Promise.resolve({ status: 'error', error: 'native notifications are unsupported', retryable: false });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: NativeNotificationOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      finish({ status: 'error', error: 'native notification show timed out', retryable: true });
    }, args.timeoutMs ?? 12_000);

    args.notification!.once('show', () => finish({ status: 'delivered' }));
    if (args.platform === 'win32') {
      args.notification!.once('failed', (...parts: unknown[]) => {
        const detail = parts.find((part) => typeof part === 'string');
        finish({
          status: 'error',
          error: typeof detail === 'string' ? detail : 'native notification failed',
          retryable: true,
        });
      });
    }
    if (args.onClick) args.notification!.on('click', args.onClick);

    try {
      args.notification!.show();
    } catch (error) {
      finish({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        retryable: true,
      });
    }
  });
}
