"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SpinnerGap, CheckCircle } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import { NATIVE_NOTIFICATION_ERROR } from "@/lib/notification-error-codes";

// ── Onboarding Status Card ──

interface OnboardingCardProps {
  onboardingComplete: boolean;
  creatingSession: boolean;
  onStartOnboarding: () => void;
}

export function OnboardingCard({ onboardingComplete, creatingSession, onStartOnboarding }: OnboardingCardProps) {
  const { t } = useTranslation();

  // When complete: compact one-line status
  if (onboardingComplete) {
    return (
      <div className="rounded-lg border border-border/50 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle size={14} className="text-status-success-foreground" />
          <span className="text-xs text-status-success-foreground">{t('assistant.configured')}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 h-auto p-0"
          onClick={onStartOnboarding}
          disabled={creatingSession}
        >
          {creatingSession ? (
            <SpinnerGap size={12} className="animate-spin" />
          ) : (
            t('assistant.reconfigure')
          )}
        </Button>
      </div>
    );
  }

  // When not complete: full card with Wizard button
  return (
    <div className="rounded-lg bg-card border border-border/50 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium">{t('assistant.onboardingTitle')}</h2>
          <p className="text-xs text-muted-foreground mt-1">{t('assistant.onboardingDesc')}</p>
          <p className="text-xs mt-1">
            <span className="text-status-warning-foreground">{t('assistant.onboardingNotStarted')}</span>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onStartOnboarding}
          disabled={creatingSession}
        >
          {creatingSession ? (
            <SpinnerGap size={14} className="animate-spin" />
          ) : (
            t('assistant.startOnboarding')
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Heartbeat Card ──

interface CheckInCardProps {
  autoTriggerEnabled: boolean;
  onAutoTriggerChange: (enabled: boolean) => void;
  /**
   * Phase 3 Step 4 — heartbeat interval (in hours). When set the
   * select control is rendered below the description; when undefined
   * the control hides (e.g. legacy callers that don't supply it).
   * Min 1h enforced server-side.
   */
  intervalHours?: number;
  onIntervalChange?: (hours: number) => void;
  heartbeatStatus?: {
    actualStatus: string;
    taskId: string | null;
    nextRun: string | null;
    lastRunStatus: string | null;
    lastRunResult?: string | null;
    lastRunError: string | null;
    lastRunDurationMs?: number | null;
    lastMeaningfulAlert?: {
      text: string;
      createdAt: string;
    } | null;
    lastDelivery?: {
      status: string;
      error: string | null;
      attemptCount: number;
      acceptedAt: string | null;
    } | null;
  };
  onRunNow?: () => void;
  runningNow?: boolean;
  onTestNotification?: () => void;
  testingNotification?: boolean;
  testNotificationStatus?: {
    status: 'queued' | 'delivered' | 'error';
    error?: string | null;
    attemptCount?: number;
    acceptedAt?: string | null;
  } | null;
}

export function CheckInCard({
  autoTriggerEnabled,
  onAutoTriggerChange,
  intervalHours,
  onIntervalChange,
  heartbeatStatus,
  onRunNow,
  runningNow,
  onTestNotification,
  testingNotification,
  testNotificationStatus,
}: CheckInCardProps) {
  const { t } = useTranslation();
  const latestOutcome = (() => {
    if (!autoTriggerEnabled) return t('assistant.heartbeatDisabled' as TranslationKey);
    if (heartbeatStatus?.lastRunStatus === 'running') return t('assistant.heartbeatRunning' as TranslationKey);
    if (heartbeatStatus?.lastRunStatus === 'skipped_empty') return t('assistant.heartbeatNoReminder' as TranslationKey);
    if (heartbeatStatus?.lastRunStatus === 'succeeded' && heartbeatStatus.lastRunResult === 'silent') {
      return t('assistant.heartbeatNoReminder' as TranslationKey);
    }
    if (heartbeatStatus?.lastRunStatus === 'succeeded') return t('assistant.heartbeatAlerted' as TranslationKey);
    if (heartbeatStatus?.lastRunStatus) return t('assistant.heartbeatBlocked' as TranslationKey);
    return heartbeatStatus?.actualStatus === 'active'
      ? t('assistant.heartbeatScheduled' as TranslationKey)
      : t('assistant.heartbeatBlocked' as TranslationKey);
  })();

  // v12 layout: title + Switch on the top row only; description and
  // status get full card width below. v13 (Step 4) adds an interval
  // picker (24 / 12 / 6 / 1 hours) when `intervalHours` + the change
  // callback are supplied — the only NEW user-facing control on this
  // card after Step 4. Hidden when the toggle is off (no interval to
  // configure when heartbeat won't run).
  return (
    <div className="rounded-lg bg-card border border-border/50 p-5 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-medium">{t('assistant.heartbeatTitle')}</h2>
        <Switch checked={autoTriggerEnabled} onCheckedChange={onAutoTriggerChange} />
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t('assistant.heartbeatDesc')}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {t('assistant.heartbeatCostNotice' as TranslationKey)}
      </p>
      {autoTriggerEnabled && typeof intervalHours === 'number' && onIntervalChange && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs text-muted-foreground">
            {t('assistant.heartbeatInterval' as TranslationKey)}
          </span>
          <Select
            value={String(intervalHours)}
            onValueChange={(v) => onIntervalChange(parseInt(v, 10) || 24)}
          >
            <SelectTrigger className="w-auto text-xs h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">{t('assistant.heartbeatInterval1h' as TranslationKey)}</SelectItem>
              <SelectItem value="6">{t('assistant.heartbeatInterval6h' as TranslationKey)}</SelectItem>
              <SelectItem value="12">{t('assistant.heartbeatInterval12h' as TranslationKey)}</SelectItem>
              <SelectItem value="24">{t('assistant.heartbeatInterval24h' as TranslationKey)}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="rounded-md border border-border/50 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
        <p>{latestOutcome}</p>
        {autoTriggerEnabled && (
          <>
          {heartbeatStatus?.nextRun && (
            <p>{t('assistant.heartbeatNextRun' as TranslationKey)}: {new Date(heartbeatStatus.nextRun).toLocaleString()}</p>
          )}
          {heartbeatStatus?.lastRunStatus && (
            <p>{t('assistant.heartbeatLastResult' as TranslationKey)}: {heartbeatStatus.lastRunStatus}</p>
          )}
          {typeof heartbeatStatus?.lastRunDurationMs === 'number' && (
            <p>{t('assistant.heartbeatDuration' as TranslationKey)}: {heartbeatStatus.lastRunDurationMs} ms</p>
          )}
          {heartbeatStatus?.lastRunError && (
            <p className="text-status-error-foreground">{heartbeatStatus.lastRunError}</p>
          )}
          {heartbeatStatus?.lastMeaningfulAlert && (
            <p>
              {t('assistant.heartbeatLastAlert' as TranslationKey)}: {heartbeatStatus.lastMeaningfulAlert.text}
              {` · ${new Date(heartbeatStatus.lastMeaningfulAlert.createdAt).toLocaleString()}`}
            </p>
          )}
          {heartbeatStatus?.lastDelivery && (
            <p>
              {t('assistant.heartbeatDelivery' as TranslationKey)}: {heartbeatStatus.lastDelivery.status}
              {` · ${t('assistant.heartbeatDeliveryAttempts' as TranslationKey)}: ${heartbeatStatus.lastDelivery.attemptCount}`}
              {heartbeatStatus.lastDelivery.error ? ` · ${heartbeatStatus.lastDelivery.error}` : ''}
            </p>
          )}
          </>
        )}
      </div>
      {autoTriggerEnabled && heartbeatStatus?.taskId && onRunNow && (
        <Button variant="outline" size="sm" onClick={onRunNow} disabled={runningNow}>
          {runningNow ? <SpinnerGap size={14} className="animate-spin" /> : null}
          {t('assistant.heartbeatRunNow' as TranslationKey)}
        </Button>
      )}
      {onTestNotification && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onTestNotification} disabled={testingNotification}>
            {testingNotification ? <SpinnerGap size={14} className="animate-spin" /> : null}
            {t('assistant.testSystemNotification' as TranslationKey)}
          </Button>
          {testNotificationStatus?.status === 'queued' && (
            <span className="text-[11px] text-muted-foreground">
              {t('assistant.testNotificationQueued' as TranslationKey)}
            </span>
          )}
          {testNotificationStatus?.status === 'delivered' && (
            <span className="text-[11px] text-status-success-foreground">
              {t('assistant.testNotificationAccepted' as TranslationKey)}
              {testNotificationStatus.acceptedAt ? ` · ${new Date(testNotificationStatus.acceptedAt).toLocaleTimeString()}` : ''}
            </span>
          )}
          {testNotificationStatus?.status === 'error' && (
            <span className="text-[11px] text-status-error-foreground">
              {testNotificationStatus.error === NATIVE_NOTIFICATION_ERROR.macosUnsignedDevelopment
                ? t('assistant.testNotificationMacDev' as TranslationKey)
                : `${t('assistant.testNotificationFailed' as TranslationKey)}${testNotificationStatus.error ? `: ${testNotificationStatus.error}` : ''}`}
            </span>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        {t('assistant.testNotificationHint' as TranslationKey)}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {t('assistant.editHeartbeatHint')}
      </p>
    </div>
  );
}
