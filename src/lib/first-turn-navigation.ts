/**
 * First-turn navigation guard (Phase 2 ③).
 *
 * The new-chat page (`app/chat/page.tsx`) hand-drives the first turn's SSE
 * stream inline and, on completion, `router.push('/chat/<newSessionId>')` to
 * hand off to the real session view. That push used to be UNCONDITIONAL: if the
 * user switched to a different session (or any other route) while the first
 * turn was still streaming, the async completion would fire `router.push` and
 * yank them back to the just-created session — a navigation hijack.
 *
 * This guard is the tiny piece of that flow worth testing in isolation: a
 * push is allowed only while the page is still mounted. `app/chat/page.tsx`
 * calls `deactivate()` from its unmount cleanup (and aborts the in-flight send
 * controller there too), so any push the completion path attempts afterwards is
 * suppressed and the user stays wherever they navigated.
 */
export interface FirstTurnNavGuard {
  /** True while the page is mounted; false after `deactivate()`. */
  readonly active: boolean;
  /**
   * Run `push` iff the guard is still active. Returns whether it actually ran,
   * so callers can branch/log. When inactive it is a no-op — the completion's
   * navigation is dropped so the user isn't dragged back.
   */
  navigate(push: () => void): boolean;
  /** Suppress all further navigation (call from the unmount cleanup). */
  deactivate(): void;
  /**
   * Re-arm the guard (call from the mount effect). Needed for React
   * StrictMode, whose dev-only mount → unmount → remount cycle fires the
   * cleanup (deactivate) once; without re-arming on the remount the guard
   * would stay dead and suppress the real first-turn navigation.
   */
  reactivate(): void;
}

export function createFirstTurnNavGuard(): FirstTurnNavGuard {
  let active = true;
  return {
    get active() {
      return active;
    },
    navigate(push: () => void): boolean {
      if (!active) return false;
      push();
      return true;
    },
    deactivate(): void {
      active = false;
    },
    reactivate(): void {
      active = true;
    },
  };
}
