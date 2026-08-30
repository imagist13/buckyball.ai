/**
 * Pure navigation policy for Electron's `will-navigate` — decides what to do
 * with a navigation target given the window's current URL.
 *
 * Lives in src/lib (no Electron imports) so it can be behavior-tested in the
 * node:test unit run AND reused from electron/main.ts (which already imports
 * other ../src/lib helpers).
 */

export type NavigationDecision = 'allow-in-app' | 'open-external' | 'block';

function isWeb(u: URL): boolean {
  return u.protocol === 'http:' || u.protocol === 'https:';
}

/**
 * - `allow-in-app`  same-origin http/https navigation (normal in-app routing)
 * - `open-external` a real web (http/https) link → hand to the OS browser
 * - `block`         everything else: malformed URL, or a non-web scheme
 *                   (data:/file:/javascript:/blob:/vscode:/…)
 *
 * Why the explicit http/https gate on BOTH sides for `allow-in-app`: opaque
 * origins (e.g. the `data:` startup splash — electron/main.ts LOADING_HTML)
 * serialize to the string `"null"`, so `data:` current + `data:` / `file:` /
 * `javascript:` target would compare equal under an origin-only check and be
 * treated as "same-origin", bypassing the external-link whitelist. Requiring
 * BOTH sides to be http/https closes that hole.
 *
 * (The real data:→http startup transition uses `loadURL`, which does NOT fire
 * `will-navigate`, so this stricter rule is not a regression.)
 */
export function classifyNavigation(currentUrl: string, targetUrl: string): NavigationDecision {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return 'block';
  }

  let current: URL | null = null;
  try {
    current = new URL(currentUrl);
  } catch {
    current = null;
  }

  if (current && isWeb(current) && isWeb(target) && current.origin === target.origin) {
    return 'allow-in-app';
  }
  if (isWeb(target)) return 'open-external';
  return 'block';
}
