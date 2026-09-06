/**
 * Process-wide Native turn ownership registry.
 *
 * Next dev can evaluate the chat route and interrupt route through different
 * HMR module instances. A module-local Map therefore makes Stop report that it
 * tried Native while the real controller remains invisible in another module
 * instance. Keep the registry on globalThis and make cleanup identity-gated so
 * a late teardown from an older turn cannot remove a newer turn's controller.
 */

const NATIVE_TURN_CONTROLLERS = Symbol.for('codepilot.native-turn-controllers.v1');

function getRegistry(): Map<string, AbortController> {
  const globals = globalThis as Record<PropertyKey, unknown>;
  if (!(globals[NATIVE_TURN_CONTROLLERS] instanceof Map)) {
    globals[NATIVE_TURN_CONTROLLERS] = new Map<string, AbortController>();
  }
  return globals[NATIVE_TURN_CONTROLLERS] as Map<string, AbortController>;
}

export function registerNativeTurnController(
  sessionId: string,
  controller: AbortController,
): void {
  getRegistry().set(sessionId, controller);
}

export function unregisterNativeTurnController(
  sessionId: string,
  controller: AbortController,
): boolean {
  const registry = getRegistry();
  if (registry.get(sessionId) !== controller) return false;
  registry.delete(sessionId);
  return true;
}

export function interruptNativeTurn(
  sessionId: string,
  reason: unknown = new Error('Parent turn stopped by the user.'),
): boolean {
  const registry = getRegistry();
  const controller = registry.get(sessionId);
  if (!controller) return false;
  if (!controller.signal.aborted) controller.abort(reason);
  if (registry.get(sessionId) === controller) registry.delete(sessionId);
  return true;
}

export function disposeNativeTurns(
  reason: unknown = new Error('Native Runtime disposed.'),
): void {
  const registry = getRegistry();
  for (const controller of registry.values()) {
    if (!controller.signal.aborted) controller.abort(reason);
  }
  registry.clear();
}
