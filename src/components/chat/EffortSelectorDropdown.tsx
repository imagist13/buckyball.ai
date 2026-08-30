'use client';

import { useState } from 'react';
import { CaretDown } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { resolveEffortMenuLevels } from '@/lib/effort-levels';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  CommandList,
  CommandListItems,
  CommandListItem,
  CommandListGroup,
} from '@/components/patterns';

interface EffortSelectorDropdownProps {
  selectedEffort: string;
  onEffortChange: (effort: string) => void;
  supportedEffortLevels?: string[];
  /**
   * Phase 1 (2026-07-17) — i18n key for a note under the tiers, set by the
   * catalog when the list alone misreads: GLM shows two tiers because it
   * collapses Claude Code's six onto two, and Kimi distinguishes Auto from
   * its Low/High/Max vendor tiers. Without the note the user reads the list as
   * the model being less capable, or reads `Auto` as a Kimi setting.
   */
  effortNoteKey?: string;
}

export function EffortSelectorDropdown({
  selectedEffort,
  onEffortChange,
  supportedEffortLevels,
  effortNoteKey,
}: EffortSelectorDropdownProps) {
  const { t } = useTranslation();
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);

  // The dropdown always surfaces an 'auto' option first. When selected, the
  // caller interprets it as "no explicit effort" and sends undefined to the
  // backend, letting Claude Code's per-model default apply (xhigh for Opus
  // 4.7, high for Sonnet, etc.). Without this, the button could display
  // a specific level (e.g. 'High') while the request actually sent
  // undefined, which user-visibly lied about what was being paid for.
  //
  // Phase 0 (2026-07-17) — levels come ONLY from a real capability source.
  // This used to `||` into a hardcoded five-tier ladder whenever discovery
  // returned nothing, so the menu offered tiers no model had claimed. Now a
  // null resolution hides the control. Rule lives in resolveEffortMenuLevels.
  const levels = resolveEffortMenuLevels(supportedEffortLevels);

  // No sourced capability info → render nothing. Hiding is honest; a menu of
  // guessed tiers is not.
  if (!levels) return null;

  return (
    <Popover open={effortMenuOpen} onOpenChange={setEffortMenuOpen}>
      <PopoverTrigger asChild>
        <PromptInputButton>
          <span className="text-xs font-normal">{t(`messageInput.effort.${selectedEffort}` as TranslationKey)}</span>
          <CaretDown size={10} className={cn("transition-transform duration-200", effortMenuOpen && "rotate-180")} />
        </PromptInputButton>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={16}
        className="w-80 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-2xl border bg-popover p-0 shadow-[var(--shadow-diffuse)] ring-0 duration-150"
      >
        <CommandList positioning="inline" className="w-full rounded-none border-0 shadow-none">
          <CommandListItems>
            <CommandListGroup label={t('messageInput.effort.label' as TranslationKey)}>
              {levels.map((level) => (
                <CommandListItem
                  key={level}
                  active={selectedEffort === level}
                  onClick={() => {
                    onEffortChange(level);
                    setEffortMenuOpen(false);
                  }}
                >
                  {/* Round 16: removed trailing `&#10003;` checkmark.
                      `active` prop styles the row already; the
                      duplicate glyph was redundant and pushed the row
                      to `justify-between`, misaligned with the other
                      composer dropdowns. */}
                  <span className="text-xs">{t(`messageInput.effort.${level}` as TranslationKey)}</span>
                </CommandListItem>
              ))}
              {effortNoteKey && (
                <div className="px-2.5 pb-1.5 pt-1 text-[10px] leading-snug text-muted-foreground">
                  {t(effortNoteKey as TranslationKey)}
                </div>
              )}
            </CommandListGroup>
          </CommandListItems>
        </CommandList>
      </PopoverContent>
    </Popover>
  );
}
