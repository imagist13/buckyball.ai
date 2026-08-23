'use client';

import { useEffect, useState, useRef, use } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Message, MessagesResponse, ChatSession } from '@/types';
import { normalizePermissionProfile, type SessionPermissionProfile } from '@/lib/permission/profile';
import { ChatView } from '@/components/chat/ChatView';
import { SpinnerGap } from "@/components/ui/icon";
import { usePanel } from '@/hooks/usePanel';
import { useWorkspaceSidebarOptional } from '@/hooks/useWorkspaceSidebar';
import { useTranslation } from '@/hooks/useTranslation';
import { getSnapshot, seedSnapshotPatch } from '@/lib/stream-session-manager';
import { subscribeSessionTitle } from '@/lib/session-title-events';
import { reconcilePhase } from '@/lib/stream-phase-reconcile';

interface ChatSessionPageProps {
  params: Promise<{ id: string }>;
}

export default function ChatSessionPage({ params }: ChatSessionPageProps) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionModel, setSessionModel] = useState<string>('');
  const [sessionProviderId, setSessionProviderId] = useState<string>('');
  // Phase 2 Step 3b: session's runtime pin (chat-runtime label form).
  // '' = follow global; 'claude_code' / 'bbagent' = pinned.
  // Threaded into ChatView so the picker filters per-session, not per
  // global agent_runtime.
  const [sessionRuntimePin, setSessionRuntimePin] = useState<string>('');
  const [sessionInfoLoaded, setSessionInfoLoaded] = useState(false);
  const [sessionPermissionProfile, setSessionPermissionProfile] = useState<SessionPermissionProfile>('default');
  const [sessionMode, setSessionMode] = useState<'code' | 'plan'>('code');
  const [sessionHasSummary, setSessionHasSummary] = useState(false);
  const { setWorkingDirectory, setSessionId, setSessionTitle: setPanelSessionTitle, setFileTreeOpen } = usePanel();
  const ws = useWorkspaceSidebarOptional();
  const targetFilePath = searchParams.get('file') || undefined;
  const { t } = useTranslation();
  const defaultPanelAppliedRef = useRef(false);

  // Load session info and set working directory
  useEffect(() => {
    let cancelled = false;
    // Clear stale state immediately so ChatView doesn't inherit previous session's values
    setWorkingDirectory('');
    setSessionModel('');
    setSessionProviderId('');
    setSessionRuntimePin('');
    setSessionInfoLoaded(false);

    async function loadSession() {
      try {
        const sessionRes = await fetch(`/api/chat/sessions/${id}`);
        if (cancelled) return;
        if (sessionRes.ok) {
          const data: { session: ChatSession } = await sessionRes.json();
          if (cancelled) return;
          if (data.session.working_directory) {
            setWorkingDirectory(data.session.working_directory);
            localStorage.setItem("codepilot:last-working-directory", data.session.working_directory);
            window.dispatchEvent(new Event('refresh-file-tree'));
          }
          setSessionId(id);
          const title = data.session.title || t('chat.newConversation');
          setPanelSessionTitle(title);

          // Resolve model: session → global default → provider's first → localStorage → 'sonnet'
          const { resolveSessionModel } = await import('@/lib/resolve-session-model');
          if (cancelled) return;
          const resolved = await resolveSessionModel(data.session.model || '', data.session.provider_id || '');
          if (cancelled) return;
          setSessionModel(resolved.model);
          setSessionProviderId(resolved.providerId);
          setSessionRuntimePin(data.session.runtime_pin || '');
          setSessionPermissionProfile(normalizePermissionProfile(data.session.permission_profile));
          setSessionMode((data.session.mode as 'code' | 'plan') || 'code');
          setSessionHasSummary(!!data.session.context_summary);

          // Interrupt/phase reconcile — reconcile the client stream phase against the
          // authoritative backend runtime_status on mount (I2). This corrects a
          // client snapshot left stuck 'active' after the backend already reached
          // a terminal status (idle / interrupted / error) — the "假 active" split
          // that keeps the composer locked (isStreaming ≡ phase==='active',
          // GitHub #578). We converge to a TERMINAL phase only: we do NOT
          // fabricate a reader-less 'active' snapshot for the inverse case
          // (backend running but no live local stream), because a fresh JS
          // context can't resume the server turn and seeding 'active' with no
          // reader is exactly the #578 strand. Mount-read only — no active-period
          // poll (DP2).
          const localPhase = getSnapshot(id)?.phase;
          if (localPhase === 'active') {
            const next = reconcilePhase(data.session.runtime_status, localPhase);
            if (next && next !== 'active') {
              seedSnapshotPatch(id, { phase: next });
            }
          }
        }
      } catch {
        // Session info load failed - panel will still work without directory
      } finally {
        if (!cancelled) setSessionInfoLoaded(true);
      }
    }

    loadSession();
    return () => { cancelled = true; };
  }, [id, setWorkingDirectory, setSessionId, setPanelSessionTitle, t]);

  // Keep the top bar's title live. The effect above reads the title exactly
  // once on mount, so before this the first message's fallback title (written
  // server-side, after mount) never reached the top bar — it kept showing
  // "New Chat" for the rest of the session.
  useEffect(() => {
    return subscribeSessionTitle(id, (title) => setPanelSessionTitle(title));
  }, [id, setPanelSessionTitle]);

  useEffect(() => {
    // Reset state when switching sessions
    defaultPanelAppliedRef.current = false;
    setLoading(true);
    setError(null);
    setMessages([]);
    setHasMore(false);

    let cancelled = false;

    async function loadMessages() {
      try {
        const res = await fetch(`/api/chat/sessions/${id}/messages?limit=30`);
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 404) {
            setError('Session not found');
            return;
          }
          throw new Error('Failed to load messages');
        }
        const data: MessagesResponse = await res.json();
        if (cancelled) return;
        setMessages(data.messages);
        setHasMore(data.hasMore ?? false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load messages');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMessages();

    return () => { cancelled = true; };
  }, [id]);

  // Auto-open file tree when jumping from a file search result
  useEffect(() => {
    if (targetFilePath) {
      setFileTreeOpen(true);
    }
  }, [targetFilePath, setFileTreeOpen]);

  // Auto-open default panel the first time a session is ever opened.
  // Uses sessionStorage to track which sessions have already been initialized,
  // so re-opening an untouched (zero-message) session won't override the layout.
  useEffect(() => {
    if (defaultPanelAppliedRef.current) return;
    defaultPanelAppliedRef.current = true;

    const storageKey = `codepilot:panel-init:${id}`;
    if (typeof window !== 'undefined' && sessionStorage.getItem(storageKey)) return;

    if (typeof window !== 'undefined') {
      sessionStorage.setItem(storageKey, '1');
    }

    (async () => {
      try {
        if (targetFilePath) {
          // Preserve explicit deep-link intent from global search —
          // file tree opens lightweight; sidebar stays as the user
          // last left it (they're independent inputs per Phase 2).
          setFileTreeOpen(true);
          return;
        }
        const res = await fetch('/api/settings/app');
        if (!res.ok) return;
        const data = await res.json();
        const panel = data.settings?.default_panel || 'file_tree';
        // Phase 2 (2026-04-30) migration: 'git' and 'dashboard'
        // defaults used to flip dedicated PanelZone panels — those
        // panels were folded into the Workspace Sidebar as fixed Tabs.
        // Translate the legacy setting into "open the sidebar with
        // that Tab active". 'file_tree' still opens the lightweight
        // panel; 'none' opens nothing. Mutual exclusion (sidebar vs
        // file tree) is enforced as side-effect: opening one path
        // means we don't open the other.
        if (panel === 'none') {
          setFileTreeOpen(false);
          if (ws) ws.setOpen(false);
        } else if (panel === 'file_tree') {
          setFileTreeOpen(true);
          if (ws) ws.setOpen(false);
        } else if (panel === 'git' && ws) {
          setFileTreeOpen(false);
          ws.setActiveTab('git');  // setActiveTab also flips open=true
        } else if (panel === 'dashboard' && ws) {
          setFileTreeOpen(false);
          ws.setActiveTab('widget');
        } else {
          // Unknown setting or sidebar provider missing → safe default.
          setFileTreeOpen(true);
        }
      } catch {
        setFileTreeOpen(true);
      }
    })();
    // ws.setActiveTab / ws.setOpen are stable callbacks from the
    // provider; intentionally tracked via the `ws` reference identity
    // rather than the inner functions to avoid noisy re-runs on every
    // sidebar state change. (deps are complete — no suppression needed.)
  }, [id, targetFilePath, setFileTreeOpen, ws]);

  if (loading || !sessionInfoLoaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <SpinnerGap size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-destructive font-medium">{error}</p>
          <Link href="/chat" className="text-sm text-muted-foreground hover:underline">
            Start a new chat
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatView key={id} sessionId={id} initialMessages={messages} initialHasMore={hasMore} modelName={sessionModel} providerId={sessionProviderId} runtimePin={sessionRuntimePin} initialPermissionProfile={sessionPermissionProfile} initialMode={sessionMode} initialHasSummary={sessionHasSummary} />
    </div>
  );
}
