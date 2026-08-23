import { getSetting, compareAndSetSettingIfBlank } from '@/lib/db';
import { initializeWorkspace } from '@/lib/assistant-workspace';

export const ASSISTANT_WORKSPACE_PATH_SETTING = 'assistant_workspace_path';

export interface DefaultAssistantBootstrapResult {
  selected: boolean;
  path: string;
  createdFiles: string[];
  existingPath?: string;
}

interface BootstrapDependencies {
  getSetting: typeof getSetting;
  compareAndSetSettingIfBlank: typeof compareAndSetSettingIfBlank;
  initializeWorkspace: typeof initializeWorkspace;
}

const DEFAULT_DEPS: BootstrapDependencies = {
  getSetting,
  compareAndSetSettingIfBlank,
  initializeWorkspace,
};

const IN_FLIGHT_KEY = '__codepilot_default_assistant_bootstrap__';

type BootstrapGlobals = typeof globalThis & {
  [IN_FLIGHT_KEY]?: Promise<DefaultAssistantBootstrapResult>;
};

/**
 * Initialize the default assistant once per server process, then select it
 * with a commit-time DB compare-and-set. A concurrent explicit Settings save
 * is never overwritten; at worst an unused, non-destructive starter folder is
 * left on disk.
 */
export function bootstrapDefaultAssistantWorkspace(
  defaultPath: string,
  deps: BootstrapDependencies = DEFAULT_DEPS,
): Promise<DefaultAssistantBootstrapResult> {
  const globals = globalThis as BootstrapGlobals;
  const active = globals[IN_FLIGHT_KEY];
  if (active) return active;

  const run = Promise.resolve().then(() => {
    const before = deps.getSetting(ASSISTANT_WORKSPACE_PATH_SETTING)?.trim();
    if (before) {
      return {
        selected: false,
        path: before,
        existingPath: before,
        createdFiles: [],
      };
    }

    const createdFiles = deps.initializeWorkspace(defaultPath);
    const selected = deps.compareAndSetSettingIfBlank(
      ASSISTANT_WORKSPACE_PATH_SETTING,
      defaultPath,
    );
    const committedPath = deps.getSetting(ASSISTANT_WORKSPACE_PATH_SETTING)?.trim();

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
