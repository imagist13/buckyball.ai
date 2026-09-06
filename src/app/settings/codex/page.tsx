/**
 * /settings/codex — transitional redirect.
 *
 * Phase 5 Phase 6 IA correction (2026-05-14). Codex used to have its
 * own top-level Settings tab here; that placement turned out to
 * conflate two distinct concerns:
 *
 *   - "Is Codex Runtime available / what's the default engine" → belongs
 *      under Settings → Runtime (now three-engine: claude_code,
 *      codepilot_runtime, codex_runtime).
 *   - "Codex Account login, plan, quota, models"               → belongs
 *      under Settings → Providers / Models as a virtual provider, same
 *      pattern as OpenAI OAuth.
 *
 * Keeping the URL routable but redirecting preserves bookmarks /
 * deep links that may exist from the brief window the standalone
 * page shipped. The `engine=codex` query is a deep-link hint
 * RuntimePanel can use to focus / scroll to the Codex Runtime card.
 */

import { redirect } from 'next/navigation';

export default function SettingsCodexRedirect() {
  redirect('/settings/runtime?engine=codex');
}
