'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X } from '@/components/ui/icon';
import { CodePilotIcon } from '@/components/ui/semantic-icon';
import { useTranslation } from '@/hooks/useTranslation';
import { EGG_IMAGE_URL } from '@/lib/buddy';
import { cn } from '@/lib/utils';

interface ChatEmptyStateProps {
  hasDirectory: boolean;
  hasProvider: boolean;
  onSelectFolder: () => void;
  assistantConfigured?: boolean;
  onOpenAssistant?: () => void;
  /** Dev-only visual QA mode; changes visibility, never persisted product state. */
  preview?: boolean;
}

export function ChatEmptyState({
  hasDirectory,
  hasProvider,
  onSelectFolder,
  assistantConfigured,
  onOpenAssistant,
  preview = false,
}: ChatEmptyStateProps) {
  const { t } = useTranslation();
  const showAssistantOpen = Boolean(assistantConfigured && !preview);

  if (hasDirectory && hasProvider && !preview) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">{t('chat.empty.ready')}</p>
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-2">
      <div className="w-full space-y-2.5">
        {/* Dual entry point cards */}
        <div className="grid gap-2 sm:grid-cols-2" data-assistant-onboarding-cards>
          <ChatEntryCard
            icon={(
              <CodePilotIcon name="folder_open" size="lg" className="text-foreground/75" aria-hidden />
            )}
            title={t('chat.empty.projectChat.title')}
            description={t('chat.empty.projectChat.description')}
            actionLabel={t('chat.empty.selectFolder')}
            onClick={onSelectFolder}
          />

          <ChatEntryCard
            icon={<img src={EGG_IMAGE_URL} alt="" width={28} height={28} className="shrink-0" />}
            title={t('chat.empty.assistant.title')}
            description={t('chat.empty.assistant.description')}
            actionLabel={showAssistantOpen
              ? t('chat.empty.assistant.open')
              : t('chat.empty.assistant.setup')}
            onClick={onOpenAssistant}
            assistant
          />
        </div>

        {/* Provider setup prompt */}
        {!hasProvider && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-left">
            <p className="text-xs text-muted-foreground">{t('chat.empty.noProvider')}</p>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => window.dispatchEvent(new CustomEvent('open-setup-center', { detail: { initialCard: 'provider' } }))}
            >
              {t('chat.empty.openSetup')}
            </Button>
          </div>
        )}

      </div>
    </div>
  );
}

function ChatEntryCard({
  icon,
  title,
  description,
  actionLabel,
  onClick,
  assistant = false,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onClick?: () => void;
  assistant?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'group grid min-h-[88px] w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl',
        'border border-border/50 bg-card px-3.5 py-3 text-left',
        'transition-[background-color,border-color,transform] duration-150',
        'hover:border-foreground/20 hover:bg-muted/30 active:translate-y-px',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
        'disabled:pointer-events-none disabled:opacity-50',
      )}
      data-chat-entry-card={assistant ? 'assistant' : 'project'}
    >
      <span
        className={cn(
          'flex size-9 items-center justify-center rounded-xl bg-muted/70',
          assistant && 'bg-muted/45',
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium leading-5 text-foreground">
          {title}
        </span>
        <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
          {description}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 pl-1 text-[11px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">
        <span className="hidden lg:inline">{actionLabel}</span>
        <CodePilotIcon name="forward" size="sm" aria-hidden />
      </span>
    </button>
  );
}

/* ─── Sidebar promo card ─────────────────────────────────────────── */

interface AssistantPromoCardProps {
  onSetup: () => void;
  onDismiss: () => void;
  /** Visual-QA escape hatch. Never persisted and only wired from a dev env flag. */
  preview?: boolean;
}

export function AssistantPromoCard({ onSetup, onDismiss, preview = false }: AssistantPromoCardProps) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('codepilot:assistant-promo-dismissed') === '1';
    } catch {
      return false;
    }
  });

  if (dismissed && !preview) return null;

  const handleDismiss = () => {
    if (!preview) {
      try {
        localStorage.setItem('codepilot:assistant-promo-dismissed', '1');
      } catch {
        // localStorage unavailable (private mode / restricted Electron) —
        // dismissal won't persist across sessions; degrade gracefully.
      }
      setDismissed(true);
    }
    onDismiss();
  };

  return (
    <div
      className="relative mx-2 mb-2 px-3 py-2 text-sidebar-foreground"
      data-assistant-promo
      data-preview={preview || undefined}
    >
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute right-2 top-1.5 inline-flex size-6 items-start justify-center rounded-lg pt-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        aria-label={t('chat.empty.assistant.dismiss')}
      >
        <X size={13} />
      </button>
      <div className="min-w-0 pr-7">
        <p className="text-[13px] font-semibold leading-[18px]">
          {t('chat.empty.assistant.title')}
        </p>
        <p className="mt-1 text-[11px] leading-4 text-sidebar-foreground/60">
          {t('chat.empty.assistant.description')}
        </p>
      </div>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="-ml-2 mt-1.5 h-6 rounded-lg px-2 text-xs text-sidebar-foreground hover:bg-sidebar-accent"
        onClick={onSetup}
      >
        {t('chat.empty.assistant.setup')}
        <CodePilotIcon name="forward" size="sm" aria-hidden />
      </Button>
    </div>
  );
}
