export interface NotificationClickAction {
  taskId?: string;
  sessionId?: string;
  event_id?: string;
  route?: string;
}

/** Convert a persisted notification action into a safe in-app route. */
export function resolveNotificationActionRoute(
  type: string | null | undefined,
  payload: string | null | undefined,
): string | undefined {
  if (type !== 'route' || !payload || payload.length > 2_048) return undefined;
  if (!payload.startsWith('/') || payload.startsWith('//') || payload.includes('\\')) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(payload)) return undefined;
  try {
    const parsed = new URL(payload, 'http://codepilot.local');
    if (parsed.origin !== 'http://codepilot.local') return undefined;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return undefined;
  }
}

export class NotificationClickQueue {
  private ready = false;
  private readonly pending: NotificationClickAction[] = [];
  private readonly seen = new Set<string>();

  constructor(
    private readonly send: (action: NotificationClickAction) => void,
    private readonly maxPending = 50,
  ) {}

  setReady(ready: boolean): void {
    this.ready = ready;
    if (!ready) return;
    while (this.pending.length > 0) this.send(this.pending.shift()!);
  }

  push(action: NotificationClickAction): void {
    const key = action.event_id || `${action.taskId || ''}:${action.sessionId || ''}:${action.route || ''}`;
    if (key && this.seen.has(key)) return;
    if (key) this.seen.add(key);
    if (this.seen.size > 200) {
      const oldest = this.seen.values().next().value as string | undefined;
      if (oldest) this.seen.delete(oldest);
    }
    if (this.ready) {
      this.send(action);
      return;
    }
    this.pending.push(action);
    while (this.pending.length > this.maxPending) this.pending.shift();
  }
}
