'use client';

import { Plus, PushPin, X } from '@/components/ui/icon';
import { CodePilotIcon } from '@/components/ui/semantic-icon';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { useWorkspaceSidebar } from '@/hooks/useWorkspaceSidebar';
import {
  MAX_BROWSER_SURFACE_TABS,
  type BrowserSurfaceTab,
  type DynamicTab,
} from '@/lib/workspace-sidebar';
import type { PrimarySurfaceKind } from '@/lib/workspace-surfaces';
import { FileTypeIcon } from '@/components/ui/FileTypeIcon';
import { useEmbeddedBrowserAvailability } from '@/hooks/useEmbeddedBrowserAvailability';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface TabBarProps {
  className?: string;
}

type PrimaryTabEntry =
  | { id: string; kind: Exclude<PrimarySurfaceKind, 'browser'> }
  | { id: string; kind: 'browser'; tab: BrowserSurfaceTab };

function primaryLabel(kind: PrimarySurfaceKind, t: (key: TranslationKey) => string): string {
  if (kind === 'files') return t('workspaceSidebar.tab.files' as TranslationKey);
  if (kind === 'git') return t('workspaceSidebar.tab.git' as TranslationKey);
  if (kind === 'widget') return t('workspaceSidebar.tab.widget' as TranslationKey);
  if (kind === 'browser') return t('workspaceSidebar.tab.browser' as TranslationKey);
  return t('workspaceSidebar.tab.agents' as TranslationKey);
}

function primaryIcon(kind: PrimarySurfaceKind) {
  const name = kind === 'files'
    ? 'file_tree'
    : kind === 'widget'
      ? 'widget'
      : kind === 'browser'
        ? 'web'
        : kind === 'agents'
          ? 'assistant'
          : 'git';
  return <CodePilotIcon name={name} size="md" className="text-inherit" aria-hidden />;
}

function inspectorLabel(tab: DynamicTab): string {
  return tab.kind === 'agent-run' ? tab.run.agentName : tab.title;
}

function inspectorIcon(tab: DynamicTab) {
  if (tab.kind === 'markdown' || tab.kind === 'file') return <FileTypeIcon filePath={tab.filePath} />;
  if (tab.kind === 'agent-run') return <CodePilotIcon name={tab.run.icon} size="md" aria-hidden />;
  return <CodePilotIcon name="artifact" size="md" aria-hidden />;
}

export function TabBar({ className }: TabBarProps) {
  const {
    state,
    preferences,
    openPrimaryKinds,
    activatePrimary,
    openBrowserTab,
    closePrimary,
    pinSurface,
    unpinSurface,
    movePinnedSurface,
    setActiveTab,
    closeTab,
  } = useWorkspaceSidebar();
  const { t } = useTranslation();
  const browserAvailable = useEmbeddedBrowserAvailability();
  const activePrimary = state.activePrimaryId === 'files-pinned'
    ? 'files'
    : state.activePrimaryId;
  const browserTabs = state.tabs.filter((tab): tab is BrowserSurfaceTab => tab.kind === 'browser');
  const primaryEntries: PrimaryTabEntry[] = preferences.order.flatMap((kind): PrimaryTabEntry[] => {
    if (kind === 'browser') {
      return browserTabs.map((tab) => ({ id: tab.id, kind: 'browser', tab }));
    }
    return openPrimaryKinds.includes(kind) ? [{ id: kind, kind }] : [];
  });
  const addablePrimary = preferences.order.filter((kind) =>
    kind === 'browser' || !openPrimaryKinds.includes(kind));
  const inspectorTabs = state.tabs.filter((tab): tab is DynamicTab =>
    tab.kind !== 'fixed' && tab.kind !== 'files-pinned' && tab.kind !== 'browser');
  const activePinned = preferences.pinnedKinds.includes(activePrimary);
  const hasAgentRun = state.tabs.some((tab) => tab.kind === 'agent-run');

  return (
    <div className={cn('flex shrink-0 items-center gap-1 px-2 pb-2 pt-1.5', className)}>
      <div
        role="tablist"
        aria-label={t('workspaceSidebar.toggle' as TranslationKey)}
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        data-workspace-sidebar-tabbar
      >
        {primaryEntries.map((entry) => {
          const kind = entry.kind;
          const active = kind === 'browser'
            ? activePrimary === 'browser'
              && state.activeBrowserTabId === entry.id
              && !state.inspectorOpen
            : kind === activePrimary && !state.inspectorOpen;
          const label = kind === 'browser' && entry.tab.title !== 'Browser'
            ? entry.tab.title
            : primaryLabel(kind, t);
          return (
            <div
              key={entry.id}
              className={cn(
                'group flex h-8 shrink-0 items-center rounded-full text-xs text-muted-foreground',
                active ? 'bg-muted text-foreground' : 'hover:bg-muted/50 hover:text-foreground',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => kind === 'browser'
                  ? setActiveTab(entry.id)
                  : activatePrimary(kind)}
                onKeyDown={(event) => {
                  if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
                  event.preventDefault();
                  movePinnedSurface(kind, event.key === 'ArrowLeft' ? -1 : 1);
                }}
                title={preferences.pinnedKinds.includes(kind)
                  ? t('workspaceSidebar.reorderHint' as TranslationKey)
                  : undefined}
                className="flex h-full items-center gap-1.5 pl-3 pr-1"
              >
                {primaryIcon(kind)}
                <span>{label}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (kind !== 'browser') {
                    closePrimary(kind);
                    return;
                  }
                  closeTab(entry.id);
                  if (browserTabs.length === 1) closePrimary('browser');
                }}
                className={cn(
                  'mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-background focus:opacity-100',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
                aria-label={t('workspaceSidebar.closeTabNamed' as TranslationKey, { name: label })}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}

        {primaryEntries.length > 0 && inspectorTabs.length > 0 && (
          <span className="mx-1 h-5 border-l" aria-hidden data-tab-lane-divider />
        )}
        {inspectorTabs.map((tab) => {
          const active = state.inspectorOpen && tab.id === state.activeInspectorId;
          return (
            <div
              key={tab.id}
              className={cn(
                'group flex h-8 min-w-20 max-w-40 items-center rounded-full text-xs',
                active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2"
              >
                {inspectorIcon(tab)}
                <span className="truncate">{inspectorLabel(tab)}</span>
              </button>
              <button
                type="button"
                onClick={() => closeTab(tab.id)}
                className={cn(
                  'mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-background focus:opacity-100',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
                aria-label={t('workspaceSidebar.closeTabNamed' as TranslationKey, { name: inspectorLabel(tab) })}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('workspaceSidebar.addSurface' as TranslationKey)}
            title={t('workspaceSidebar.addSurface' as TranslationKey)}
          >
            <Plus size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {addablePrimary.length === 0 ? (
            <DropdownMenuItem disabled>
              {t('workspaceSidebar.noMoreSurfaces' as TranslationKey)}
            </DropdownMenuItem>
          ) : addablePrimary.map((kind) => {
            const browserLimitReached = kind === 'browser'
              && browserTabs.length >= MAX_BROWSER_SURFACE_TABS;
            const unavailable = (kind === 'browser' && (!browserAvailable || browserLimitReached))
              || (kind === 'agents' && !hasAgentRun);
            const label = primaryLabel(kind, t);
            return (
              <DropdownMenuItem
                key={kind}
                disabled={unavailable}
                onSelect={() => kind === 'browser' ? openBrowserTab() : activatePrimary(kind)}
                className="items-start py-2"
                title={kind === 'browser' && unavailable
                  ? browserLimitReached
                    ? t('browser.maxTabs' as TranslationKey)
                    : t('workspaceSidebar.browserDesktopOnly' as TranslationKey)
                  : kind === 'agents' && !hasAgentRun
                    ? t('workspaceSidebar.agentsHint' as TranslationKey)
                    : undefined}
              >
                {primaryIcon(kind)}
                <span className="min-w-0">
                  <span className="block text-sm">{label}</span>
                  {unavailable && (
                    <span className="block max-w-48 text-[10px] leading-tight text-muted-foreground">
                      {kind === 'browser'
                        ? browserLimitReached
                          ? t('browser.maxTabs' as TranslationKey)
                          : t('workspaceSidebar.browserDesktopOnly' as TranslationKey)
                        : t('workspaceSidebar.agentsHint' as TranslationKey)}
                    </span>
                  )}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {openPrimaryKinds.includes(activePrimary) && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => activePinned ? unpinSurface(activePrimary) : pinSurface(activePrimary)}
          aria-label={activePinned
            ? t('workspaceSidebar.unpinSurface' as TranslationKey)
            : t('workspaceSidebar.pinSurface' as TranslationKey)}
          title={activePinned
            ? t('workspaceSidebar.unpinSurface' as TranslationKey)
            : t('workspaceSidebar.pinSurface' as TranslationKey)}
        >
          <PushPin size={14} weight={activePinned ? 'fill' : 'regular'} />
        </Button>
      )}
    </div>
  );
}
