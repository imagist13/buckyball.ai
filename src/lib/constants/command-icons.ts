/**
 * Semantic icon alias for each built-in slash command.
 *
 * Phase 7 (2026-05-21): switched from raw Phosphor component imports
 * (Brain / Terminal / Trash / ...) to BuckyballIcon semantic alias
 * strings. Brain previously sat in both /memory and Settings>Models,
 * which violated the Phase 7 Brain â?memory / Cube â?model split.
 * Holding aliases at this layer keeps the rule honored uniformly.
 *
 * Separated from commands.ts so the constants layer stays presentation-
 * free. Consumed by useSlashCommands to enrich BUILT_IN_COMMANDS before
 * rendering; the renderer (SlashCommandPopover) calls
 * <BuckyballIcon name={item.iconName} />.
 */

import type { BuckyballIconName } from '@/components/ui/semantic-icon';

/** Map from command value (e.g. "/help") to its BuckyballIcon semantic alias. */
export const COMMAND_ICON_NAMES: Record<string, BuckyballIconName> = {
  '/help': 'help',
  '/clear': 'delete',
  '/cost': 'cost',
  '/compact': 'archive',
  '/doctor': 'diagnose',
  '/init': 'note',
  '/review': 'search',
  '/terminal-setup': 'terminal',
  '/memory': 'memory',
};
