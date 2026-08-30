export const SERVER_RESTART_BACKOFF_MS = [1_000, 2_000, 4_000] as const;
export const SERVER_RESTART_WINDOW_MS = 10 * 60_000;
export const SERVER_HEALTHY_RESET_MS = 60_000;

export type ServerSupervisorState =
  | 'stopped'
  | 'starting'
  | 'healthy'
  | 'backoff'
  | 'recovering'
  | 'failed';

export interface ServerRestartDecision {
  allowed: boolean;
  attempt: number;
  delayMs: number | null;
  reason: 'restart_scheduled' | 'restart_budget_exhausted';
}

/**
 * Main-owned restart budget for the packaged Next utility process.
 *
 * An unexpected exit enters recovery safe mode. At most three recovery
 * attempts are admitted inside a rolling ten-minute window. A server that
 * remains healthy for sixty seconds earns a fresh budget. The class contains
 * no timers or Electron dependencies so boundary behavior stays deterministic
 * under unit tests; Main owns the actual waits and process lifecycle.
 */
export class ServerRecoverySupervisor {
  private crashTimes: number[] = [];
  private healthySince: number | null = null;
  private currentState: ServerSupervisorState = 'stopped';
  private recoverySafeMode = false;

  get state(): ServerSupervisorState {
    return this.currentState;
  }

  get safeMode(): boolean {
    return this.recoverySafeMode;
  }

  markStarting(): void {
    this.currentState = 'starting';
    this.healthySince = null;
  }

  markRecovering(): void {
    this.currentState = 'recovering';
    this.healthySince = null;
  }

  markHealthy(now = Date.now()): void {
    this.currentState = 'healthy';
    this.healthySince = now;
  }

  markStopped(): void {
    this.currentState = 'stopped';
    this.healthySince = null;
  }

  markFailed(): void {
    this.currentState = 'failed';
    this.healthySince = null;
  }

  /** A visible user gesture may open a fresh bounded retry window in safe mode. */
  resetRestartBudgetForManualRetry(): void {
    this.crashTimes = [];
    this.healthySince = null;
    this.currentState = 'stopped';
  }

  recordUnexpectedExit(now = Date.now()): ServerRestartDecision {
    if (this.healthySince !== null && now - this.healthySince >= SERVER_HEALTHY_RESET_MS) {
      this.crashTimes = [];
    }
    this.healthySince = null;
    this.recoverySafeMode = true;
    this.crashTimes = this.crashTimes.filter(
      (timestamp) => now - timestamp < SERVER_RESTART_WINDOW_MS,
    );
    this.crashTimes.push(now);

    const attempt = this.crashTimes.length;
    const delayMs = SERVER_RESTART_BACKOFF_MS[attempt - 1] ?? null;
    if (delayMs === null) {
      this.currentState = 'failed';
      return {
        allowed: false,
        attempt,
        delayMs: null,
        reason: 'restart_budget_exhausted',
      };
    }

    this.currentState = 'backoff';
    return {
      allowed: true,
      attempt,
      delayMs,
      reason: 'restart_scheduled',
    };
  }
}
