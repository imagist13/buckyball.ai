const PROVIDER_TELEMETRY_HANDLED = Symbol.for('codepilot.telemetry.provider-handled');
const PROVIDER_TELEMETRY_HANDLED_SET = Symbol.for('codepilot.telemetry.provider-handled-set');

const markerGlobal = globalThis as unknown as Record<PropertyKey, unknown>;
const existingHandledFailures = markerGlobal[PROVIDER_TELEMETRY_HANDLED_SET];
const handledFailures = existingHandledFailures instanceof WeakSet
  ? existingHandledFailures as WeakSet<object>
  : new WeakSet<object>();
markerGlobal[PROVIDER_TELEMETRY_HANDLED_SET] = handledFailures;

type MarkedFailure = { [PROVIDER_TELEMETRY_HANDLED]?: true };

/** Ensure even primitive SDK throws can be marked before a shared rethrow. */
export function toMarkableProviderFailure(error: unknown): object {
  if (error && (typeof error === 'object' || typeof error === 'function')) return error;
  const wrapped = new Error(typeof error === 'string' ? error : 'Non-Error provider failure');
  Object.defineProperty(wrapped, 'cause', {
    value: error,
    enumerable: false,
    configurable: false,
  });
  return wrapped;
}

export function markProviderFailureHandled(error: unknown): void {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return;
  handledFailures.add(error);
  try {
    if ((error as MarkedFailure)[PROVIDER_TELEMETRY_HANDLED]) return;
    Object.defineProperty(error, PROVIDER_TELEMETRY_HANDLED, {
      value: true,
      enumerable: false,
      configurable: false,
    });
  } catch {
    // Frozen SDK errors and hostile proxies still remain covered by the
    // process-local WeakSet. Telemetry must never alter the product failure.
  }
}

export function isProviderFailureHandled(error: unknown): boolean {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return false;
  if (handledFailures.has(error)) return true;
  try {
    return Boolean((error as MarkedFailure)[PROVIDER_TELEMETRY_HANDLED]);
  } catch {
    return false;
  }
}
