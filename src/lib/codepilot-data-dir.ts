import os from 'node:os';
import path from 'node:path';
import { resolveBuckyballDataDir } from './bbagent/paths';

/**
 * Legacy thin shell for `resolveCodePilotDataDir`.
 *
 * New code should call `resolveBuckyballDataDir` from `lib/bbagent/paths.ts`
 * directly. This wrapper preserves the existing `CLAUDE_GUI_DATA_DIR` and
 * default `~/.codepilot` paths so existing installs keep their data.
 *
 * Behavior (Phase 6A — backward compatible):
 *   - BUCKYBALL_DATA_DIR env (new) > CLAUDE_GUI_DATA_DIR env (legacy) > ~/.codepilot
 *
 * Note: default is still `~/.codepilot` because Phase 6A is dual-write
 * compatibility mode. Phase 6B will switch the default to `~/.buckyball`
 * after the migration script ships — see `docs/exec-plans/active/bbdev-skill-integration.md`
 * Phase 6.5.
 */
export function resolveCodePilotDataDir(
  env: {
    CLAUDE_GUI_DATA_DIR?: string;
    BUCKYBALL_DATA_DIR?: string;
  } = process.env as { CLAUDE_GUI_DATA_DIR?: string; BUCKYBALL_DATA_DIR?: string },
  homeDirectory: string = os.homedir(),
): string {
  return resolveBuckyballDataDir(env, homeDirectory);
}
