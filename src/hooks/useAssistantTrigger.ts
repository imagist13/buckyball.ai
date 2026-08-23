import { useCallback, useEffect, useRef } from 'react';
import type { Message, FileAttachment } from '@/types';
// getLocalDateString removed â€?heartbeat no longer auto-triggers
import { startStream } from '@/lib/stream-session-manager';

// â”€â”€ localStorage heartbeat for cross-tab liveness detection â”€â”€
// The session that owns the onboarding lock writes {sessionId, ts} every 10s.
// Other sessions check this to decide if the owner tab is still alive.
// The heartbeat is scoped: isOwnerAlive(hookTriggeredSessionId) only returns
// true if the heartbeat's sessionId matches, so a stale heartbeat from a
// completed session can't masquerade as a different session's owner.
const HEARTBEAT_KEY = 'codepilot:onboarding-heartbeat';
const HEARTBEAT_INTERVAL = 10_000;   // write every 10s
const HEARTBEAT_STALE_MS = 30_000;   // consider dead after 30s without update

/** Remove the heartbeat key only if it still belongs to the given session. */
function removeHeartbeatIfOwned(sessionId: string): void {
  try {
    const raw = localStorage.getItem(HEARTBEAT_KEY);
    if (!raw) return;
    const { sid } = JSON.parse(raw) as { sid: string };
    if (sid === sessionId) {
      localStorage.removeItem(HEARTBEAT_KEY);
    }
  } catch { /* ignore */ }
}

function startHeartbeat(sessionId: string): () => void {
  if (typeof window === 'undefined') return () => {};
  const write = () => {
    try {
      localStorage.setItem(HEARTBEAT_KEY, JSON.stringify({ sid: sessionId, ts: Date.now() }));
    } catch { /* ignore */ }
  };
  write();
  const id = setInterval(write, HEARTBEAT_INTERVAL);
  return () => {
    clearInterval(id);
    removeHeartbeatIfOwned(sessionId);
  };
}

/** Stop the heartbeat externally (called when onboarding/check-in completes). */
export function clearOnboardingHeartbeat(sessionId?: string): void {
  if (typeof window === 'undefined') return;
  if (sessionId) {
    removeHeartbeatIfOwned(sessionId);
  } else {
    // Legacy fallback: unconditional remove (only when caller doesn't know sessionId)
    try { localStorage.removeItem(HEARTBEAT_KEY); } catch { /* ignore */ }
  }
}

/**
 * Check if the tab owning the given sessionId is still alive.
 * Returns false if the heartbeat is stale, missing, or belongs to a different session.
 */
function isOwnerAlive(expectedSessionId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(HEARTBEAT_KEY);
    if (!raw) return false;
    const { sid, ts } = JSON.parse(raw) as { sid: string; ts: number };
    if (sid !== expectedSessionId) return false;
    return Date.now() - ts < HEARTBEAT_STALE_MS;
  } catch {
    return false;
  }
}

interface UseAssistantTriggerOpts {
  sessionId: string;
  workingDirectory?: string;
  isStreaming: boolean;
  mode: string;
  /**
   * Runtime-filtered resolved pair from useProviderModels. Auto-trigger
   * uses these (not the raw currentModel/currentProviderId) so welcome /
   * heartbeat messages flow through the same runtime gate as user-typed
   * sends â€?otherwise a stale saved provider would silently route past
   * the gate via env-default re-resolution at /api/chat.
   */
  resolvedModel: string;
  resolvedProviderId: string;
  noCompatibleProvider: boolean;
  fetchState: 'idle' | 'loaded' | 'failed';
  initialMessages: Message[];
  handleModeChange: (mode: string) => void;
  buildThinkingConfig: () => { type: string } | undefined;
  // Returns boolean | void â€?false means the send was gated/not delivered
  // (#615 composer-preservation contract). Auto-trigger ignores the result.
  sendMessageRef: React.MutableRefObject<((content: string, files?: FileAttachment[]) => Promise<boolean | void>) | undefined>;
  initMetaRef: React.MutableRefObject<{ tools?: unknown; slash_commands?: unknown; skills?: unknown } | null>;
}

export function useAssistantTrigger({
  sessionId,
  workingDirectory,
  isStreaming,
  mode,
  resolvedModel,
  resolvedProviderId,
  noCompatibleProvider,
  fetchState,
  initialMessages,
  handleModeChange,
  buildThinkingConfig,
  sendMessageRef,
  initMetaRef,
}: UseAssistantTriggerOpts): () => void {
  const assistantTriggerFiredRef = useRef(false);
  const stopHeartbeatRef = useRef<(() => void) | null>(null);

  // Clean up heartbeat on unmount (tab close, navigation away)
  useEffect(() => {
    return () => {
      stopHeartbeatRef.current?.();
      stopHeartbeatRef.current = null;
    };
  }, []);

  // Stop heartbeat when the triggered stream finishes (onboarding/check-in completed or errored).
  // assistantTriggerFiredRef means WE started the stream; !isStreaming means it's done.
  useEffect(() => {
    if (assistantTriggerFiredRef.current && !isStreaming && stopHeartbeatRef.current) {
      stopHeartbeatRef.current();
      stopHeartbeatRef.current = null;
    }
  }, [isStreaming]);

  const checkAssistantTrigger = useCallback(async () => {
    // Don't trigger if already streaming or already triggered in this mount
    if (isStreaming || assistantTriggerFiredRef.current) return;
    // Don't trigger before the runtime-filtered picker feed has loaded â€?    // resolved pair would be the raw saved values, defeating the gate.
    if (fetchState !== 'loaded') return;
    // Don't trigger when no provider is compatible with the active runtime.
    // Welcome / heartbeat would post a stale provider/model that the
    // backend would silently re-resolve to env defaults.
    if (noCompatibleProvider) return;
    if (!resolvedProviderId || !resolvedModel) return;

    try {
      const res = await fetch('/api/settings/workspace');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.path) return;

      // Check if this session's working directory matches workspace path
      if (workingDirectory !== data.path) return;

      const state = data.state;
      if (!state) return;

      // Guard against duplicate triggers across sessions:
      // 1. If ANOTHER session owns the lock, check if its tab is still alive via
      //    localStorage heartbeat. No fixed timeout â€?the heartbeat stops immediately
      //    when the tab closes/crashes, and we detect it within 30s.
      // 2. If THIS session already triggered and has messages, don't re-trigger.
      if (state.hookTriggeredSessionId && state.hookTriggeredSessionId !== sessionId) {
        if (isOwnerAlive(state.hookTriggeredSessionId)) {
          return; // Owning tab is still open, don't interfere
        }
        // Owner tab is gone â€?atomically clear the stale lock (CAS: only if owner
        // is still the stale session we observed).  If another tab already swapped
        // in, the server returns owner_mismatch and we bail out.
        try {
          const clearRes = await fetch('/api/workspace/hook-triggered', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: '__clear__',
              expectedOwner: state.hookTriggeredSessionId,
            }),
          });
          if (clearRes.ok) {
            const clearData = await clearRes.json();
            if (!clearData.success) return; // Another tab won the race
          } else {
            return;
          }
        } catch {
          return; // Can't clear, err on the safe side
        }
      }
      if (state.hookTriggeredSessionId === sessionId && initialMessages.length > 0) return;

      const needsOnboarding = !state.onboardingComplete;

      // Onboarding is now handled by the frontend Wizard component (OnboardingWizard.tsx).
      if (needsOnboarding) return;

      // Codex P1 â€?heartbeat is no longer triggered from the foreground.
      // Earlier rev: chat mount checked `data.needsHeartbeat` and called
      // startStream({content: 'å¿ƒè·³æ£€æŸ?, autoTrigger: true}) which ran a
      // FULL streamClaude turn through /api/chat with every tool the
      // chat had access to (codepilot_list_tasks, Search, memory_recent,
      // shell). Since headless / chat had no idle/tool/total timeout
      // back then, a tool-loop in the heartbeat could leave the
      // assistant session "running" indefinitely. Worse, it fired
      // every time a chat mounted, not on a real interval.
      //
      // The fix is hard: we don't trigger heartbeat from any UI surface
      // anymore. Heartbeat is owned exclusively by the background
      // scheduler (`source='assistant_heartbeat'` task in
      // scheduled_tasks, fired by `executeDueTask` when next_run + the
      // stale-check guard both pass). Page mounts only READ state.
      //
      // Buddy welcome stays â€?it's a one-shot adoption flow, not a
      // recurring background check, and its prompt is plain text with
      // no tools.
      const needsBuddyWelcome = state.onboardingComplete && !state.buddy && initialMessages.length === 0;
      if (!needsBuddyWelcome) return;

      // Mark fired so we don't re-trigger on focus/re-render
      assistantTriggerFiredRef.current = true;

      // Start heartbeat BEFORE marking persistent state â€?so the heartbeat is
      // already running when other tabs check liveness.
      stopHeartbeatRef.current?.();
      stopHeartbeatRef.current = startHeartbeat(sessionId);

      // Mark in persistent state to prevent duplicate triggers across page reloads.
      // CAS: only set owner if currently unowned (null).  If another tab set itself
      // as owner between our clear and this call, the server rejects and we bail.
      try {
        const setRes = await fetch('/api/workspace/hook-triggered', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, expectedOwner: null }),
        });
        // Bail on any non-2xx (including 500) or CAS rejection â€?never
        // proceed to startStream without a confirmed lock.
        if (!setRes.ok) {
          assistantTriggerFiredRef.current = false;
          stopHeartbeatRef.current?.();
          stopHeartbeatRef.current = null;
          return;
        }
        const setData = await setRes.json();
        if (!setData.success) {
          // Lost race â€?another tab claimed ownership
          assistantTriggerFiredRef.current = false;
          stopHeartbeatRef.current?.();
          stopHeartbeatRef.current = null;
          return;
        }
      } catch {
        // Network error â€?bail out
        assistantTriggerFiredRef.current = false;
        stopHeartbeatRef.current?.();
        stopHeartbeatRef.current = null;
        return;
      }

      // Use autoTrigger: the message is invisible (no user bubble, no title update).
      // Only buddy welcome reaches this point; heartbeat is scheduler-only.
      const triggerMsg = 'è¯·åšè‡ªæˆ‘ä»‹ç»å¹¶å¼•å¯¼ç”¨æˆ·é¢†å…»ä¼™ä¼´ã€?;
      startStream({
        sessionId,
        content: triggerMsg,
        mode,
        // Use the runtime-filtered resolved pair, not the raw saved
        // currentModel/currentProviderId â€?same contract as ChatView's
        // user-typed send path.
        model: resolvedModel,
        providerId: resolvedProviderId,
        workingDirectory,
        autoTrigger: true,
        thinking: buildThinkingConfig(),
        onModeChanged: (sdkMode) => {
          const uiMode = sdkMode === 'plan' ? 'plan' : 'code';
          handleModeChange(uiMode);
        },
        sendMessageFn: (retryContent: string, retryFiles?: FileAttachment[]) => {
          sendMessageRef.current?.(retryContent, retryFiles);
        },
        onInitMeta: (meta) => {
          initMetaRef.current = meta;
          console.log('[useAssistantTrigger] SDK init meta received:', meta);
        },
      });
    } catch (e) {
      console.error('[useAssistantTrigger] Assistant auto-trigger failed:', e);
    }
  }, [sessionId, workingDirectory, isStreaming, mode, resolvedModel, resolvedProviderId, noCompatibleProvider, fetchState, handleModeChange, buildThinkingConfig, initialMessages, sendMessageRef, initMetaRef]);

  // Fire with a small delay to let the session fully initialize
  useEffect(() => {
    const timer = setTimeout(checkAssistantTrigger, 500);
    return () => clearTimeout(timer);
  }, [checkAssistantTrigger]);

  return checkAssistantTrigger;
}
