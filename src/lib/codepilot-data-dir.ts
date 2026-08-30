import os from 'node:os';
import path from 'node:path';

/**
 * Single source of truth for every CodePilot-owned data path.
 *
 * The Electron recovery surface and the embedded Next utility must resolve
 * the same absolute directory. Otherwise a custom CLAUDE_GUI_DATA_DIR can
 * make recovery inspect or delete a different database from the one in use.
 */
export function resolveCodePilotDataDir(
  env: { CLAUDE_GUI_DATA_DIR?: string } = process.env as { CLAUDE_GUI_DATA_DIR?: string },
  homeDirectory: string = os.homedir(),
): string {
  const configured = env.CLAUDE_GUI_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(homeDirectory, '.codepilot');
}
