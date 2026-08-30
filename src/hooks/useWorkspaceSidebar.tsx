'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  activatePrimaryInteractively as pureActivatePrimaryInteractively,
  closeInspector as pureCloseInspector,
  closeTab as pureClose,
  createBrowserSurfaceTab,
  commitWorkspaceFileMutation,
  hydrateWorkspaceSidebarState as pureHydrateWorkspaceSidebarState,
  initialState,
  openDynamicTab as pureOpen,
  parse,
  restoreThreadSurfaceState,
  renameBrowserSurfaceTab as pureRenameBrowser,
  serializeThreadSurfaceState,
  setActivePrimary as pureSetActivePrimary,
  setActiveTab as pureSetActive,
  setOpen as pureSetOpen,
  setWidth as pureSetWidth,
  storageKey,
  tabFromPreviewSource,
  type DynamicTab,
  MAX_BROWSER_SURFACE_TABS,
  type WorkspaceSidebarState,
} from '@/lib/workspace-sidebar';
import {
  initialWorkspaceSurfacePreferences,
  migrateLegacyWorkspaceSidebarEntries,
  movePrimarySurface,
  parseLegacyWorkspaceSidebarKey,
  parseThreadSurfaceState,
  parseWorkspaceSurfacePreferences,
  threadSurfaceStateKey,
  workspaceSurfacePreferencesKey,
  type PrimarySurfaceKind,
  type WorkspaceSurfacePreferencesV1,
} from '@/lib/workspace-surfaces';
import type { PreviewSource } from '@/hooks/usePanel';
import { useFileMutation } from '@/hooks/useFileMutation';

export const WORKSPACE_TAB_OPEN_EVENT = 'workspace-tab-open-request';

export interface WorkspaceTabOpenDetail {
  source: PreviewSource;
}

interface WorkspaceSidebarContextValue {
  state: WorkspaceSidebarState;
  workspaceId?: string;
  preferences: WorkspaceSurfacePreferencesV1;
  /** Tabs open in this session. Unlike pinnedKinds this is transient: closing
   * a tab does not change whether it reopens with the project next time. */
  openPrimaryKinds: PrimarySurfaceKind[];
  showLauncher: boolean;
  openTab: (tab: DynamicTab) => void;
  openBrowserTab: (initialUrl?: string) => void;
  renameBrowserTab: (id: string, title: string) => void;
  closeTab: (id: string) => void;
  closeInspector: () => void;
  setActiveTab: (id: string) => void;
  activatePrimary: (kind: PrimarySurfaceKind) => void;
  closePrimary: (kind: PrimarySurfaceKind) => void;
  pinSurface: (kind: PrimarySurfaceKind) => void;
  unpinSurface: (kind: PrimarySurfaceKind) => void;
  movePinnedSurface: (kind: PrimarySurfaceKind, direction: -1 | 1) => void;
  setOpen: (open: boolean) => void;
  setWidth: (width: number) => void;
}

export const WorkspaceSidebarContext = createContext<WorkspaceSidebarContextValue | null>(null);

interface ProviderProps {
  workingDirectory: string;
  sessionId: string;
  children: React.ReactNode;
}

function statePrimaryId(kind: PrimarySurfaceKind): WorkspaceSidebarState['activePrimaryId'] {
  return kind === 'files' ? 'files-pinned' : kind;
}

function surfaceKindFromState(id: WorkspaceSidebarState['activePrimaryId']): PrimarySurfaceKind {
  return id === 'files-pinned' ? 'files' : id;
}

function defaultPinnedSurface(preferences: WorkspaceSurfacePreferencesV1): PrimarySurfaceKind {
  return preferences.defaultActiveKind
    && preferences.pinnedKinds.includes(preferences.defaultActiveKind)
    ? preferences.defaultActiveKind
    : preferences.pinnedKinds[0] ?? 'git';
}

function hydrateWorkspaceState(
  current: WorkspaceSidebarState,
  preferences: WorkspaceSurfacePreferencesV1,
  preferredKind?: PrimarySurfaceKind,
): WorkspaceSidebarState {
  const hydrated = pureHydrateWorkspaceSidebarState(current, {
    open: preferences.open,
    width: preferences.width,
    pinnedPrimaryIds: preferences.pinnedKinds.map(statePrimaryId),
    defaultPrimaryId: statePrimaryId(defaultPinnedSurface(preferences)),
    ...(preferredKind ? { preferredPrimaryId: statePrimaryId(preferredKind) } : {}),
  });
  if (!preferences.pinnedKinds.includes('browser')
    || hydrated.tabs.some((tab) => tab.kind === 'browser')) {
    return hydrated;
  }
  return {
    ...hydrated,
    tabs: [...hydrated.tabs, createBrowserSurfaceTab('pinned')],
  };
}

interface LegacyRecord {
  key: string;
  workingDirectory: string;
  sessionId: string;
  raw: string;
}

function readLegacyRecords(): LegacyRecord[] {
  const records: LegacyRecord[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key) continue;
    const parsed = parseLegacyWorkspaceSidebarKey(key);
    if (!parsed) continue;
    const raw = window.localStorage.getItem(key);
    if (raw === null) continue;
    records.push({ key, ...parsed, raw });
  }
  return records;
}

export function WorkspaceSidebarProvider({ workingDirectory, sessionId, children }: ProviderProps) {
  const { registerParticipant } = useFileMutation();
  const legacyKey = storageKey(workingDirectory, sessionId);
  const threadKey = threadSurfaceStateKey(sessionId);
  const [state, setState] = useState<WorkspaceSidebarState>(() => initialState());
  const [hydratedThreadKey, setHydratedThreadKey] = useState('');
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [preferences, setPreferences] = useState<WorkspaceSurfacePreferencesV1>(
    () => initialWorkspaceSurfacePreferences('pending'),
  );
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [openPrimaryKinds, setOpenPrimaryKinds] = useState<PrimarySurfaceKind[]>([]);
  const [showLauncher, setShowLauncher] = useState(true);
  const browserTabSequence = useRef(0);

  useEffect(
    () => registerParticipant({
      id: 'workspace-sidebar-tabs',
      priority: 30,
      matches: () => true,
      commit: (transaction) => {
        setState((current) => commitWorkspaceFileMutation(current, transaction));
      },
    }),
    [registerParticipant],
  );

  // Prefer the canonical thread bucket and read the old bucket as a one-version
  // migration fallback. Never mirror current state back into the legacy key:
  // doing so makes a brand-new workspace look like an upgrade candidate before
  // canonical identity hydration finishes.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const legacy = parse(window.localStorage.getItem(legacyKey));
      const thread = parseThreadSurfaceState(window.localStorage.getItem(threadKey), sessionId);
      setState(restoreThreadSurfaceState(legacy, thread));
    } catch {
      setState(initialState());
    }
    setHydratedThreadKey(threadKey);
  }, [legacyKey, sessionId, threadKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (hydratedThreadKey !== threadKey) return;
    try {
      window.localStorage.setItem(
        threadKey,
        JSON.stringify(serializeThreadSurfaceState(state, sessionId)),
      );
    } catch {
      // In-memory behavior remains available.
    }
  }, [hydratedThreadKey, sessionId, state, threadKey]);

  // Server-owned canonical identity. Session rows win; New Chat sends only its
  // currently selected directory and the server verifies it exists.
  /* eslint-disable react-hooks/set-state-in-effect -- identity scope changes invalidate hydrated external storage state */
  useEffect(() => {
    let cancelled = false;
    setPreferencesHydrated(false);
    setOpenPrimaryKinds([]);
    setShowLauncher(true);
    const params = new URLSearchParams();
    if (sessionId) params.set('sessionId', sessionId);
    else if (workingDirectory) params.set('workingDirectory', workingDirectory);
    if (!params.toString()) {
      setWorkspaceId(undefined);
      setPreferences(initialWorkspaceSurfacePreferences('pending'));
      setOpenPrimaryKinds([]);
      setShowLauncher(true);
      return;
    }

    fetch(`/api/workspace/identity?${params.toString()}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('identity unavailable')))
      .then(async (payload) => {
        if (cancelled || typeof payload?.identity?.id !== 'string') return;
        const id = payload.identity.id as string;
        const preferenceKey = workspaceSurfacePreferencesKey(id);
        const existing = window.localStorage.getItem(preferenceKey);
        if (existing) {
          const parsed = parseWorkspaceSurfacePreferences(existing, id);
          setWorkspaceId(id);
          setPreferences(parsed);
          setOpenPrimaryKinds(parsed.pinnedKinds);
          setShowLauncher(parsed.pinnedKinds.length === 0);
          setState((current) => hydrateWorkspaceState(current, parsed));
          setPreferencesHydrated(true);
          return;
        }

        // First run under v1: resolve every unique legacy directory in one
        // bounded server batch, then migrate only buckets that map to this id.
        const legacy = readLegacyRecords();
        const directories = [...new Set(legacy.map((record) => record.workingDirectory))].slice(0, 50);
        let matching: LegacyRecord[] = [];
        if (directories.length > 0) {
          const response = await fetch('/api/workspace/identity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workingDirectories: directories }),
          });
          if (response.ok) {
            const migrationPayload = await response.json() as {
              results?: Array<{ index: number; identity: { id?: string } | null }>;
            };
            const matchingDirectories = new Set(
              (migrationPayload.results ?? [])
                .filter((result) => result.identity?.id === id)
                .map((result) => directories[result.index])
                .filter(Boolean),
            );
            matching = legacy.filter((record) => matchingDirectories.has(record.workingDirectory));
          }
        }

        const migrated = matching.length > 0
          ? migrateLegacyWorkspaceSidebarEntries(id, matching.map(({ sessionId: legacySessionId, raw }) => ({
              sessionId: legacySessionId,
              raw,
            })))
          : { preferences: initialWorkspaceSurfacePreferences(id), threadStates: [] };
        if (cancelled) return;
        window.localStorage.setItem(preferenceKey, JSON.stringify(migrated.preferences));
        for (const threadState of migrated.threadStates) {
          const threadKey = threadSurfaceStateKey(threadState.sessionId);
          if (!window.localStorage.getItem(threadKey)) {
            window.localStorage.setItem(threadKey, JSON.stringify(threadState));
          }
        }
        const migratedThreadActive = migrated.threadStates
          .find((thread) => thread.sessionId === sessionId)?.activePrimary;
        const migratedActive = migratedThreadActive
          && migrated.preferences.pinnedKinds.includes(migratedThreadActive)
          ? migratedThreadActive
          : defaultPinnedSurface(migrated.preferences);
        setWorkspaceId(id);
        setPreferences(migrated.preferences);
        setOpenPrimaryKinds(migrated.preferences.pinnedKinds);
        setShowLauncher(migrated.preferences.pinnedKinds.length === 0);
        setState((current) => hydrateWorkspaceState(current, migrated.preferences, migratedActive));
        setPreferencesHydrated(true);
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceId(undefined);
          setPreferences(initialWorkspaceSurfacePreferences('pending'));
          setOpenPrimaryKinds([]);
          setShowLauncher(true);
          setPreferencesHydrated(false);
        }
      });
    return () => { cancelled = true; };
  }, [sessionId, workingDirectory]);

  // Workspace-owned width/open/default-primary track current user actions.
  useEffect(() => {
    if (!workspaceId || !preferencesHydrated) return;
    setPreferences((current) => {
      const next: WorkspaceSurfacePreferencesV1 = {
        ...current,
        open: state.open,
        width: state.width,
        defaultActiveKind: surfaceKindFromState(state.activePrimaryId),
      };
      try {
        window.localStorage.setItem(workspaceSurfacePreferencesKey(workspaceId), JSON.stringify(next));
      } catch {
        // In-memory state still works.
      }
      return next;
    });
  }, [preferencesHydrated, state.activePrimaryId, state.open, state.width, workspaceId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const openTab = useCallback((tab: DynamicTab) => setState((prev) => pureOpen(prev, tab)), []);
  const openBrowserTab = useCallback((initialUrl?: string) => {
    setOpenPrimaryKinds((current) => current.includes('browser') ? current : [...current, 'browser']);
    setShowLauncher(false);
    setState((current) => {
      const browsers = current.tabs.filter((tab) => tab.kind === 'browser');
      if (browsers.length >= MAX_BROWSER_SURFACE_TABS) {
        const existing = browsers[browsers.length - 1];
        return existing ? pureSetActive(current, existing.id) : current;
      }
      browserTabSequence.current += 1;
      const key = `${Date.now()}-${browserTabSequence.current}`;
      return pureOpen(current, createBrowserSurfaceTab(key, initialUrl));
    });
  }, []);
  const renameBrowserTab = useCallback((id: string, title: string) => {
    setState((current) => pureRenameBrowser(current, id, title));
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceTabOpenDetail>).detail;
      if (!detail?.source) return;
      try {
        const tab = tabFromPreviewSource(detail.source);
        setState((prev) => pureOpen(prev, tab));
      } catch {
        // Malformed preview sources must not break chat.
      }
    };
    window.addEventListener(WORKSPACE_TAB_OPEN_EVENT, handler);
    return () => window.removeEventListener(WORKSPACE_TAB_OPEN_EVENT, handler);
  }, []);

  const closeTab = useCallback((id: string) => setState((prev) => pureClose(prev, id)), []);
  const closeInspector = useCallback(() => setState((prev) => pureCloseInspector(prev)), []);
  const setActiveTab = useCallback((id: string) => setState((prev) => pureSetActive(prev, id)), []);
  const activatePrimary = useCallback((kind: PrimarySurfaceKind) => {
    if (kind === 'browser') {
      openBrowserTab();
      return;
    }
    setOpenPrimaryKinds((current) => current.includes(kind) ? current : [...current, kind]);
    setShowLauncher(false);
    setState((prev) => pureActivatePrimaryInteractively(prev, statePrimaryId(kind)));
  }, [openBrowserTab]);
  const closePrimary = useCallback((kind: PrimarySurfaceKind) => {
    const nextOpen = openPrimaryKinds.filter((candidate) => candidate !== kind);
    setOpenPrimaryKinds(nextOpen);
    if (surfaceKindFromState(state.activePrimaryId) !== kind) return;
    const fallback = preferences.order.find((candidate) => nextOpen.includes(candidate));
    if (fallback) {
      setState((prev) => pureSetActivePrimary(prev, statePrimaryId(fallback)));
      return;
    }
    setState((prev) => pureCloseInspector(prev));
    setShowLauncher(true);
  }, [openPrimaryKinds, preferences.order, state.activePrimaryId]);
  const setOpen = useCallback((open: boolean) => setState((prev) => pureSetOpen(prev, open)), []);
  const setWidth = useCallback((width: number) => setState((prev) => pureSetWidth(prev, width)), []);

  const updatePins = useCallback((kind: PrimarySurfaceKind, pinned: boolean) => {
    setPreferences((current) => {
      const pinnedKinds = pinned
        ? (current.pinnedKinds.includes(kind) ? current.pinnedKinds : [...current.pinnedKinds, kind])
        : current.pinnedKinds.filter((candidate) => candidate !== kind);
      const next = { ...current, pinnedKinds };
      if (workspaceId) {
        try {
          window.localStorage.setItem(workspaceSurfacePreferencesKey(workspaceId), JSON.stringify(next));
        } catch {
          // no-op
        }
      }
      return next;
    });
  }, [workspaceId]);
  const pinSurface = useCallback((kind: PrimarySurfaceKind) => {
    updatePins(kind, true);
    setOpenPrimaryKinds((current) => current.includes(kind) ? current : [...current, kind]);
    setShowLauncher(false);
    if (kind === 'browser') {
      setState((current) => {
        if (current.tabs.some((tab) => tab.kind === 'browser')) return current;
        browserTabSequence.current += 1;
        const key = `${Date.now()}-${browserTabSequence.current}`;
        return pureOpen(current, createBrowserSurfaceTab(key));
      });
      return;
    }
    setState((prev) => pureSetActivePrimary(prev, statePrimaryId(kind)));
  }, [updatePins]);
  const unpinSurface = useCallback((kind: PrimarySurfaceKind) => {
    updatePins(kind, false);
  }, [updatePins]);
  const movePinnedSurface = useCallback((kind: PrimarySurfaceKind, direction: -1 | 1) => {
    setPreferences((current) => {
      const next = { ...current, order: movePrimarySurface(current.order, kind, direction) };
      if (workspaceId) {
        try {
          window.localStorage.setItem(workspaceSurfacePreferencesKey(workspaceId), JSON.stringify(next));
        } catch {
          // In-memory ordering remains usable.
        }
      }
      return next;
    });
  }, [workspaceId]);

  const value = useMemo(() => ({
    state,
    workspaceId,
    preferences,
    openPrimaryKinds,
    showLauncher,
    openTab,
    openBrowserTab,
    renameBrowserTab,
    closeTab,
    closeInspector,
    setActiveTab,
    activatePrimary,
    closePrimary,
    pinSurface,
    unpinSurface,
    movePinnedSurface,
    setOpen,
    setWidth,
  }), [
    state,
    workspaceId,
    preferences,
    openPrimaryKinds,
    showLauncher,
    openTab,
    openBrowserTab,
    renameBrowserTab,
    closeTab,
    closeInspector,
    setActiveTab,
    activatePrimary,
    closePrimary,
    pinSurface,
    unpinSurface,
    movePinnedSurface,
    setOpen,
    setWidth,
  ]);

  return <WorkspaceSidebarContext.Provider value={value}>{children}</WorkspaceSidebarContext.Provider>;
}

export function useWorkspaceSidebar(): WorkspaceSidebarContextValue {
  const context = useContext(WorkspaceSidebarContext);
  if (!context) throw new Error('useWorkspaceSidebar must be used inside <WorkspaceSidebarProvider>');
  return context;
}

export function useWorkspaceSidebarOptional(): WorkspaceSidebarContextValue | null {
  return useContext(WorkspaceSidebarContext);
}
