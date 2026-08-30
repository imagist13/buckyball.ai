/**
 * Workspace Sidebar — pure state model.
 *
 * The sidebar always carries two fixed Tabs (`git`, `widget`) plus zero
 * or more dynamic Tabs (markdown/artifact/file/files-pinned). Dynamic
 * Tabs are deduped by a `key` so the same `.md` file opened twice
 * surfaces the existing Tab instead of creating a second.
 *
 * No React here — every helper is referentially transparent so the
 * tests in `unit/workspace-sidebar.test.ts` can drive them directly.
 *
 * See `docs/exec-plans/active/workspace-sidebar-tabs.md` for product
 * intent + the full Track-by-Track plan.
 */

import type { PreviewSource } from '@/hooks/usePanel';
import type { PreviewTrust } from '@/lib/preview-source';
import type { SubagentRunDetailsResponse } from '@/types';
import type { ThreadSurfaceStateV1 } from '@/lib/workspace-surfaces';
import type {
  DelegatedAgentResult,
  SubagentDispatchState,
  SubagentRunPhase,
} from '@/lib/subagent-status';
import {
  pathIsWithin,
  remapMutationPath,
  type FileMutationTransaction,
} from '@/lib/file-mutation';

export type FixedTabId = 'git' | 'widget';

export type DynamicTabKind = 'markdown' | 'artifact' | 'file' | 'files-pinned' | 'agent-run' | 'browser';

export interface FixedTab {
  id: FixedTabId;
  kind: 'fixed';
}

export interface MarkdownTab {
  id: string;        // stable id derived from kind + key
  kind: 'markdown';
  key: string;       // = filePath
  title: string;
  filePath: string;
  /** Phase 4: trust tier inherited from the PreviewSource that opened
   *  this Tab. Missing = pre-Phase-4 persisted data; consumers default
   *  to 'workspace'. */
  trust?: PreviewTrust;
  baseDir?: string;
  readonly?: boolean;
}

export interface ArtifactTab {
  id: string;
  kind: 'artifact';
  key: string;       // = artifactId or `artifact:${filePath}`
  title: string;
  source: PreviewSource;
}

export interface FilePreviewTab {
  id: string;
  kind: 'file';
  key: string;       // = filePath
  title: string;
  filePath: string;
  /** Phase 4: see MarkdownTab.trust above. */
  trust?: PreviewTrust;
  baseDir?: string;
  readonly?: boolean;
}

export interface FilesPinnedTab {
  id: 'files-pinned';
  kind: 'files-pinned';
  key: 'files';
  title: string;
}

export interface BrowserSurfaceTab {
  id: string;
  kind: 'browser';
  key: string;
  title: string;
  initialUrl?: string;
}

export interface AgentRunTab {
  id: string;
  kind: 'agent-run';
  key: string;
  title: string;
  run: {
    id: string;
    attemptId: string;
    attemptNumber: number;
    attemptCount: number;
    agentName: string;
    prompt: string;
    requestedProviderId?: string;
    requestedModel?: string;
    effectiveProviderId?: string;
    effectiveModel?: string;
    workflowId?: string;
    taskKey?: string;
    dependencyTaskKeys: string[];
    runtime?: 'codepilot_runtime' | 'claude_code' | 'codex_runtime';
    status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'timed_out';
    phase: SubagentRunPhase;
    dispatchState: SubagentDispatchState;
    currentActivity?: string;
    lastActivityAt?: string;
    result?: string;
    structuredResult?: DelegatedAgentResult;
    attempts?: SubagentRunDetailsResponse['attempts'];
    lifecycleEvents?: SubagentRunDetailsResponse['events'];
    isError?: boolean;
    error?: {
      code: string;
      httpStatus?: number;
      retryable?: boolean;
    };
    icon: 'search' | 'code' | 'task' | 'assistant';
  };
}

export type DynamicTab = MarkdownTab | ArtifactTab | FilePreviewTab | FilesPinnedTab | AgentRunTab | BrowserSurfaceTab;
export type Tab = FixedTab | DynamicTab;

export interface WorkspaceSidebarState {
  /** Whether the shell is rendered. False = collapsed; user must click
   *  the topbar reopen button to surface it. */
  open: boolean;
  /** Pixel width of the shell when open. Persisted across sessions
   *  within the same workspace. */
  width: number;
  /** Currently active Tab `id`. Always points at a Tab in `tabs`. */
  activeTabId: string;
  /** Primary module remains mounted while inspector content opens beside it. */
  activePrimaryId: FixedTabId | 'files-pinned' | 'browser' | 'agents';
  /** Browser is a repeatable Primary. Keep its concrete sidebar Tab identity
   *  while an Inspector temporarily owns activeTabId. */
  activeBrowserTabId?: string;
  /** Active temporary detail. Undefined means the inspector lane is closed. */
  activeInspectorId?: string;
  inspectorOpen: boolean;
  /** Fixed first, then dynamic in insertion order. */
  tabs: Tab[];
}

// ─── Constants ──────────────────────────────────────────────────────

export const SIDEBAR_MIN_WIDTH = 320;
export const SIDEBAR_MAX_WIDTH = 800;
export const SIDEBAR_DEFAULT_WIDTH = 480;
export const MAX_BROWSER_SURFACE_TABS = 8;

const FIXED_TABS: ReadonlyArray<FixedTab> = [
  { id: 'git', kind: 'fixed' },
  { id: 'widget', kind: 'fixed' },
];

export function isFixedTab(tab: Tab): tab is FixedTab {
  return tab.kind === 'fixed';
}

export function isDynamicTab(tab: Tab): tab is DynamicTab {
  return tab.kind !== 'fixed';
}

// ─── Initial state ─────────────────────────────────────────────────

export function initialState(opts?: { open?: boolean; width?: number }): WorkspaceSidebarState {
  return {
    open: opts?.open ?? false,
    width: opts?.width ?? SIDEBAR_DEFAULT_WIDTH,
    activeTabId: 'git',
    activePrimaryId: 'git',
    inspectorOpen: false,
    tabs: [...FIXED_TABS],
  };
}

// ─── Tab id derivation ─────────────────────────────────────────────

/**
 * Stable id for a dynamic Tab. Same kind + key always returns the
 * same id, so subsequent `addTab` calls can detect & reuse.
 */
export function dynamicTabId(kind: DynamicTabKind, key: string): string {
  return `${kind}:${key}`;
}

export function createBrowserSurfaceTab(key: string, initialUrl?: string): BrowserSurfaceTab {
  return {
    id: dynamicTabId('browser', key),
    kind: 'browser',
    key,
    title: 'Browser',
    ...(initialUrl ? { initialUrl } : {}),
  };
}

export function renameBrowserSurfaceTab(
  state: WorkspaceSidebarState,
  id: string,
  title: string,
): WorkspaceSidebarState {
  const normalized = title.trim().slice(0, 80);
  if (!normalized) return state;
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    if (tab.id !== id || tab.kind !== 'browser' || tab.title === normalized) return tab;
    changed = true;
    return { ...tab, title: normalized };
  });
  return changed ? { ...state, tabs } : state;
}

// ─── Mutations (returns new state) ─────────────────────────────────

/**
 * Open or focus a dynamic Tab.
 * - If a Tab with the same id already exists → activate it AND replace
 *   the existing tab's metadata in place. This matters for the Phase 4
 *   agent-referenced → user-selected promotion: PreviewPanel calls
 *   setPreviewSource with the upgraded trust tier on confirm, which
 *   funnels back through this reducer. If we kept the old tab object,
 *   the persisted tab list (localStorage) would still carry the
 *   agent-referenced marker and the user would re-see the confirm
 *   card after every page reload. Replacing in place is safe because
 *   the key (filePath / artifact id) is the same — we're updating
 *   trust / baseDir / readonly / title, not creating a duplicate.
 * - Otherwise → append at the end of the dynamic list and activate it.
 *
 * Always sets `open: true` (caller wants the sidebar surfaced).
 */
export function openDynamicTab(
  state: WorkspaceSidebarState,
  tab: DynamicTab,
): WorkspaceSidebarState {
  const existingIdx = state.tabs.findIndex((t) => t.id === tab.id);
  if (existingIdx >= 0) {
    const nextTabs = state.tabs.slice();
    nextTabs[existingIdx] = tab;
    if (tab.kind === 'browser') {
      return {
        ...state,
        open: true,
        activeTabId: tab.id,
        activePrimaryId: 'browser',
        activeBrowserTabId: tab.id,
        activeInspectorId: undefined,
        inspectorOpen: false,
        tabs: nextTabs,
      };
    }
    if (tab.kind === 'files-pinned') {
      return {
        ...state,
        open: true,
        activeTabId: tab.id,
        activePrimaryId: 'files-pinned',
        tabs: nextTabs,
      };
    }
    return {
      ...state,
      open: true,
      activeTabId: tab.id,
      activeInspectorId: tab.id,
      inspectorOpen: true,
      tabs: nextTabs,
    };
  }
  if (tab.kind === 'browser') {
    return {
      ...state,
      open: true,
      activeTabId: tab.id,
      activePrimaryId: 'browser',
      activeBrowserTabId: tab.id,
      activeInspectorId: undefined,
      inspectorOpen: false,
      tabs: [...state.tabs, tab],
    };
  }
  if (tab.kind === 'files-pinned') {
    return {
      ...state,
      open: true,
      activeTabId: tab.id,
      activePrimaryId: 'files-pinned',
      tabs: [...state.tabs, tab],
    };
  }
  return {
    ...state,
    open: true,
    activeTabId: tab.id,
    activeInspectorId: tab.id,
    inspectorOpen: true,
    tabs: [...state.tabs, tab],
  };
}

/**
 * Close a Tab by id. Fixed Tabs are never closable, so this is a no-op
 * for them. After closing, activate the previous Tab in the list (or
 * fall back to the first fixed Tab).
 */
export function closeTab(
  state: WorkspaceSidebarState,
  id: string,
): WorkspaceSidebarState {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return state;
  const target = state.tabs[idx];
  if (isFixedTab(target)) return state;
  const nextTabs = state.tabs.filter((t) => t.id !== id);
  if (target.kind === 'browser') {
    const browserPosition = state.tabs
      .filter((tab): tab is BrowserSurfaceTab => tab.kind === 'browser')
      .findIndex((tab) => tab.id === id);
    const remainingBrowsers = nextTabs.filter((tab): tab is BrowserSurfaceTab => tab.kind === 'browser');
    const closingActiveBrowser = state.activeBrowserTabId === id || state.activeTabId === id;
    const replacement = closingActiveBrowser
      ? remainingBrowsers[Math.min(browserPosition, remainingBrowsers.length - 1)]
      : remainingBrowsers.find((tab) => tab.id === state.activeBrowserTabId);
    const noBrowserRemains = remainingBrowsers.length === 0;
    const activePrimaryId = noBrowserRemains && state.activePrimaryId === 'browser'
      ? 'git'
      : state.activePrimaryId;
    const activeBrowserTabId = replacement?.id;
    const activeTabId = state.inspectorOpen
      ? state.activeTabId
      : closingActiveBrowser
        ? replacement?.id ?? activePrimaryId
        : state.activeTabId;
    return {
      ...state,
      tabs: nextTabs,
      activeTabId,
      activePrimaryId,
      activeBrowserTabId,
    };
  }
  let nextActive = state.activeTabId;
  if (state.activeTabId === id) {
    // Prefer the Tab that was sitting to the left, else the first one.
    nextActive = nextTabs[Math.max(0, idx - 1)]?.id ?? nextTabs[0]?.id ?? 'git';
  }
  const activeInspectorId = state.activeInspectorId === id
    ? nextTabs.find((tab) => isDynamicTab(tab)
        && tab.kind !== 'files-pinned'
        && tab.kind !== 'browser')?.id
    : state.activeInspectorId;
  const inspectorOpen = Boolean(activeInspectorId);
  const activePrimaryId = target.kind === 'files-pinned' && state.activePrimaryId === 'files-pinned'
    ? 'git'
    : state.activePrimaryId;
  return {
    ...state,
    tabs: nextTabs,
    activeTabId: nextActive,
    activePrimaryId,
    activeInspectorId,
    inspectorOpen,
  };
}

export function setActiveTab(state: WorkspaceSidebarState, id: string): WorkspaceSidebarState {
  const tab = state.tabs.find((candidate) => candidate.id === id);
  if (!tab) return state;
  if (tab.kind === 'browser') {
    return {
      ...state,
      activeTabId: id,
      activePrimaryId: 'browser',
      activeBrowserTabId: id,
      activeInspectorId: undefined,
      inspectorOpen: false,
      open: true,
    };
  }
  if (tab.kind === 'fixed' || tab.kind === 'files-pinned') {
    return {
      ...state,
      activeTabId: id,
      activePrimaryId: tab.id,
      open: true,
    };
  }
  return {
    ...state,
    activeTabId: id,
    activeInspectorId: id,
    inspectorOpen: true,
    open: true,
  };
}

export function setActivePrimary(
  state: WorkspaceSidebarState,
  id: WorkspaceSidebarState['activePrimaryId'],
): WorkspaceSidebarState {
  if (id === 'files-pinned') {
    const existing = state.tabs.find((tab) => tab.id === 'files-pinned');
    return existing
      ? { ...state, open: true, activePrimaryId: id, activeTabId: id }
      : openDynamicTab(state, {
          id: 'files-pinned',
          kind: 'files-pinned',
          key: 'files',
          title: 'Files',
        });
  }
  if (id === 'browser') {
    const existing = state.tabs.find((tab): tab is BrowserSurfaceTab =>
      tab.kind === 'browser' && tab.id === state.activeBrowserTabId)
      ?? state.tabs.find((tab): tab is BrowserSurfaceTab => tab.kind === 'browser');
    return existing
      ? setActiveTab(state, existing.id)
      : openDynamicTab(state, createBrowserSurfaceTab('restored'));
  }
  if (id === 'git' || id === 'widget') return setActiveTab(state, id);
  return { ...state, open: true, activePrimaryId: id, activeTabId: id };
}

/**
 * User-driven Primary activation is a lane switch: the selected Primary must
 * become visible and the current Inspector becomes inactive, while its tab is
 * retained so the user can switch back. Hydration deliberately continues to
 * call `setActivePrimary` directly because restoring a thread must preserve an
 * Inspector that was open before reload.
 */
export function activatePrimaryInteractively(
  state: WorkspaceSidebarState,
  id: WorkspaceSidebarState['activePrimaryId'],
): WorkspaceSidebarState {
  return closeInspector(setActivePrimary(state, id));
}

/**
 * Apply workspace-owned preferences without erasing thread-owned active state.
 *
 * Interactive activation deliberately opens the shell. Hydration is different:
 * it must restore the active Primary while preserving the persisted collapsed
 * state. A thread's active Primary wins when it is still pinned; otherwise the
 * workspace default is used. Applying `open` last prevents `setActivePrimary`
 * from turning a persisted `false` back into `true`.
 */
export function hydrateWorkspaceSidebarState(
  state: WorkspaceSidebarState,
  options: {
    open: boolean;
    width: number;
    pinnedPrimaryIds: WorkspaceSidebarState['activePrimaryId'][];
    defaultPrimaryId: WorkspaceSidebarState['activePrimaryId'];
    preferredPrimaryId?: WorkspaceSidebarState['activePrimaryId'];
  },
): WorkspaceSidebarState {
  const candidate = options.preferredPrimaryId ?? state.activePrimaryId;
  const activePrimaryId = options.pinnedPrimaryIds.includes(candidate)
    ? candidate
    : options.defaultPrimaryId;
  const activated = setActivePrimary(state, activePrimaryId);
  return setOpen(setWidth(activated, options.width), options.open);
}

export function closeInspector(state: WorkspaceSidebarState): WorkspaceSidebarState {
  if (!state.inspectorOpen) return state;
  return {
    ...state,
    inspectorOpen: false,
    activeInspectorId: undefined,
    activeTabId: state.activePrimaryId === 'browser'
      ? state.activeBrowserTabId ?? 'git'
      : state.activePrimaryId,
  };
}

export function setOpen(state: WorkspaceSidebarState, open: boolean): WorkspaceSidebarState {
  if (state.open === open) return state;
  return { ...state, open };
}

export function setWidth(state: WorkspaceSidebarState, width: number): WorkspaceSidebarState {
  const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
  if (state.width === clamped) return state;
  return { ...state, width: clamped };
}

/**
 * Atomically migrate every file-backed tab after a successful filesystem
 * mutation. IDs and keys contain the absolute path, so changing only
 * `filePath` would leave persistence and future deduplication corrupted.
 */
export function commitWorkspaceFileMutation(
  state: WorkspaceSidebarState,
  transaction: FileMutationTransaction,
): WorkspaceSidebarState {
  const affected = (tab: Tab) =>
    (tab.kind === 'markdown' || tab.kind === 'file') &&
    pathIsWithin(tab.filePath, transaction.targetPath);
  const activeIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);

  if (transaction.kind === 'delete') {
    const tabs = state.tabs.filter((tab) => !affected(tab));
    if (tabs.length === state.tabs.length) return state;
    const activeWasDeleted = state.tabs.some(
      (tab) => tab.id === state.activeTabId && affected(tab),
    );
    const activeTabId = activeWasDeleted
      ? tabs[Math.max(0, activeIndex - 1)]?.id ?? tabs[0]?.id ?? 'git'
      : state.activeTabId;
    return {
      ...state,
      tabs,
      activeTabId,
      ...(state.activeInspectorId && !tabs.some((tab) => tab.id === state.activeInspectorId)
        ? { activeInspectorId: undefined, inspectorOpen: false }
        : {}),
    };
  }

  if (!transaction.newPath) return state;
  let nextActiveId = state.activeTabId;
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    if (!affected(tab) || (tab.kind !== 'markdown' && tab.kind !== 'file')) {
      return tab;
    }
    changed = true;
    const filePath = remapMutationPath(
      tab.filePath,
      transaction.targetPath,
      transaction.newPath!,
    );
    const id = dynamicTabId(tab.kind, filePath);
    if (tab.id === state.activeTabId) nextActiveId = id;
    return {
      ...tab,
      id,
      key: filePath,
      filePath,
      title: filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath,
    };
  });
  const activeInspectorId = state.activeInspectorId === state.activeTabId
    ? nextActiveId
    : state.activeInspectorId;
  return changed ? { ...state, tabs, activeTabId: nextActiveId, activeInspectorId } : state;
}

// ─── Persistence ───────────────────────────────────────────────────

/**
 * localStorage key. Scoped by workspace + session so two projects
 * (or two sessions in the same workspace) don't share Tab lists.
 *
 * `null` workingDirectory or sessionId → 'global' bucket so the user
 * gets a sensible default before a chat is selected.
 */
export function storageKey(workingDirectory: string | null | undefined, sessionId: string | null | undefined): string {
  const wd = workingDirectory && workingDirectory.length > 0 ? workingDirectory : 'global';
  const sid = sessionId && sessionId.length > 0 ? sessionId : 'global';
  return `codepilot:workspace-sidebar::${wd}::${sid}`;
}

/**
 * Subset of state we persist. Dynamic Tabs ARE persisted so reloading
 * the page doesn't lose the user's open previews; fixed Tabs are
 * always materialised from FIXED_TABS at load so we don't drift if
 * the fixed-tab list grows.
 */
interface SerializedState {
  open: boolean;
  width: number;
  activeTabId: string;
  activePrimaryId: FixedTabId | 'files-pinned' | 'browser' | 'agents';
  activeInspectorId?: string;
  inspectorOpen: boolean;
  dynamicTabs: DynamicTab[];
}

export function serialize(state: WorkspaceSidebarState): SerializedState {
  return {
    open: state.open,
    width: state.width,
    activeTabId: state.activeTabId,
    activePrimaryId: state.activePrimaryId,
    activeInspectorId: state.activeInspectorId,
    inspectorOpen: state.inspectorOpen,
    // Agent transcripts are reconstructed from the durable chat message on
    // demand. Do not duplicate prompt/result content into localStorage.
    dynamicTabs: state.tabs.filter(isDynamicTab).filter(tab =>
      tab.kind !== 'agent-run' && tab.kind !== 'browser'),
  };
}

/**
 * Inverse of `serialize`. Defensive against malformed stored values:
 * any failure returns a fresh `initialState()` rather than throwing.
 */
export function parse(raw: string | null | undefined): WorkspaceSidebarState {
  if (!raw) return initialState();
  try {
    const data = JSON.parse(raw) as Partial<SerializedState>;
    const dynamicTabs = Array.isArray(data.dynamicTabs)
      ? data.dynamicTabs.filter(isParsableDynamicTab).map(stripLegacyPresentationTemplate)
      : [];
    const tabs: Tab[] = [...FIXED_TABS, ...dynamicTabs];
    const fallbackActive = 'git';
    const desired = typeof data.activeTabId === 'string' ? data.activeTabId : fallbackActive;
    const activeTabId = tabs.some((t) => t.id === desired) ? desired : fallbackActive;
    const persistedPrimary = data.activePrimaryId;
    const activePrimaryId = (persistedPrimary === 'git'
      || persistedPrimary === 'widget'
      || persistedPrimary === 'browser'
      || persistedPrimary === 'agents'
      || (persistedPrimary === 'files-pinned' && tabs.some((tab) => tab.id === 'files-pinned')))
      ? persistedPrimary
      : activeTabId === 'git' || activeTabId === 'widget' || activeTabId === 'files-pinned'
        ? activeTabId
        : 'git';
    const activeInspectorId = typeof data.activeInspectorId === 'string'
      && tabs.some((tab) => tab.id === data.activeInspectorId && isDynamicTab(tab) && tab.kind !== 'files-pinned')
      ? data.activeInspectorId
      : (activeTabId !== 'git' && activeTabId !== 'widget' && activeTabId !== 'files-pinned'
          ? activeTabId
          : undefined);
    return {
      open: typeof data.open === 'boolean' ? data.open : false,
      width: typeof data.width === 'number'
        ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, data.width))
        : SIDEBAR_DEFAULT_WIDTH,
      activeTabId,
      activePrimaryId,
      activeInspectorId,
      inspectorOpen: typeof data.inspectorOpen === 'boolean'
        ? data.inspectorOpen && Boolean(activeInspectorId)
        : Boolean(activeInspectorId),
      tabs,
    };
  } catch {
    return initialState();
  }
}

/** Thread-scoped persistence deliberately excludes workspace preferences,
 * Files pin state, and agent transcripts. */
export function serializeThreadSurfaceState(
  state: WorkspaceSidebarState,
  sessionId: string,
): ThreadSurfaceStateV1 {
  const activePrimary = state.activePrimaryId === 'files-pinned'
    ? 'files'
    : state.activePrimaryId;
  const inspectorTabs = state.tabs.filter((tab): tab is DynamicTab =>
    isDynamicTab(tab)
      && tab.kind !== 'files-pinned'
      && tab.kind !== 'agent-run'
      && tab.kind !== 'browser');
  const activeInspectorId = state.inspectorOpen
    && state.activeInspectorId
    && inspectorTabs.some((tab) => tab.id === state.activeInspectorId)
    ? state.activeInspectorId
    : undefined;
  return {
    version: 1,
    sessionId,
    activePrimary,
    inspectorTabs,
    ...(activeInspectorId ? { activeInspectorId } : {}),
  };
}

/** Restore thread previews on top of workspace-owned open/width preferences. */
export function restoreThreadSurfaceState(
  base: WorkspaceSidebarState,
  thread: ThreadSurfaceStateV1 | null,
): WorkspaceSidebarState {
  if (!thread) return base;
  const primaryId: WorkspaceSidebarState['activePrimaryId'] = thread.activePrimary === 'files'
    ? 'files-pinned'
    : thread.activePrimary ?? base.activePrimaryId;
  const filesTab: FilesPinnedTab = {
    id: 'files-pinned',
    kind: 'files-pinned',
    key: 'files',
    title: 'Files',
  };
  const preserved = base.tabs.filter((tab) =>
    isFixedTab(tab) || tab.kind === 'agent-run' || tab.kind === 'files-pinned');
  const withPrimary = primaryId === 'files-pinned'
    && !preserved.some((tab) => tab.id === 'files-pinned')
    ? [...preserved, filesTab]
    : preserved;
  const browserTab = createBrowserSurfaceTab('restored');
  const withRepeatablePrimary = primaryId === 'browser'
    ? [...withPrimary, browserTab]
    : withPrimary;
  const tabs: Tab[] = [
    ...withRepeatablePrimary,
    ...thread.inspectorTabs.filter((tab) => !withRepeatablePrimary.some((existing) => existing.id === tab.id)),
  ];
  const activeInspectorId = thread.activeInspectorId
    && tabs.some((tab) => tab.id === thread.activeInspectorId)
    ? thread.activeInspectorId
    : undefined;
  const inspectorOpen = Boolean(activeInspectorId);
  return {
    ...base,
    open: base.open || inspectorOpen,
    tabs,
    activePrimaryId: primaryId,
    activeBrowserTabId: primaryId === 'browser' ? browserTab.id : undefined,
    activeInspectorId,
    inspectorOpen,
    activeTabId: activeInspectorId ?? (primaryId === 'browser' ? browserTab.id : primaryId),
  };
}

/**
 * Tabs written by v0.54 may carry the retired in-place Markdown theme.
 * Accept the old record, but deliberately drop that field at the parse
 * boundary so it cannot leak back into current runtime state.
 */
function stripLegacyPresentationTemplate(tab: DynamicTab): DynamicTab {
  if (tab.kind !== 'markdown' || !('presentationTemplate' in tab)) return tab;
  const next = { ...tab } as DynamicTab & { presentationTemplate?: unknown };
  delete next.presentationTemplate;
  return next;
}

function isParsableDynamicTab(value: unknown): value is DynamicTab {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<DynamicTab> & { kind?: string; id?: string; key?: string };
  if (typeof v.id !== 'string' || typeof v.key !== 'string') return false;
  if (v.kind === 'agent-run') {
    const run = (v as Partial<AgentRunTab>).run;
    return !!run
      && typeof run.id === 'string'
      && typeof run.agentName === 'string'
      && typeof run.prompt === 'string'
      && ['queued', 'running', 'completed', 'partial', 'failed', 'cancelled', 'timed_out'].includes(run.status);
  }
  return v.kind === 'markdown' || v.kind === 'artifact' || v.kind === 'file' || v.kind === 'files-pinned';
}

// =====================================================================
// Tab descriptor derivation from a PreviewSource
// =====================================================================

const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx']);

/**
 * Derive a dynamic Tab descriptor from a PreviewSource (the existing
 * AppShell discriminator). Used by the window-event bridge so any
 * call to `setPreviewSource(...)` on a chat-detail route surfaces in
 * the Workspace Sidebar as a Tab.
 *
 * - file kind, .md/.mdx → markdown Tab keyed by filePath
 * - file kind, anything else → file Tab keyed by filePath
 * - inline-* kinds → artifact Tab keyed by virtualName or generated id
 */
export function tabFromPreviewSource(source: PreviewSource): DynamicTab {
  if (source.kind === 'file') {
    const ext = (source.filePath.split('.').pop() || '').toLowerCase();
    const title = source.filePath.split(/[\\/]/).filter(Boolean).pop() || source.filePath;
    // Carry the trust tier through to the Tab so reopening from
    // persistence preserves agent-referenced / user-selected semantics
    // (otherwise a refresh would silently re-promote the path to
    // workspace and bypass the confirm card).
    const provenance = {
      trust: source.trust,
      baseDir: source.baseDir,
      readonly: source.readonly,
    };
    if (MARKDOWN_EXTENSIONS.has(ext)) {
      return {
        id: dynamicTabId('markdown', source.filePath),
        kind: 'markdown',
        key: source.filePath,
        title,
        filePath: source.filePath,
        ...provenance,
      };
    }
    return {
      id: dynamicTabId('file', source.filePath),
      kind: 'file',
      key: source.filePath,
      title,
      filePath: source.filePath,
      ...provenance,
    };
  }
  // inline-* — artifact Tab. Phase 4 UX: fingerprint includes a fast
  // content hash so multiple Preview clicks on the same code fence
  // reuse one tab. The kind prefix prevents collisions across
  // inline-html / inline-json / etc. with the same content. Falls
  // back to virtualName + content-length when content isn't readable
  // (defensive — every concrete kind below has a content field).
  const contentForHash = readInlineContent(source);
  const hashSuffix = djb2Hex(contentForHash);
  const fingerprint = `${source.kind}:${hashSuffix}`;
  return {
    id: dynamicTabId('artifact', fingerprint),
    kind: 'artifact',
    key: fingerprint,
    title: source.virtualName || `inline-${source.kind}`,
    source,
  };
}

/** Pull the content payload out of an inline-* source for hashing.
 *  Used by tabFromPreviewSource to dedupe by content rather than by
 *  virtualName, so two clicks on the same code-fence Preview produce
 *  one tab regardless of when. */
function readInlineContent(source: PreviewSource): string {
  switch (source.kind) {
    case 'inline-html':
      return source.html;
    case 'inline-jsx':
      return source.jsx;
    case 'inline-datatable':
      return JSON.stringify({ header: source.header, rows: source.rows });
    case 'inline-json':
      return source.text;
    case 'inline-diff':
      return source.diff;
    case 'inline-markdown':
      return source.markdown;
    default:
      return '';
  }
}

/**
 * djb2 32-bit hash as zero-padded hex. Sufficient for tab dedup —
 * collision probability is effectively zero at typical content
 * volumes (dozens of artifacts per session), and the hash is
 * deterministic so the SAME content always produces the SAME tab id.
 */
export function djb2Hex(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  // Force to unsigned 32-bit and pad
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Inverse of `tabFromPreviewSource`: given an active dynamic Tab,
 * return the PreviewSource that PreviewPanel should render.
 *
 * Returns `null` for fixed Tabs (`git`, `widget`) and the Files Pinned
 * Tab — those don't render the preview surface, so callers should
 * leave `previewSource` untouched (the previously-shown file stays
 * loaded but invisible until the user re-activates a preview Tab).
 *
 * Used by `TabPanel`'s sync effect so switching dynamic Tabs swaps
 * the content (Codex P1). Without this, all dynamic Tabs would share
 * the single global `previewSource` and clicking back to an earlier
 * Tab would still display the most-recently-opened content.
 */
export function previewSourceFromTab(tab: Tab): PreviewSource | null {
  if (tab.kind === 'markdown' || tab.kind === 'file') {
    // Spread-only-when-defined so pre-Phase-4 persisted Tabs (no trust
    // field) reconstruct to the same literal shape the Phase-2 callers
    // produced. PreviewPanel defaults missing trust to 'workspace'.
    const provenance: Partial<PreviewSource & { kind: 'file' }> = {};
    if (tab.trust !== undefined) provenance.trust = tab.trust;
    if (tab.baseDir !== undefined) provenance.baseDir = tab.baseDir;
    if (tab.readonly !== undefined) provenance.readonly = tab.readonly;
    return { kind: 'file', filePath: tab.filePath, ...provenance };
  }
  if (tab.kind === 'artifact') {
    return tab.source;
  }
  // 'fixed' / 'files-pinned' / 'agent-run' — preview surface isn't theirs.
  return null;
}
