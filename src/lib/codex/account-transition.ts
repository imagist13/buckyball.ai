/**
 * Codex account transitions that must drop cached capability.
 *
 * `src/lib/codex/models.ts` keeps an in-memory model/list cache, and the
 * `cacheOnly` read path ignores TTL on purpose (P0.3 spawn decoupling) — a warm
 * cache is served forever until something invalidates it. That makes every
 * account transition a correctness event, not just a freshness one: after a
 * logout or an account switch, the full catalog and the `turn/start` effort
 * allowlist would otherwise keep answering with the PREVIOUS account's
 * capability, which breaks the logged-out fail-closed contract.
 *
 * The account routes (`/api/codex/account` DELETE, `/api/codex/login` POST)
 * call these wrappers instead of the raw `account.ts` helpers so the
 * invalidation can never be forgotten at a call site.
 *
 * The `perform` parameter is a DI seam: it defaults to the real JSON-RPC call,
 * and exists so tests can drive the transition (and assert that the REAL cache
 * really cleared) without spawning a Codex app-server.
 */

import { logoutCodex, startCodexLogin, type CodexLoginStart } from './account';
import { invalidateCodexModelsCache } from './models';

/** Log out, then drop the logged-out account's cached capability. */
export async function logoutCodexAndInvalidateModels(
  perform: () => Promise<void> = logoutCodex,
): Promise<void> {
  await perform();
  invalidateCodexModelsCache();
}

/**
 * Start a login, then drop any cache left over from the previous account.
 *
 * Invalidating at login START (not completion) is the conservative side: the
 * cost is one refetch, while keeping the old entry risks showing the previous
 * account's models to the new one.
 */
export async function startCodexLoginAndInvalidateModels(
  options: Parameters<typeof startCodexLogin>[0],
  perform: typeof startCodexLogin = startCodexLogin,
): Promise<CodexLoginStart> {
  const result = await perform(options);
  invalidateCodexModelsCache();
  return result;
}
