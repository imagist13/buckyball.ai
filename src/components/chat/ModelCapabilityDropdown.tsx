'use client';

import { useState } from 'react';
import { CaretDown } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { resolveEffortMenuLevels } from '@/lib/effort-levels';
import type { ComposerModelCapabilityDescriptor } from '@/lib/model-option-support';
import {
  CommandList,
  CommandListGroup,
  CommandListItem,
  CommandListItems,
} from '@/components/patterns';

interface ModelCapabilityDropdownProps {
  descriptor: ComposerModelCapabilityDescriptor;
  selectedEffort: string;
  onEffortChange: (effort: string) => void;
  context1m: boolean;
  contextWindow?: number;
  onContext1mChange?: (enabled: boolean) => void;
}

function formatContextWindow(value: number | undefined): string {
  if (!value) return '';
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  return `${Math.round(value / 1_000)}K`;
}

export function ModelCapabilityDropdown({
  descriptor,
  selectedEffort,
  onEffortChange,
  context1m,
  contextWindow,
  onContext1mChange,
}: ModelCapabilityDropdownProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const effortLevels = descriptor.effort.state === 'selectable'
    ? resolveEffortMenuLevels(descriptor.effort.values)
    : null;
  const contextSelectable = descriptor.context1m.state === 'selectable'
    && Boolean(onContext1mChange);
  const contextFixed = descriptor.context1m.state === 'fixed'
    && descriptor.context1m.fixedValue === true;

  if (!effortLevels && !contextSelectable && !contextFixed) return null;

  const summary = [
    effortLevels
      ? t(`messageInput.effort.${selectedEffort}` as TranslationKey)
      : null,
    contextFixed || context1m
      ? '1M'
      : contextSelectable
        ? formatContextWindow(contextWindow)
        : null,
  ].filter(Boolean).join(' · ');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PromptInputButton aria-label={t('composer.modelParameters' as TranslationKey)}>
          <span className="text-xs font-normal">{summary}</span>
          <CaretDown size={10} className={cn('transition-transform duration-200', open && 'rotate-180')} />
        </PromptInputButton>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={16}
        className="w-60 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-2xl border bg-popover p-0 shadow-[var(--shadow-diffuse)]"
      >
        <CommandList positioning="inline" className="w-full rounded-none border-0 shadow-none">
          <CommandListItems>
            {effortLevels && (
              <CommandListGroup label={t('messageInput.effort.label' as TranslationKey)}>
                {effortLevels.map((level) => (
                  <CommandListItem
                    key={level}
                    active={selectedEffort === level}
                    onClick={() => onEffortChange(level)}
                  >
                    <span className="text-xs">{t(`messageInput.effort.${level}` as TranslationKey)}</span>
                  </CommandListItem>
                ))}
                {descriptor.effort.noteKey && (
                  <div className="px-2.5 pb-1.5 pt-1 text-[10px] leading-snug text-muted-foreground break-words">
                    {t(descriptor.effort.noteKey as TranslationKey)}
                  </div>
                )}
              </CommandListGroup>
            )}
            {(contextSelectable || contextFixed) && (
              <CommandListGroup label={t('composer.contextWindow' as TranslationKey)}>
                {contextFixed ? (
                  <div className="px-2.5 py-2 text-xs text-muted-foreground break-words">
                    {t('composer.context1mFixed' as TranslationKey)}
                  </div>
                ) : (
                  <>
                    <CommandListItem active={!context1m} onClick={() => onContext1mChange?.(false)}>
                      <span className="text-xs">
                        {formatContextWindow(contextWindow)
                          || t('composer.defaultContextWindow' as TranslationKey)}
                      </span>
                    </CommandListItem>
                    <CommandListItem active={context1m} onClick={() => onContext1mChange?.(true)}>
                      <span className="text-xs">1M</span>
                    </CommandListItem>
                  </>
                )}
              </CommandListGroup>
            )}
          </CommandListItems>
        </CommandList>
      </PopoverContent>
    </Popover>
  );
}
