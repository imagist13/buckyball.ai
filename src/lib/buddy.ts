/**
 * BB Assistant — buddy shim
 *
 * Phase M1 moved this module to `src/lib/bbagent/assistant/buddy.ts`.
 * All imports here are re-exports so the existing import sites do not
 * need to change. This shim is temporary — Phase M4 of the
 * assistant-merge-into-bbagent plan will update all import sites and
 * remove this file.
 */

// ── species ───────────────────────────────────────────────────────

export { BB_SPECIES as SPECIES, type BbSpecies as Species } from './bbagent/assistant/buddy';

// ── species display ───────────────────────────────────────────────

export { BB_SPECIES_IMAGE_URL as SPECIES_IMAGE_URL } from './bbagent/assistant/buddy';
export { BB_SPECIES_AVATAR_VARIANT as SPECIES_AVATAR_VARIANT } from './bbagent/assistant/buddy';
export { BB_SPECIES_EMOJI as SPECIES_EMOJI } from './bbagent/assistant/buddy';
export { BB_SPECIES_LABEL as SPECIES_LABEL } from './bbagent/assistant/buddy';

// ── egg ───────────────────────────────────────────────────────────

export { BB_EGG_IMAGE_URL as EGG_IMAGE_URL } from './bbagent/assistant/buddy';

// ── rarity ────────────────────────────────────────────────────────

export { BB_RARITY_DISPLAY as RARITY_DISPLAY } from './bbagent/assistant/buddy';
export { BB_RARITY_BG_GRADIENT as RARITY_BG_GRADIENT } from './bbagent/assistant/buddy';
export { BB_RARITY_AVATAR_COLORS as RARITY_AVATAR_COLORS } from './bbagent/assistant/buddy';
export type { BbRarity as Rarity } from './bbagent/assistant/buddy';

// ── stats ─────────────────────────────────────────────────────────

export { BB_STAT_NAMES as STAT_NAMES, BB_STAT_LABEL as STAT_LABEL } from './bbagent/assistant/buddy';
export type { BbStatName } from './bbagent/assistant/buddy';

// ── generation ────────────────────────────────────────────────────

export {
  generateBbBuddy as generateBuddy,
  getBbPeakStatHint as getPeakStatHint,
} from './bbagent/assistant/buddy';

// ── evolution ──────────────────────────────────────────────────────

export {
  checkBbEvolution as checkEvolution,
  evolveBbBuddy as evolveBuddy,
  getBbRarityAbilities as getRarityAbilities,
  getBbEnhancedPersonalityTraits as getEnhancedPersonalityTraits,
  getBbBuddyTitle as getBuddyTitle,
} from './bbagent/assistant/buddy';

// ── colors ────────────────────────────────────────────────────────

export { bbRarityColor as rarityColor } from './bbagent/assistant/buddy';

// ── data type ─────────────────────────────────────────────────────

export type { BbBuddyData as BuddyData } from './bbagent/assistant/buddy';
