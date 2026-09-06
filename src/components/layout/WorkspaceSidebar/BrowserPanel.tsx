'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CodePilotIcon } from '@/components/ui/semantic-icon';
import { useEmbeddedBrowserAvailability } from '@/hooks/useEmbeddedBrowserAvailability';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import {
  classifyBrowserUrl,
  resolveBrowserAddressInput,
  type BrowserNavigationBlockReason,
} from '@/lib/browser-url-policy';

interface ElectronWebview extends HTMLWebViewElement {
  loadURL: (url: string) => Promise<void>;
  getWebContentsId: () => number;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  stop: () => void;
}

type BrowserPanelError = BrowserNavigationBlockReason
  | 'load_failed'
  | 'guest_crashed'
  | 'download_blocked';

interface BrowserViewState {
  url: string;
  input: string;
  requestedUrl: string;
  loadToken: number;
  generation: number;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error?: BrowserPanelError;
}

interface BrowserConfig {
  partition: string;
  webPreferences: string;
}

type WebviewNavigationEvent = Event & {
  url?: string;
  title?: string;
  isMainFrame?: boolean;
  errorCode?: number;
};

function createBrowserViewState(initialUrl?: string): BrowserViewState {
  const decision = initialUrl ? classifyBrowserUrl(initialUrl) : classifyBrowserUrl('about:blank');
  const url = decision.allowed ? decision.url : 'about:blank';
  return {
    url: 'about:blank',
    input: url === 'about:blank' ? '' : url,
    requestedUrl: url,
    loadToken: url === 'about:blank' ? 0 : 1,
    generation: 0,
    loading: url !== 'about:blank',
    canGoBack: false,
    canGoForward: false,
  };
}

function guestNavigationState(guest: ElectronWebview): Pick<BrowserViewState, 'canGoBack' | 'canGoForward'> {
  try {
    return { canGoBack: guest.canGoBack(), canGoForward: guest.canGoForward() };
  } catch {
    return { canGoBack: false, canGoForward: false };
  }
}

function errorTranslationKey(error: BrowserPanelError): TranslationKey {
  if (error === 'insecure_remote_http') return 'browser.error.insecureHttp' as TranslationKey;
  if (error === 'unsupported_scheme') return 'browser.error.unsupportedScheme' as TranslationKey;
  if (error === 'embedded_credentials') return 'browser.error.embeddedCredentials' as TranslationKey;
  if (error === 'guest_crashed') return 'browser.error.crashed' as TranslationKey;
  if (error === 'download_blocked') return 'browser.error.downloadBlocked' as TranslationKey;
  if (error === 'load_failed') return 'browser.error.loadFailed' as TranslationKey;
  return 'browser.error.invalidUrl' as TranslationKey;
}

export function BrowserPanel({
  workspaceId,
  tabId,
  initialUrl,
  onTitleChange,
  onOpenUrl,
}: {
  workspaceId?: string;
  tabId: string;
  initialUrl?: string;
  onTitleChange?: (title: string) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const { t } = useTranslation();
  const browserAvailable = useEmbeddedBrowserAvailability();
  const [configResult, setConfigResult] = useState<{
    workspaceId: string;
    config: BrowserConfig;
  } | null>(null);
  const [failedWorkspaceId, setFailedWorkspaceId] = useState<string | null>(null);
  const [view, setView] = useState<BrowserViewState>(() => createBrowserViewState(initialUrl));
  const guestRef = useRef<ElectronWebview | null>(null);
  const webContentsIdRef = useRef<number | null>(null);
  const onTitleChangeRef = useRef(onTitleChange);
  const onOpenUrlRef = useRef(onOpenUrl);

  useEffect(() => { onTitleChangeRef.current = onTitleChange; }, [onTitleChange]);
  useEffect(() => { onOpenUrlRef.current = onOpenUrl; }, [onOpenUrl]);

  const setGuestRef = useCallback((node: HTMLElement | null) => {
    guestRef.current = node as ElectronWebview | null;
    if (!node) webContentsIdRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!workspaceId || !browserAvailable || !window.electronAPI?.browser) return;
    void window.electronAPI.browser.getConfig(workspaceId).then((next) => {
      if (cancelled) return;
      if (next) {
        setConfigResult({ workspaceId, config: next });
        setFailedWorkspaceId(null);
      } else {
        setFailedWorkspaceId(workspaceId);
      }
    }).catch(() => {
      if (!cancelled) setFailedWorkspaceId(workspaceId);
    });
    return () => { cancelled = true; };
  }, [browserAvailable, workspaceId]);

  useEffect(() => {
    const api = window.electronAPI?.browser;
    if (!api) return;
    const ownsEvent = (webContentsId: number) => webContentsIdRef.current === webContentsId;
    const removeBlocked = api.onNavigationBlocked(({ webContentsId, reason }) => {
      if (!ownsEvent(webContentsId)) return;
      const allowedReasons: BrowserNavigationBlockReason[] = [
        'invalid_url', 'unsupported_scheme', 'insecure_remote_http', 'embedded_credentials',
      ];
      const normalized = allowedReasons.includes(reason as BrowserNavigationBlockReason)
        ? reason as BrowserNavigationBlockReason
        : 'invalid_url';
      setView((current) => ({ ...current, loading: false, error: normalized }));
    });
    const removePopup = api.onOpenUrlRequested(({ webContentsId, url }) => {
      if (!ownsEvent(webContentsId) || !classifyBrowserUrl(url).allowed) return;
      onOpenUrlRef.current?.(url);
    });
    const removeDownload = api.onDownloadBlocked(({ webContentsId }) => {
      if (!ownsEvent(webContentsId)) return;
      setView((current) => ({ ...current, loading: false, error: 'download_blocked' }));
    });
    return () => {
      removeBlocked();
      removePopup();
      removeDownload();
    };
  }, []);

  const config = configResult && configResult.workspaceId === workspaceId
    ? configResult.config
    : null;
  const configFailed = !workspaceId
    || !browserAvailable
    || failedWorkspaceId === workspaceId;

  useEffect(() => {
    const guest = guestRef.current;
    if (!config || !guest) return;

    const syncAttached = () => {
      try {
        webContentsIdRef.current = guest.getWebContentsId();
      } catch {
        webContentsIdRef.current = null;
      }
    };
    const handleStart = () => setView((current) => ({
      ...current,
      loading: true,
      error: undefined,
    }));
    const handleStop = () => setView((current) => ({
      ...current,
      loading: false,
      ...guestNavigationState(guest),
    }));
    const handleNavigate = (event: Event) => {
      const targetUrl = (event as WebviewNavigationEvent).url;
      if (!targetUrl) return;
      setView((current) => ({
        ...current,
        url: targetUrl,
        input: targetUrl === 'about:blank' ? '' : targetUrl,
        error: undefined,
        ...guestNavigationState(guest),
      }));
    };
    const handleTitle = (event: Event) => {
      const title = (event as WebviewNavigationEvent).title?.trim().slice(0, 80);
      if (title) onTitleChangeRef.current?.(title);
    };
    const handleFail = (event: Event) => {
      const failure = event as WebviewNavigationEvent;
      if (failure.isMainFrame === false || failure.errorCode === -3) return;
      setView((current) => ({ ...current, loading: false, error: 'load_failed' }));
    };
    const handleCrash = () => setView((current) => ({
      ...current,
      loading: false,
      error: 'guest_crashed',
    }));

    guest.addEventListener('did-attach', syncAttached);
    guest.addEventListener('dom-ready', syncAttached);
    guest.addEventListener('did-start-loading', handleStart);
    guest.addEventListener('did-stop-loading', handleStop);
    guest.addEventListener('did-navigate', handleNavigate);
    guest.addEventListener('did-navigate-in-page', handleNavigate);
    guest.addEventListener('page-title-updated', handleTitle);
    guest.addEventListener('did-fail-load', handleFail);
    guest.addEventListener('render-process-gone', handleCrash);
    syncAttached();
    return () => {
      guest.removeEventListener('did-attach', syncAttached);
      guest.removeEventListener('dom-ready', syncAttached);
      guest.removeEventListener('did-start-loading', handleStart);
      guest.removeEventListener('did-stop-loading', handleStop);
      guest.removeEventListener('did-navigate', handleNavigate);
      guest.removeEventListener('did-navigate-in-page', handleNavigate);
      guest.removeEventListener('page-title-updated', handleTitle);
      guest.removeEventListener('did-fail-load', handleFail);
      guest.removeEventListener('render-process-gone', handleCrash);
    };
  }, [config, view.generation]);

  useEffect(() => {
    const guest = guestRef.current;
    if (!config || !guest || view.loadToken === 0) return;
    let cancelled = false;
    void guest.loadURL(view.requestedUrl).catch(() => {
      if (!cancelled) {
        setView((current) => ({ ...current, loading: false, error: 'load_failed' }));
      }
    });
    return () => { cancelled = true; };
  }, [config, view.generation, view.loadToken, view.requestedUrl]);

  const navigate = useCallback(() => {
    const decision = resolveBrowserAddressInput(view.input);
    if (!decision.allowed) {
      setView((current) => ({ ...current, loading: false, error: decision.reason }));
      return;
    }
    setView((current) => ({
      ...current,
      requestedUrl: decision.url,
      loadToken: current.loadToken + 1,
      loading: true,
      error: undefined,
    }));
  }, [view.input]);

  const retry = useCallback(() => {
    setView((current) => {
      const targetUrl = current.url !== 'about:blank' ? current.url : current.requestedUrl;
      return {
        ...current,
        generation: current.error === 'guest_crashed' ? current.generation + 1 : current.generation,
        requestedUrl: targetUrl,
        loadToken: current.loadToken + 1,
        loading: true,
        error: undefined,
      };
    });
  }, []);

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center" data-browser-surface-unavailable>
        <div className="max-w-64">
          <CodePilotIcon name="web" size="xl" className="mx-auto mb-3" aria-hidden />
          <p className="text-sm font-medium">{t('workspaceSidebar.tab.browser' as TranslationKey)}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {configFailed
              ? t('workspaceSidebar.browserDesktopOnly' as TranslationKey)
              : t('browser.preparing' as TranslationKey)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-browser-surface data-browser-single-page={tabId}>
      <form
        className="flex h-10 shrink-0 items-center gap-1 border-b px-2"
        onSubmit={(event) => { event.preventDefault(); navigate(); }}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!view.canGoBack}
          onClick={() => guestRef.current?.goBack()}
          aria-label={t('browser.back' as TranslationKey)}
        >
          <CodePilotIcon name="back" size="sm" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!view.canGoForward}
          onClick={() => guestRef.current?.goForward()}
          aria-label={t('browser.forward' as TranslationKey)}
        >
          <CodePilotIcon name="forward" size="sm" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            if (view.loading) guestRef.current?.stop();
            else guestRef.current?.reload();
          }}
          aria-label={view.loading
            ? t('browser.stop' as TranslationKey)
            : t('browser.reload' as TranslationKey)}
        >
          <CodePilotIcon name={view.loading ? 'stop' : 'refresh'} size="sm" className={view.loading ? 'text-muted-foreground' : undefined} aria-hidden />
        </Button>
        <Input
          value={view.input}
          onChange={(event) => setView((current) => ({ ...current, input: event.target.value }))}
          placeholder={t('browser.addressPlaceholder' as TranslationKey)}
          aria-label={t('browser.address' as TranslationKey)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded-md border bg-muted/25 px-2.5 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/30"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={view.url === 'about:blank'}
          onClick={() => {
            if (view.url !== 'about:blank') {
              void window.electronAPI?.browser?.openExternal(view.url);
            }
          }}
          aria-label={t('browser.openExternal' as TranslationKey)}
        >
          <CodePilotIcon name="external" size="sm" aria-hidden />
        </Button>
      </form>

      <div
        className="relative h-0.5 shrink-0 overflow-hidden"
        role={view.loading ? 'progressbar' : undefined}
        aria-label={view.loading ? t('browser.loading' as TranslationKey) : undefined}
        data-browser-progress={view.loading || undefined}
      >
        {view.loading && (
          <span className="browser-loading-progress absolute inset-y-0 left-0 w-2/5 bg-primary" />
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        <webview
          key={view.generation}
          ref={setGuestRef}
          src="about:blank"
          partition={config.partition}
          webpreferences={config.webPreferences}
          allowpopups
          data-browser-guest={tabId}
          className="flex h-full w-full bg-background"
        />
        {view.url === 'about:blank' && !view.loading && !view.error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center" data-browser-empty>
            <div className="max-w-64">
              <CodePilotIcon name="web" size="xl" className="mx-auto mb-3 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">{t('browser.emptyTitle' as TranslationKey)}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('browser.emptyDescription' as TranslationKey)}</p>
            </div>
          </div>
        )}
        {view.error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background p-6 text-center" data-browser-error={view.error}>
            <div className="max-w-72">
              <CodePilotIcon name="warning" size="xl" className="mx-auto mb-3 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">{t('browser.error.title' as TranslationKey)}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t(errorTranslationKey(view.error))}
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={retry}>
                {t('browser.retry' as TranslationKey)}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
