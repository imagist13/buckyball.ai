'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { PushPin } from '@/components/ui/icon';
import { CodePilotIcon } from '@/components/ui/semantic-icon';
import { useWorkspaceSidebar } from '@/hooks/useWorkspaceSidebar';
import { usePanel } from '@/hooks/usePanel';
import {
  previewSourceFromTab,
  type BrowserSurfaceTab,
  type DynamicTab,
} from '@/lib/workspace-sidebar';
import type { PrimarySurfaceKind } from '@/lib/workspace-surfaces';
import { AgentRunPanel } from './AgentRunPanel';
import { useTranslation } from '@/hooks/useTranslation';
import { showToast } from '@/hooks/useToast';
import { useEmbeddedBrowserAvailability } from '@/hooks/useEmbeddedBrowserAvailability';
import type { TranslationKey } from '@/i18n';
import type { CodePilotIconName } from '@/components/ui/semantic-icon';

const GitTabContent = dynamic(
  () => import('@/components/layout/panels/GitPanel').then((module) => ({ default: module.GitTabContent })),
  { ssr: false },
);
const WidgetTabContent = dynamic(
  () => import('@/components/layout/panels/DashboardPanel').then((module) => ({ default: module.WidgetTabContent })),
  { ssr: false },
);
const PreviewPanel = dynamic(
  () => import('@/components/layout/panels/PreviewPanel').then((module) => ({ default: module.PreviewPanel })),
  { ssr: false },
);
const FileTreePanel = dynamic(
  () => import('@/components/layout/panels/FileTreePanel').then((module) => ({ default: module.FileTreePanel })),
  { ssr: false },
);
const BrowserPanel = dynamic(
  () => import('./BrowserPanel').then((module) => ({ default: module.BrowserPanel })),
  { ssr: false },
);

function primaryKindFromState(id: 'git' | 'widget' | 'files-pinned' | 'browser' | 'agents'): PrimarySurfaceKind {
  return id === 'files-pinned' ? 'files' : id;
}

function PrimaryContent({ kind }: { kind: PrimarySurfaceKind }) {
  const { t } = useTranslation();
  if (kind === 'files') return <FileTreePanel />;
  if (kind === 'git') return <GitTabContent />;
  if (kind === 'widget') return <WidgetTabContent />;
  if (kind === 'browser') return null;
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-64">
        <CodePilotIcon name="assistant" size="xl" className="mx-auto mb-3" aria-hidden />
        <p className="text-sm font-medium">{t('workspaceSidebar.tab.agents' as TranslationKey)}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t('workspaceSidebar.agentsHint' as TranslationKey)}
        </p>
      </div>
    </div>
  );
}

function InspectorContent({ tab }: { tab: DynamicTab }) {
  if (tab.kind === 'agent-run') return <AgentRunPanel tab={tab} />;
  return <PreviewPanel variant="sidebar" />;
}

const PRIMARY_MIN_WIDTH = 220;
const INSPECTOR_MIN_WIDTH = 260;
const LANE_DIVIDER_WIDTH = 8;
const PRIMARY_DEFAULT_WIDTH = 280;

function LaneResizeDivider({
  value,
  max,
  onResize,
  onReset,
}: {
  value: number;
  max: number;
  onResize: (delta: number) => void;
  onReset: () => void;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragging.current = true;
    lastX.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);
  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const delta = event.clientX - lastX.current;
    lastX.current = event.clientX;
    onResize(delta);
  }, [onResize]);
  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return (
    <div
      role="separator"
      aria-label="Resize Primary and Inspector"
      aria-orientation="vertical"
      aria-valuemin={PRIMARY_MIN_WIDTH}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      data-inspector-resize-divider
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        onResize(event.key === 'ArrowLeft' ? -16 : 16);
      }}
      className="group flex h-full w-2 shrink-0 cursor-col-resize items-stretch justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className="w-px bg-border transition-colors group-hover:bg-foreground/35" aria-hidden />
    </div>
  );
}

function LauncherCard({
  kind,
  icon,
  title,
  description,
  disabled,
  pinnable = true,
  onOpen,
}: {
  kind?: PrimarySurfaceKind;
  icon?: CodePilotIconName;
  title: string;
  description: string;
  disabled?: boolean;
  pinnable?: boolean;
  onOpen?: () => void;
}) {
  const { activatePrimary, pinSurface } = useWorkspaceSidebar();
  const resolvedIcon = icon ?? (kind === 'files' ? 'file_tree' : kind === 'browser' ? 'web' : 'git');
  return (
    <div
      className="group relative overflow-hidden rounded-xl border bg-background hover:bg-accent/40"
      data-launcher-card
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onOpen ? onOpen() : kind && activatePrimary(kind)}
        className="relative flex min-h-24 w-full items-center justify-center px-4 py-3 text-center disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="absolute left-4 top-4" data-launcher-card-icon>
          <CodePilotIcon name={resolvedIcon} size="lg" aria-hidden />
        </span>
        <span className="block w-full" data-launcher-card-copy>
          <span className="block text-sm font-medium">{title}</span>
          <span
            className="mt-1 block text-xs leading-relaxed text-muted-foreground"
            data-launcher-card-description
          >
            {description}
          </span>
        </span>
      </button>
      {!disabled && pinnable && kind && (
        <button
          type="button"
          onClick={() => pinSurface(kind)}
          className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-background hover:text-foreground group-hover:opacity-100 focus:opacity-100"
          aria-label={`Pin ${title}`}
        >
          <PushPin size={13} />
        </button>
      )}
    </div>
  );
}

function Launcher() {
  const { t } = useTranslation();
  const browserAvailable = useEmbeddedBrowserAvailability();
  const { state, activatePrimary, setActiveTab } = useWorkspaceSidebar();
  const { gitDirtyCount, gitRepositoryState, workingDirectory } = usePanel();
  const [initializingGit, setInitializingGit] = useState(false);
  const activeAgentRun = state.tabs.find((tab): tab is DynamicTab => tab.kind === 'agent-run');
  const handleInitializeGit = useCallback(async () => {
    if (!workingDirectory || initializingGit) return;
    setInitializingGit(true);
    try {
      const response = await fetch('/api/git/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workingDirectory }),
      });
      if (!response.ok) throw new Error('git init failed');
      window.dispatchEvent(new CustomEvent('git-refresh'));
      showToast({ type: 'success', message: t('git.initializeSuccess') });
      activatePrimary('git');
    } catch {
      showToast({ type: 'error', message: t('git.initializeFailed') });
    } finally {
      setInitializingGit(false);
    }
  }, [activatePrimary, initializingGit, t, workingDirectory]);
  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-5">
      <div className="w-full max-w-xl">
        <h3 className="text-center text-sm font-medium">{t('workspaceSidebar.openSurface' as TranslationKey)}</h3>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          {t('workspaceSidebar.openSurfaceDesc' as TranslationKey)}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3" data-launcher-list>
          <LauncherCard
            kind="files"
            title={t('workspaceSidebar.tab.files' as TranslationKey)}
            description={t('workspaceSidebar.filesDesc' as TranslationKey)}
          />
          <LauncherCard
            kind="git"
            title={gitRepositoryState === 'directory'
              ? (initializingGit ? t('git.initializing') : t('git.initialize'))
              : t('workspaceSidebar.tab.git' as TranslationKey)}
            description={gitRepositoryState === 'directory'
              ? t('git.initializeDesc')
              : t('workspaceSidebar.gitDesc' as TranslationKey)}
            disabled={initializingGit}
            onOpen={gitRepositoryState === 'directory' ? handleInitializeGit : undefined}
          />
          <LauncherCard
            kind="browser"
            title={t('workspaceSidebar.tab.browser' as TranslationKey)}
            description={browserAvailable
              ? t('workspaceSidebar.browserDesc' as TranslationKey)
              : t('workspaceSidebar.browserDesktopOnly' as TranslationKey)}
            disabled={!browserAvailable}
          />
          {gitDirtyCount > 0 && (
            <LauncherCard
              icon="preview"
              title={t('workspaceSidebar.tab.diff' as TranslationKey)}
              description={t('workspaceSidebar.diffDesc' as TranslationKey)}
              pinnable={false}
              onOpen={() => activatePrimary('git')}
            />
          )}
          {activeAgentRun && (
            <LauncherCard
              icon="assistant"
              title={t('workspaceSidebar.tab.agents' as TranslationKey)}
              description={t('workspaceSidebar.agentsHint' as TranslationKey)}
              pinnable={false}
              onOpen={() => setActiveTab(activeAgentRun.id)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function TabPanel() {
  const {
    state,
    workspaceId,
    openPrimaryKinds,
    showLauncher,
    closeInspector,
    openBrowserTab,
    renameBrowserTab,
  } = useWorkspaceSidebar();
  const { previewSource, setPreviewSource } = usePanel();
  const inspector = state.activeInspectorId
    ? state.tabs.find((tab): tab is DynamicTab =>
        tab.id === state.activeInspectorId
          && tab.kind !== 'fixed'
          && tab.kind !== 'files-pinned'
          && tab.kind !== 'browser')
    : undefined;
  const browserTabs = state.tabs.filter((tab): tab is BrowserSurfaceTab => tab.kind === 'browser');
  const primaryKind = primaryKindFromState(state.activePrimaryId);
  const hasActivePrimary = openPrimaryKinds.includes(primaryKind)
    && (primaryKind !== 'browser'
      || browserTabs.some((tab) => tab.id === state.activeBrowserTabId));
  const standaloneInspector = state.inspectorOpen && !hasActivePrimary;
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(state.width);
  const [primaryWidth, setPrimaryWidth] = useState(PRIMARY_DEFAULT_WIDTH);
  const layoutWidth = Math.min(state.width, panelWidth);
  const narrowPeek = layoutWidth < 560;
  const primaryMaxWidth = Math.max(
    PRIMARY_MIN_WIDTH,
    layoutWidth - INSPECTOR_MIN_WIDTH - LANE_DIVIDER_WIDTH,
  );
  const effectivePrimaryWidth = Math.min(primaryWidth, primaryMaxWidth);
  const handleLaneResize = useCallback((delta: number) => {
    setPrimaryWidth((current) => Math.max(
      PRIMARY_MIN_WIDTH,
      Math.min(primaryMaxWidth, current + delta),
    ));
  }, [primaryMaxWidth]);

  useEffect(() => {
    const element = panelRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setPanelWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inspector) return;
    const desired = previewSourceFromTab(inspector);
    if (!desired) return;
    if (previewSource && samePreviewSource(previewSource, desired)) return;
    setPreviewSource(desired);
    // Only inspector identity drives this synchronization. Context changes are
    // intentionally excluded to avoid echoing through the open-tab bridge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspector?.id]);

  if (showLauncher && !state.inspectorOpen) return <Launcher />;

  return (
    <div
      ref={panelRef}
      id="workspace-sidebar-tabpanel"
      role="tabpanel"
      tabIndex={0}
      className="relative flex min-h-0 flex-1 overflow-hidden focus-visible:outline-none"
      data-workspace-sidebar-tabpanel
      data-primary-kind={standaloneInspector ? undefined : primaryKind}
      data-inspector-open={state.inspectorOpen || undefined}
      data-inspector-layout={standaloneInspector ? 'standalone' : narrowPeek ? 'peek' : 'split'}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && state.inspectorOpen) {
          event.stopPropagation();
          closeInspector();
        }
      }}
    >
      {!standaloneInspector && (
        <section
          aria-label="Primary workspace surface"
          className={state.inspectorOpen && !narrowPeek
            ? 'flex min-w-[220px] shrink-0 flex-col overflow-hidden'
            : state.inspectorOpen && narrowPeek
              ? 'flex min-w-0 flex-1 flex-col overflow-hidden invisible'
              : 'flex min-w-0 flex-1 flex-col overflow-hidden'}
          style={state.inspectorOpen && !narrowPeek
            ? { flexBasis: effectivePrimaryWidth }
            : undefined}
        >
          {primaryKind !== 'browser' && <PrimaryContent kind={primaryKind} />}
          {browserTabs.map((tab) => {
            const active = primaryKind === 'browser' && state.activeBrowserTabId === tab.id;
            return (
              <div
                key={tab.id}
                className={active ? 'flex h-full min-h-0 flex-col' : 'hidden'}
                aria-hidden={active ? undefined : true}
                data-browser-sidebar-tab={tab.id}
              >
                <BrowserPanel
                  workspaceId={workspaceId}
                  tabId={tab.id}
                  initialUrl={tab.initialUrl}
                  onTitleChange={(title) => renameBrowserTab(tab.id, title)}
                  onOpenUrl={openBrowserTab}
                />
              </div>
            );
          })}
        </section>
      )}

      {state.inspectorOpen && inspector && !standaloneInspector && !narrowPeek && (
        <LaneResizeDivider
          value={effectivePrimaryWidth}
          max={primaryMaxWidth}
          onResize={handleLaneResize}
          onReset={() => setPrimaryWidth(PRIMARY_DEFAULT_WIDTH)}
        />
      )}

      {state.inspectorOpen && inspector && (
        <section
          aria-label="Inspector"
          className={standaloneInspector || narrowPeek
            ? 'absolute inset-0 z-10 flex min-w-0 flex-col overflow-hidden bg-background'
            : 'flex min-w-[260px] flex-1 flex-col overflow-hidden'}
        >
          <InspectorContent tab={inspector} />
        </section>
      )}
    </div>
  );
}

function samePreviewSource(
  a: NonNullable<ReturnType<typeof usePanel>['previewSource']>,
  b: NonNullable<ReturnType<typeof previewSourceFromTab>>,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'file' && b.kind === 'file') return a.filePath === b.filePath;
  if (a.kind === 'inline-html' && b.kind === 'inline-html') return a.html === b.html && a.virtualName === b.virtualName;
  if (a.kind === 'inline-jsx' && b.kind === 'inline-jsx') return a.jsx === b.jsx && a.virtualName === b.virtualName;
  if (a.kind === 'inline-datatable' && b.kind === 'inline-datatable') return a.virtualName === b.virtualName;
  return false;
}
