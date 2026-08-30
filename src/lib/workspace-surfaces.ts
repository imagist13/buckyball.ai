import type { DynamicTab } from '@/lib/workspace-sidebar';

export type SurfaceKind =
  | 'files'
  | 'git'
  | 'widget'
  | 'browser'
  | 'agents'
  | 'diff'
  | 'artifact'
  | 'file-preview';

export type PrimarySurfaceKind = 'files' | 'git' | 'widget' | 'browser' | 'agents';

export interface SurfaceDescriptor {
  kind: SurfaceKind;
  titleKey: string;
  icon: 'files' | 'git' | 'chart' | 'browser' | 'agents' | 'diff' | 'artifact';
  pinnable: boolean;
  availabilitySource: string;
}

export const SURFACE_REGISTRY: Readonly<Record<SurfaceKind, SurfaceDescriptor>> = {
  files: { kind: 'files', titleKey: 'workspaceSidebar.tab.files', icon: 'files', pinnable: true, availabilitySource: 'workspace-directory' },
  git: { kind: 'git', titleKey: 'workspaceSidebar.tab.git', icon: 'git', pinnable: true, availabilitySource: 'git-status' },
  widget: { kind: 'widget', titleKey: 'workspaceSidebar.tab.widget', icon: 'chart', pinnable: true, availabilitySource: 'dashboard-module' },
  browser: { kind: 'browser', titleKey: 'workspaceSidebar.tab.browser', icon: 'browser', pinnable: true, availabilitySource: 'electron-browser-bridge' },
  agents: { kind: 'agents', titleKey: 'workspaceSidebar.tab.agents', icon: 'agents', pinnable: true, availabilitySource: 'durable-agent-runs' },
  diff: { kind: 'diff', titleKey: 'workspaceSidebar.tab.diff', icon: 'diff', pinnable: false, availabilitySource: 'thread-diff' },
  artifact: { kind: 'artifact', titleKey: 'workspaceSidebar.tab.artifact', icon: 'artifact', pinnable: false, availabilitySource: 'thread-preview-source' },
  'file-preview': { kind: 'file-preview', titleKey: 'workspaceSidebar.tab.filePreview', icon: 'artifact', pinnable: false, availabilitySource: 'thread-preview-source' },
};

export const PRIMARY_SURFACES: readonly PrimarySurfaceKind[] = [
  'files',
  'git',
  'widget',
  'browser',
  'agents',
];

export interface WorkspaceSurfacePreferencesV1 {
  version: 1;
  workspaceId: string;
  pinnedKinds: PrimarySurfaceKind[];
  order: PrimarySurfaceKind[];
  defaultActiveKind?: PrimarySurfaceKind;
  open: boolean;
  width: number;
}

export interface ThreadSurfaceStateV1 {
  version: 1;
  sessionId: string;
  activePrimary?: PrimarySurfaceKind;
  inspectorTabs: DynamicTab[];
  activeInspectorId?: string;
}

const MIN_WIDTH = 320;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 480;

function isPrimaryKind(value: unknown): value is PrimarySurfaceKind {
  return typeof value === 'string' && (PRIMARY_SURFACES as readonly string[]).includes(value);
}

function uniquePrimaryKinds(value: unknown): PrimarySurfaceKind[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isPrimaryKind))];
}

export function workspaceSurfacePreferencesKey(workspaceId: string): string {
  return `codepilot:workspace-surfaces:v1:${workspaceId}`;
}

export function threadSurfaceStateKey(sessionId: string): string {
  return `codepilot:thread-surfaces:v1:${sessionId || 'global'}`;
}

/**
 * Parse the thread-owned half of the surface state. A record is accepted only
 * for the requested session; malformed tabs and stale active ids fail closed.
 */
export function parseThreadSurfaceState(
  raw: string | null | undefined,
  sessionId: string,
): ThreadSurfaceStateV1 | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ThreadSurfaceStateV1>;
    if (parsed.version !== 1 || parsed.sessionId !== sessionId) return null;
    const inspectorTabs = parsableInspectorTabs(parsed.inspectorTabs);
    const activeInspectorId = typeof parsed.activeInspectorId === 'string'
      && inspectorTabs.some((tab) => tab.id === parsed.activeInspectorId)
      ? parsed.activeInspectorId
      : undefined;
    return {
      version: 1,
      sessionId,
      ...(isPrimaryKind(parsed.activePrimary) ? { activePrimary: parsed.activePrimary } : {}),
      inspectorTabs,
      ...(activeInspectorId ? { activeInspectorId } : {}),
    };
  } catch {
    return null;
  }
}

export function initialWorkspaceSurfacePreferences(workspaceId: string): WorkspaceSurfacePreferencesV1 {
  return {
    version: 1,
    workspaceId,
    pinnedKinds: [],
    order: [...PRIMARY_SURFACES],
    open: false,
    width: DEFAULT_WIDTH,
  };
}

export function movePrimarySurface(
  order: readonly PrimarySurfaceKind[],
  kind: PrimarySurfaceKind,
  direction: -1 | 1,
): PrimarySurfaceKind[] {
  const normalized = [
    ...uniquePrimaryKinds(order),
    ...PRIMARY_SURFACES.filter((candidate) => !order.includes(candidate)),
  ];
  const index = normalized.indexOf(kind);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= normalized.length) return normalized;
  const next = normalized.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function parseWorkspaceSurfacePreferences(
  raw: string | null | undefined,
  workspaceId: string,
): WorkspaceSurfacePreferencesV1 {
  if (!raw) return initialWorkspaceSurfacePreferences(workspaceId);
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceSurfacePreferencesV1>;
    if (parsed.version !== 1 || parsed.workspaceId !== workspaceId) {
      return initialWorkspaceSurfacePreferences(workspaceId);
    }
    const pinnedKinds = uniquePrimaryKinds(parsed.pinnedKinds);
    const configuredOrder = uniquePrimaryKinds(parsed.order);
    return {
      version: 1,
      workspaceId,
      pinnedKinds,
      order: [...configuredOrder, ...PRIMARY_SURFACES.filter((kind) => !configuredOrder.includes(kind))],
      ...(isPrimaryKind(parsed.defaultActiveKind) ? { defaultActiveKind: parsed.defaultActiveKind } : {}),
      open: typeof parsed.open === 'boolean' ? parsed.open : false,
      width: typeof parsed.width === 'number'
        ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parsed.width))
        : DEFAULT_WIDTH,
    };
  } catch {
    return initialWorkspaceSurfacePreferences(workspaceId);
  }
}

export function parseLegacyWorkspaceSidebarKey(rawKey: string): { workingDirectory: string; sessionId: string } | null {
  const prefix = 'codepilot:workspace-sidebar::';
  if (!rawKey.startsWith(prefix)) return null;
  const body = rawKey.slice(prefix.length);
  const delimiter = body.lastIndexOf('::');
  if (delimiter <= 0 || delimiter >= body.length - 2) return null;
  return {
    workingDirectory: body.slice(0, delimiter),
    sessionId: body.slice(delimiter + 2),
  };
}

interface LegacySidebarWire {
  open?: unknown;
  width?: unknown;
  activeTabId?: unknown;
  dynamicTabs?: unknown;
}

export interface LegacyWorkspaceMigrationResult {
  preferences: WorkspaceSurfacePreferencesV1;
  threadStates: ThreadSurfaceStateV1[];
}

function parsableInspectorTabs(value: unknown): DynamicTab[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is DynamicTab => {
    if (!row || typeof row !== 'object') return false;
    const tab = row as Partial<DynamicTab> & { kind?: string };
    if (tab.kind === 'agent-run' || tab.kind === 'files-pinned') return false;
    return typeof tab.id === 'string'
      && typeof tab.key === 'string'
      && ['markdown', 'artifact', 'file'].includes(tab.kind || '');
  });
}

/** Migrates only entries the server already grouped under this workspace id. */
export function migrateLegacyWorkspaceSidebarEntries(
  workspaceId: string,
  entries: ReadonlyArray<{ sessionId: string; raw: string }>,
): LegacyWorkspaceMigrationResult {
  let filesPinned = false;
  let open = false;
  let width = DEFAULT_WIDTH;
  const threadStates: ThreadSurfaceStateV1[] = [];

  for (const entry of entries) {
    try {
      const wire = JSON.parse(entry.raw) as LegacySidebarWire;
      const dynamicTabs = Array.isArray(wire.dynamicTabs) ? wire.dynamicTabs : [];
      filesPinned ||= dynamicTabs.some((tab) =>
        tab && typeof tab === 'object' && (tab as { kind?: string }).kind === 'files-pinned');
      open ||= wire.open === true;
      if (typeof wire.width === 'number') width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, wire.width));
      const inspectorTabs = parsableInspectorTabs(dynamicTabs);
      const activeInspectorId = typeof wire.activeTabId === 'string'
        && inspectorTabs.some((tab) => tab.id === wire.activeTabId)
        ? wire.activeTabId
        : undefined;
      const activePrimary: PrimarySurfaceKind = wire.activeTabId === 'widget'
        ? 'widget'
        : wire.activeTabId === 'files-pinned'
          ? 'files'
          : 'git';
      threadStates.push({
        version: 1,
        sessionId: entry.sessionId,
        activePrimary,
        inspectorTabs,
        ...(activeInspectorId ? { activeInspectorId } : {}),
      });
    } catch {
      // A malformed legacy bucket is skipped; its original key remains intact.
    }
  }

  // Existing users always had Git + Widget fixed tabs. Preserve that upgrade
  // behavior; Files joins only through the monotonic OR rule.
  const pinnedKinds: PrimarySurfaceKind[] = ['git', 'widget'];
  if (filesPinned) pinnedKinds.unshift('files');
  return {
    preferences: {
      version: 1,
      workspaceId,
      pinnedKinds,
      order: [...PRIMARY_SURFACES],
      defaultActiveKind: filesPinned ? 'files' : 'git',
      open,
      width,
    },
    threadStates,
  };
}
