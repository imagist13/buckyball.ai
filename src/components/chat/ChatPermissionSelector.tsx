'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CaretDown, NotePencil } from '@/components/ui/icon';
// LockOpen removed — both lock/lock-open render via CodePilotIcon
// `permission` alias; the open state just gets a red color override.
import { CodePilotIcon } from '@/components/ui/semantic-icon';
import { usePanel } from '@/hooks/usePanel';
import type { SessionPermissionProfile } from '@/lib/permission/profile';
import type { ChatRuntime } from '@/lib/chat-runtime-shared';
import {
  resolveAutoReviewDisplay,
  type AutoReviewCapability,
  type AutoReviewProbeState,
} from '@/lib/permission/auto-review-display';
import {
  decodeComposerAccessLevel,
  encodeComposerAccessLevel,
  type ComposerAccessLevel,
} from '@/lib/composer-access-level';

interface ChatPermissionSelectorProps {
  sessionId?: string;
  mode: string;
  onModeChange: (mode: string) => void;
  permissionProfile: SessionPermissionProfile;
  onPermissionChange: (profile: SessionPermissionProfile) => void;
  disabled?: boolean;
  /**
   * The session's effective ChatRuntime. Claude Code and Codex have distinct
   * native reviewer implementations; Native AI SDK remains fail-closed because
   * per-tool approval is not a session-level model reviewer. Absent is treated
   * as Claude Code by the endpoint for back-compat.
   */
  runtime?: ChatRuntime;
}

export function ChatPermissionSelector({
  sessionId,
  mode,
  onModeChange,
  permissionProfile,
  onPermissionChange,
  disabled,
  runtime,
}: ChatPermissionSelectorProps) {
  const { t } = useTranslation();
  const { workingDirectory } = usePanel();
  // Which profile the confirmation dialog is currently asking about. Both
  // elevations get a dialog, but they say different things — auto_review is a
  // reviewer, full_access is a bypass, and the copy is the only place the user
  // learns the difference.
  const [pendingElevation, setPendingElevation] = useState<'auto_review' | 'full_access' | null>(null);
  // 'checking' / 'failed' / 'ready' are tracked as distinct states rather than
  // `capability | null`: collapsing "haven't asked" and "asked and it broke"
  // into one null is what made a failed probe render as a version mismatch.
  const [probe, setProbe] = useState<AutoReviewProbeState>({ status: 'checking' });

  // Re-probed per working directory AND runtime: the external-MCP gate depends
  // on the project's own .mcp.json / .claude settings (not global), and the
  // runtime gate flips the answer entirely for Native / Codex.
  /* eslint-disable react-hooks/set-state-in-effect -- a route change invalidates the previous external capability probe synchronously */
  useEffect(() => {
    let cancelled = false;
    setProbe({ status: 'checking' });
    const params = new URLSearchParams();
    if (workingDirectory) params.set('cwd', workingDirectory);
    if (runtime) params.set('runtime', runtime);
    const query = params.toString() ? `?${params.toString()}` : '';
    fetch(`/api/chat/permission-capability${query}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        if (cancelled) return;
        if (!data?.autoReview) throw new Error('malformed capability payload');
        setProbe({ status: 'ready', capability: data.autoReview as AutoReviewCapability });
      })
      .catch(() => {
        // Probe failed — the option stays disabled AND says so honestly. It
        // must not borrow the SDK-version sentence; we never learned a version.
        if (!cancelled) setProbe({ status: 'failed' });
      });
    return () => { cancelled = true; };
  }, [workingDirectory, runtime]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const autoReviewDisplay = resolveAutoReviewDisplay({ probe, permissionProfile });
  const autoReviewSupported = autoReviewDisplay.selectable;
  const autoReviewNotice = autoReviewDisplay.notice
    ? Object.entries(autoReviewDisplay.notice.params ?? {}).reduce(
        (text, [key, value]) => text.replace(`{${key}}`, value),
        t(autoReviewDisplay.notice.key as TranslationKey),
      )
    : null;

  const decoded = decodeComposerAccessLevel(
    mode,
    permissionProfile,
    probe.status === 'ready'
      ? { autoReviewSupported: probe.capability.supported }
      : undefined,
  );

  const handleSelect = (level: ComposerAccessLevel) => {
    if (level === decoded.level && !decoded.legacyAsk && !decoded.degraded) return;
    if (level === 'auto_review') {
      if (!autoReviewSupported) return;
      setPendingElevation('auto_review');
      return;
    }
    if (level === 'full_access') {
      setPendingElevation('full_access');
      return;
    }
    void applyChange(level);
  };

  const applyChange = async (level: ComposerAccessLevel) => {
    const encoded = encodeComposerAccessLevel(level);
    // No sessionId yet (new chat) — local-only update
    if (!sessionId) {
      onModeChange(encoded.mode);
      onPermissionChange(encoded.permissionProfile);
      return;
    }
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // One validated request prevents a client-visible transient
        // `plan + full_access` or `code + stale-profile` pair between two
        // independent PATCHes. The API validates both values before writing.
        body: JSON.stringify({
          mode: encoded.mode,
          permission_profile: encoded.permissionProfile,
        }),
      });
      if (!res.ok) {
        console.warn(`[ChatPermissionSelector] PATCH failed: ${res.status}`);
        return;
      }
      onModeChange(encoded.mode);
      onPermissionChange(encoded.permissionProfile);
      window.dispatchEvent(new CustomEvent('session-updated'));
    } catch (err) {
      console.warn('[ChatPermissionSelector] PATCH error:', err);
    }
  };

  const isReadOnly = decoded.level === 'read_only';
  const isFullAccess = decoded.level === 'full_access';
  // A session persisted as auto_review that the build can't honour (an older
  // SDK, a downgrade, an external MCP server) is NOT running under a reviewer:
  // the resolver degrades it to 'default' on the wire. Showing 替我审批 here
  // would tell the user a model is checking each request when nothing is — the
  // one lie this feature cannot afford. So the chip reports what is actually in
  // effect and the dropdown explains why. While the probe is still in flight we
  // don't claim a degradation we haven't confirmed (resolveAutoReviewDisplay
  // owns that rule).
  const autoReviewDegraded = autoReviewDisplay.degraded;
  const isAutoReview = decoded.level === 'auto_review' && !autoReviewDegraded;

  const triggerLabel = isReadOnly
    ? t('permission.readOnly' as TranslationKey)
    : isFullAccess
    ? t('permission.fullAccess')
    : isAutoReview
      ? t('permission.autoReview' as TranslationKey)
      // Degraded auto_review reads as the profile it actually runs as.
      : t('permission.default');

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            disabled={disabled}
            className={cn(
              'h-7 rounded-md',
              isFullAccess
                // full_access is a dangerous override — keep the chip
                // visible at full weight. Override ghost's hover so the
                // chip doesn't flash to neutral accent.
                ? 'text-xs font-medium border-status-error-foreground/30 bg-status-error-muted text-status-error-foreground hover:bg-status-error-muted hover:text-status-error-foreground'
                : isAutoReview
                  // auto_review is elevated but NOT dangerous. Keep the
                  // selected trigger in the same muted visual tier as the
                  // adjacent mode/runtime selectors; the confirmation dialog
                  // communicates the elevation without turning this one chip
                  // darker and heavier than the rest of the toolbar.
                  ? 'text-xs font-normal text-muted-foreground'
                  // Default permission sits at the same muted-foreground
                  // grey as the mode select beside it; the only weight
                  // difference is `font-normal` (vs the mode select's
                  // `font-medium`). Going faded was too much — the user
                  // still needs to read the label without squinting.
                  : 'text-xs font-normal text-muted-foreground',
            )}
          >
            {isReadOnly ? (
              <NotePencil size={12} aria-hidden />
            ) : isFullAccess ? (
              <CodePilotIcon name="permission" size={12} className="text-status-error-foreground" aria-hidden />
            ) : (
              <CodePilotIcon name="permission" size={12} aria-hidden />
            )}
            <span>{triggerLabel}</span>
            <CaretDown size={10} className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-64 max-w-[calc(100vw-2rem)]"
        >
          <DropdownMenuItem onClick={() => handleSelect('read_only')} className="items-start py-2">
            <NotePencil size={14} className="mt-0.5" aria-hidden />
            <div className="flex min-w-0 flex-col items-start gap-0.5">
              <span>{t('permission.readOnly' as TranslationKey)}</span>
              <span className="break-words text-[11px] leading-tight text-muted-foreground">
                {t('permission.readOnlyDesc' as TranslationKey)}
              </span>
            </div>
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => handleSelect('default')} className="items-start py-2">
            <CodePilotIcon name="permission" size="sm" className="mt-0.5" aria-hidden />
            <div className="flex min-w-0 flex-col items-start gap-0.5">
              <span>{t('permission.default')}</span>
              <span className="break-words text-[11px] leading-tight text-muted-foreground">
                {t('permission.defaultDesc' as TranslationKey)}
              </span>
              {decoded.legacyAsk && (
                <span className="break-words text-[11px] leading-tight text-status-warning-foreground">
                  {t('permission.legacyAsk' as TranslationKey)}
                </span>
              )}
            </div>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => handleSelect('auto_review')}
            disabled={!autoReviewSupported}
            className="items-start py-2"
          >
            <CodePilotIcon name="permission" size="sm" className="mt-0.5" aria-hidden />
            <div className="flex min-w-0 flex-col items-start gap-0.5">
              <span>{t('permission.autoReview' as TranslationKey)}</span>
              <span className="break-words text-[11px] leading-tight text-muted-foreground">
                {t('permission.autoReviewDesc' as TranslationKey)}
              </span>
              {/* Disabled without a reason is just a dead option — say why.
                  The reason is always a fact we established (probing / probe
                  failed / SDK version / external MCP), never a placeholder. */}
              {autoReviewNotice && (
                <span className="break-words text-[11px] leading-tight text-status-warning-foreground">
                  {autoReviewNotice}
                </span>
              )}
              {/* This session ASKED for auto_review and isn't getting it. The
                  line above says the option is unavailable; this one says the
                  saved choice is not what's running. */}
              {autoReviewDegraded && (
                <span className="break-words text-[11px] leading-tight text-status-warning-foreground">
                  {t('permission.autoReviewDegraded' as TranslationKey)}
                </span>
              )}
            </div>
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => handleSelect('full_access')} className="items-start py-2">
            <CodePilotIcon name="permission" size="sm" className="mt-0.5 text-status-error-foreground" aria-hidden />
            <div className="flex min-w-0 flex-col items-start gap-0.5">
              <span className="text-status-error-foreground">{t('permission.fullAccess')}</span>
              <span className="break-words text-[11px] leading-tight text-status-error-foreground/70">
                {t('permission.fullAccessDesc' as TranslationKey)}
              </span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={pendingElevation !== null} onOpenChange={(open) => !open && setPendingElevation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingElevation === 'full_access'
                ? t('permission.fullAccess')
                : t('permission.autoReview' as TranslationKey)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingElevation === 'full_access'
                ? t('permission.fullAccessWarning')
                : t('permission.autoReviewWarning' as TranslationKey)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              // Only the bypass gets the destructive treatment.
              variant={pendingElevation === 'full_access' ? 'destructive' : 'default'}
              onClick={() => {
                const profile = pendingElevation;
                setPendingElevation(null);
                if (profile) void applyChange(profile);
              }}
            >
              {pendingElevation === 'full_access'
                ? t('permission.fullAccess')
                : t('permission.autoReview' as TranslationKey)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
