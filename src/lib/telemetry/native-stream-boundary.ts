import { markProviderFailureHandled } from './provider-marker';

export interface NativeStreamFailure {
  error: unknown;
}

function directCause(error: unknown): unknown {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'cause');
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Per-step terminal boundary for AI SDK stream errors.
 *
 * AI SDK error parts are not guaranteed to reject `response` or
 * `finishReason`: an in-band provider error can be followed by a normal
 * finish-step and leave every result promise resolved. Keep the structured
 * error until the step terminates, then let exactly one capture boundary feed
 * it to the shared root-cause normalizer.
 */
export class NativeStreamTelemetryState {
  private observed = false;
  private reported = false;
  private lastError: unknown;

  resetStep(): void {
    this.observed = false;
    this.reported = false;
    this.lastError = undefined;
  }

  observe(error: unknown): void {
    this.observed = true;
    this.lastError = error;
    // Own every observed provider failure immediately so framework-level
    // auto-capture cannot race the terminal classifier.
    markProviderFailureHandled(error);
  }

  get hasReportedFailure(): boolean {
    return this.reported;
  }

  takeTerminalFailure(): NativeStreamFailure | null {
    if (!this.observed || this.reported) return null;
    this.reported = true;
    return { error: this.lastError };
  }

  takeCatchFailure(caught: unknown): NativeStreamFailure | null {
    if (!this.observed) return { error: caught };
    if (!this.reported) {
      this.reported = true;
      return { error: this.lastError };
    }

    // A promise may still reject with the same error (or a one-hop wrapper)
    // after a finish-step capture. Suppress only that duplicate; an unrelated
    // product failure after the provider event remains diagnosable.
    if (caught === this.lastError || directCause(caught) === this.lastError) return null;
    return { error: caught };
  }
}
