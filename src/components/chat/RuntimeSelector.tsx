'use client';

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
import { CaretDown } from '@/components/ui/icon';
import Anthropic from '@lobehub/icons/es/Anthropic';
import OpenAI from '@lobehub/icons/es/OpenAI';
import { MonolithIcon } from '@/components/brand/MonolithIcon';
import type { ChatRuntime } from '@/lib/chat-runtime-shared';
import { RUNTIME_IDS, type RuntimeId } from '@/lib/runtime/runtime-id';
import {
  requireRuntimeRegistration,
  type RuntimeBrandIcon,
} from '@/lib/runtime/runtime-catalog';

/**
 * Per-runtime i18n label keys. Single source of truth — adding a new
 * runtime (Codex Runtime in Phase 5) means appending the id to
 * `RUNTIME_IDS` in runtime-id.ts AND adding the matching label / desc
 * entries here. The dropdown auto-renders the new option.
 *
 * Phase 0.5 Slice E.1 (2026-05-13) — replaces the previous hand-rolled
 * 2-item dropdown that hard-coded `claude_code` / `codepilot_runtime`
 * branches in JSX.
 *
 * Phase 6 UI收口 P1 (2026-05-14) — short labels: trigger shows
 * "Claude Code" / "CodePilot" / "Codex" without the duplicate
 * "Runtime" / "引擎" suffix that bloated the composer toolbar.
 */
export function runtimeTranslationKeys(runtime: RuntimeId): {
  label: TranslationKey;
  desc: TranslationKey;
} {
  const keys = requireRuntimeRegistration(runtime).translationKeys;
  return {
    label: keys.label as TranslationKey,
    desc: keys.description as TranslationKey,
  };
}

/**
 * Per-runtime brand icon. Phase 6 UI收口 P1 (2026-05-14) — replaces the
 * generic `Brain` icon shared across all three rows. Recognition was
 * too costly: three identical brains forced users to read the label
 * to disambiguate. Now each engine carries its vendor mark:
 *
 *   claude_code       → Anthropic (Claude Code is Anthropic's CLI)
 *   codepilot_runtime → CodePilot's own cube logo (host product)
 *   codex_runtime     → OpenAI (Codex is an OpenAI product)
 */
export function RuntimeIcon({ runtime, size, className }: { runtime: RuntimeId; size: number; className?: string }) {
  const icon: RuntimeBrandIcon = requireRuntimeRegistration(runtime).icon;
  if (icon === 'anthropic') return <Anthropic size={size} className={className} />;
  if (icon === 'openai') return <OpenAI size={size} className={className} />;
  return <MonolithIcon size={size} className={className} />;
}

interface RuntimeSelectorProps {
  // The session's persisted `runtime_pin`. Empty string means the session
  // is following the global default (new sessions, or sessions whose
  // runtime hasn't been seeded yet by the chat route).
  runtimePin: string;
  // The currently effective runtime label — what would actually run if
  // the user pressed send right now. Used to render the trigger label
  // when `runtimePin === ''` so the user sees a concrete name instead
  // of a "follow default" hedge that doesn't tell them what's happening.
  effectiveRuntime: ChatRuntime;
  // Called with the new pin value. New chat (no sessionId yet) → caller
  // updates local state only. Existing session → caller PATCHes
  // `/api/chat/sessions/{id}` with `{ runtime_pin }`.
  onRuntimePinChange: (pin: ChatRuntime) => void;
  // Streaming guard: changing runtime mid-flight would either silently
  // fall through to the next message (confusing) or kill the active
  // stream (worse). Match ModeIndicator/ChatPermissionSelector — both
  // disable during stream.
  disabled?: boolean;
}

// Composer toolbar select for the session-level execution runtime.
// Visual language matches ModeIndicator + ChatPermissionSelector — invisible
// ghost button at default weight, hover surfaces the accent. The icon and
// label do the disambiguation; no colour cue.
export function RuntimeSelector({
  runtimePin,
  effectiveRuntime,
  onRuntimePinChange,
  disabled,
}: RuntimeSelectorProps) {
  const { t } = useTranslation();

  // The label always reflects what would actually run. We previously
  // appended a "本会话已切换" sub-badge whenever `runtimePin` was non-
  // empty, but Step 4c round-5 user feedback dropped it: if the user
  // just clicked this select themselves, telling them they switched
  // is redundant; mid-conversation switches will get a proper inline
  // marker via the AI-elements Checkpoint component (separate slice).
  const activeRuntime: ChatRuntime =
    runtimePin && (RUNTIME_IDS as readonly string[]).includes(runtimePin)
      ? (runtimePin as ChatRuntime)
      : effectiveRuntime;
  const label = t(runtimeTranslationKeys(activeRuntime).label);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled}
          data-runtime-selector
          aria-label={t('runtimeSelector.triggerAria' as TranslationKey)}
          className={cn(
            'h-7 rounded-md text-xs font-normal text-muted-foreground',
          )}
        >
          <RuntimeIcon runtime={activeRuntime} size={12} />
          <span>{label}</span>
          <CaretDown size={10} className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[260px]">
        {RUNTIME_IDS.map((id) => (
          <DropdownMenuItem
            key={id}
            onClick={() => onRuntimePinChange(id)}
            className="items-start py-2"
          >
            <RuntimeIcon runtime={id} size={14} className="mt-0.5" />
            <div className="flex flex-col items-start gap-0.5 flex-1 min-w-0">
              <span>{t(runtimeTranslationKeys(id).label)}</span>
              {/* Round 16: trimmed to one line. The description was
                  wrapping over 2-3 lines in zh and made the runtime
                  picker feel like a settings page. Active-state
                  checkmark removed — DropdownMenuItem already shows
                  the active row via its own bg highlight, the
                  redundant ✓ added visual noise. */}
              <span className="text-[11px] text-muted-foreground leading-tight line-clamp-1 max-w-[200px]">
                {t(runtimeTranslationKeys(id).desc)}
              </span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
