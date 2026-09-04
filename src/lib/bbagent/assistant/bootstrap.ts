/**
 * BB Assistant — Default Workspace Bootstrap
 *
 * Initializes the default bb-agent assistant workspace once per server process,
 * then selects it with a commit-time DB compare-and-set. Forked from
 * CodePilot's `lib/assistant-default-workspace.ts` and renamed to
 * `BbAssistant*` per
 * [docs/exec-plans/active/assistant-merge-into-bbagent.md](../../../../docs/exec-plans/active/assistant-merge-into-bbagent.md)
 * Phase M1.6.
 *
 * A concurrent explicit Settings save is never overwritten; at worst an unused,
 * non-destructive starter folder is left on disk.
 */

import { getSetting, compareAndSetSettingIfBlank } from '@/lib/db';
import { initializeBbAssistantWorkspace } from './workspace';

export const BB_ASSISTANT_WORKSPACE_PATH_SETTING = 'assistant_workspace_path';

export interface BbAssistantBootstrapResult {
  selected: boolean;
  path: string;
  createdFiles: string[];
  existingPath?: string;
}

interface BootstrapDependencies {
  getSetting: typeof getSetting;
  compareAndSetSettingIfBlank: typeof compareAndSetSettingIfBlank;
  initializeBbAssistantWorkspace: typeof initializeBbAssistantWorkspace;
}

const DEFAULT_DEPS: BootstrapDependencies = {
  getSetting,
  compareAndSetSettingIfBlank,
  initializeBbAssistantWorkspace,
};

const IN_FLIGHT_KEY = '__codepilot_default_bbassistant_bootstrap__';

type BootstrapGlobals = typeof globalThis & {
  [IN_FLIGHT_KEY]?: Promise<BbAssistantBootstrapResult>;
};

/**
 * Initialize the default bb agent assistant once per server process, then
 * select it with a commit-time DB compare-and-set. A concurrent explicit
 * Settings save is never overwritten; at worst an unused, non-destructive
 * starter folder is left on disk.
 */
export function bootstrapBbAssistantDefaultWorkspace(
  defaultPath: string,
  deps: BootstrapDependencies = DEFAULT_DEPS,
): Promise<BbAssistantBootstrapResult> {
  const globals = globalThis as BootstrapGlobals;
  const active = globals[IN_FLIGHT_KEY];
  if (active) return active;

  const run = Promise.resolve().then(() => {
    const before = deps.getSetting(BB_ASSISTANT_WORKSPACE_PATH_SETTING)?.trim();
    if (before) {
      return {
        selected: false,
        path: before,
        existingPath: before,
        createdFiles: [],
      };
    }

    const createdFiles = deps.initializeBbAssistantWorkspace(defaultPath);
    const selected = deps.compareAndSetSettingIfBlank(
      BB_ASSISTANT_WORKSPACE_PATH_SETTING,
      defaultPath,
    );
    const committedPath = deps.getSetting(BB_ASSISTANT_WORKSPACE_PATH_SETTING)?.trim();

    return {
      selected,
      path: selected ? defaultPath : (committedPath || defaultPath),
      existingPath: selected ? undefined : committedPath,
      createdFiles,
    };
  });

  globals[IN_FLIGHT_KEY] = run;
  const clear = () => {
    if (globals[IN_FLIGHT_KEY] === run) delete globals[IN_FLIGHT_KEY];
  };
  void run.then(clear, clear);
  return run;
}
