/**
 * BB Assistant — Path Resolution
 *
 * Centralized path resolution for BB Agent assistant workspace. Phase M1.1
 * of [assistant-merge-into-bbagent.md](../../../../../docs/exec-plans/active/assistant-merge-into-bbagent.md):
 * single entry point so we can later migrate to `~/.buckyball/`-prefixed paths
 * (Phase 6 of bbdev-skill-integration) without grepping every consumer.
 *
 * Today: thin shim over the legacy setting key `assistant_workspace_path`.
 * Future: will switch to `bb_agent_assistant_workspace_path` and provide a
 * one-time migration.
 */

import path from 'path';
import { getSetting } from '@/lib/db';
import { BB_ASSISTANT_WORKSPACE_PATH_SETTING } from './bootstrap';

/**
 * Read the configured BB Agent assistant workspace path. Returns the raw value
 * (no path.resolve, no existence check) so callers can distinguish "no
 * workspace selected" (null) from "selected but missing" (non-null).
 *
 * Callers that need an absolute path should pass the result through
 * `path.resolve()` themselves; callers that need existence validation should
 * pair this with `fs.statSync()` and surface their own error.
 */
export function resolveAssistantWorkspacePath(): string | null {
  const raw = getSetting(BB_ASSISTANT_WORKSPACE_PATH_SETTING)?.trim();
  return raw ? raw : null;
}

/**
 * Resolve and absolutize the configured BB Agent assistant workspace path.
 * Returns null when no workspace is selected.
 */
export function resolveAbsoluteAssistantWorkspacePath(): string | null {
  const raw = resolveAssistantWorkspacePath();
  if (!raw) return null;
  return path.resolve(raw);
}
