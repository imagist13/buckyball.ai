/**
 * BB Assistant — Buddy System
 *
 * Deterministic AI companion generation for bb agent assistant workspaces.
 * Forked from CodePilot's `lib/buddy.ts` and renamed to `BbBuddy*` /
 * `BbSpecies` / `BbRarity` / `BbBuddyData` per
 * [docs/exec-plans/active/assistant-merge-into-bbagent.md](../../../../docs/exec-plans/active/assistant-merge-into-bbagent.md)
 * Phase M1.3.
 *
 * Each assistant workspace gets a unique buddy based on a hash of the
 * workspace path + creation timestamp. Rarity is probability-controlled
 * (60% common → 1% legendary) to ensure fair global distribution.
 */

// ── Species ────────────────────────────────────────────────────────

export const BB_SPECIES = [
  'cat', 'duck', 'dragon', 'owl', 'penguin', 'turtle', 'octopus', 'ghost',
  'axolotl', 'capybara', 'robot', 'rabbit', 'mushroom', 'fox', 'panda', 'whale',
] as const;

export type BbSpecies = typeof BB_SPECIES[number];

// Species → boring-avatars variant for unique visual identity
export const BB_SPECIES_AVATAR_VARIANT: Record<BbSpecies, 'beam' | 'marble' | 'pixel' | 'sunset' | 'ring' | 'bauhaus'> = {
  cat: 'beam', duck: 'sunset', dragon: 'marble', owl: 'bauhaus', penguin: 'pixel',
  turtle: 'ring', octopus: 'marble', ghost: 'sunset', axolotl: 'beam', capybara: 'ring',
  robot: 'pixel', rabbit: 'beam', mushroom: 'bauhaus', fox: 'sunset', panda: 'ring', whale: 'marble',
};

// Rarity → avatar color palette (higher rarity = richer colors)
export const BB_RARITY_AVATAR_COLORS: Record<BbRarity, string[]> = {
  common: ['#A0AEC0', '#CBD5E0', '#E2E8F0', '#EDF2F7', '#F7FAFC'],
  uncommon: ['#48BB78', '#68D391', '#9AE6B4', '#C6F6D5', '#F0FFF4'],
  rare: ['#4299E1', '#63B3ED', '#90CDF4', '#BEE3F8', '#EBF8FF'],
  epic: ['#9F7AEA', '#B794F4', '#D6BCFA', '#E9D8FD', '#FAF5FF'],
  legendary: ['#F6AD55', '#FBD38D', '#FEFCBF', '#F6E05E', '#ECC94B'],
};

export const BB_SPECIES_IMAGE_URL: Record<BbSpecies, string> = {
  cat: '/buddy/cat.png',
  duck: '/buddy/duck.png',
  dragon: '/buddy/dragon.png',
  owl: '/buddy/owl.png',
  penguin: '/buddy/penguin.png',
  turtle: '/buddy/turtle.png',
  octopus: '/buddy/octopus.png',
  ghost: '/buddy/ghost.png',
  axolotl: '/buddy/lizard.png',
  capybara: '/buddy/beaver.png',
  robot: '/buddy/robot.png',
  rabbit: '/buddy/rabbit.png',
  mushroom: '/buddy/mushroom.png',
  fox: '/buddy/fox.png',
  panda: '/buddy/panda.png',
  whale: '/buddy/whale.png',
};

// Egg image for unhatched state
export const BB_EGG_IMAGE_URL = '/buddy/egg.png';

export const BB_RARITY_BG_GRADIENT: Record<BbRarity, string> = {
  common: 'linear-gradient(135deg, #e2e8f0, #f1f5f9)',
  uncommon: 'linear-gradient(135deg, #dcfce7, #f0fdf4)',
  rare: 'linear-gradient(135deg, #dbeafe, #eff6ff)',
  epic: 'linear-gradient(135deg, #ede9fe, #f5f3ff)',
  legendary: 'linear-gradient(135deg, #fef3c7, #fffbeb)',
};

export const BB_SPECIES_EMOJI: Record<BbSpecies, string> = {
  cat: '🐱', duck: '🦆', dragon: '🐉', owl: '🦉', penguin: '🐧',
  turtle: '🐢', octopus: '🐙', ghost: '👻', axolotl: '🦎', capybara: '🦫',
  robot: '🤖', rabbit: '🐰', mushroom: '🍄', fox: '🦊', panda: '🐼', whale: '🐋',
};

export const BB_SPECIES_LABEL: Record<BbSpecies, { en: string; zh: string }> = {
  cat: { en: 'Cat', zh: '猫咪' }, duck: { en: 'Duck', zh: '鸭子' },
  dragon: { en: 'Dragon', zh: '龙' }, owl: { en: 'Owl', zh: '猫头鹰' },
  penguin: { en: 'Penguin', zh: '企鹅' }, turtle: { en: 'Turtle', zh: '海龟' },
  octopus: { en: 'Octopus', zh: '章鱼' }, ghost: { en: 'Ghost', zh: '幽灵' },
  axolotl: { en: 'Axolotl', zh: '六角龙' }, capybara: { en: 'Capybara', zh: '水豚' },
  robot: { en: 'Robot', zh: '机器人' }, rabbit: { en: 'Rabbit', zh: '兔子' },
  mushroom: { en: 'Mushroom', zh: '蘑菇' }, fox: { en: 'Fox', zh: '狐狸' },
  panda: { en: 'Panda', zh: '熊猫' }, whale: { en: 'Whale', zh: '鲸鱼' },
};

// ── Rarity ─────────────────────────────────────────────────────────

export type BbRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

const BB_RARITY_WEIGHTS: Record<BbRarity, number> = {
  common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1,
};

const BB_RARITY_FLOORS: Record<BbRarity, number> = {
  common: 5, uncommon: 15, rare: 25, epic: 35, legendary: 50,
};

export const BB_RARITY_DISPLAY: Record<BbRarity, { stars: string; label: { en: string; zh: string } }> = {
  common: { stars: '★', label: { en: 'Common', zh: '普通' } },
  uncommon: { stars: '★★', label: { en: 'Uncommon', zh: '稀有' } },
  rare: { stars: '★★★', label: { en: 'Rare', zh: '精良' } },
  epic: { stars: '★★★★', label: { en: 'Epic', zh: '史诗' } },
  legendary: { stars: '★★★★★', label: { en: 'Legendary', zh: '传说' } },
};

// ── Stats ──────────────────────────────────────────────────────────

export const BB_STAT_NAMES = ['creativity', 'patience', 'insight', 'humor', 'precision'] as const;
export type BbStatName = typeof BB_STAT_NAMES[number];

export const BB_STAT_LABEL: Record<string, { en: string; zh: string }> = {
  creativity: { en: 'Creativity', zh: '创意' },
  patience: { en: 'Patience', zh: '耐心' },
  insight: { en: 'Insight', zh: '洞察' },
  humor: { en: 'Humor', zh: '幽默' },
  precision: { en: 'Precision', zh: '精确' },
};

// Mapping from peak stat to soul.md personality hint
export const BB_STAT_PERSONALITY_HINTS: Record<BbStatName, { en: string; zh: string }> = {
  creativity: { en: 'You excel at creative solutions and unexpected suggestions.', zh: '你擅长给出创意方案和意想不到的建议。' },
  patience: { en: 'You are very patient, explaining things step by step.', zh: '你非常耐心，善于一步步解释清楚。' },
  insight: { en: 'You are great at analyzing the essence of problems.', zh: '你善于分析问题的本质。' },
  humor: { en: 'You add appropriate humor to make interactions enjoyable.', zh: '你会适当加入幽默，让交流更轻松。' },
  precision: { en: 'You focus on details and accuracy.', zh: '你注重细节和准确性。' },
};

// ── Data Types ─────────────────────────────────────────────────────

export interface BbBuddyData {
  species: BbSpecies;
  rarity: BbRarity;
  stats: Record<BbStatName, number>;
  emoji: string;
  peakStat: BbStatName;
  hatchedAt: string;
  buddyName?: string;  // User-given name for the buddy
}

// ── PRNG (Mulberry32, same as Claude Code) ─────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ── Generation ─────────────────────────────────────────────────────

function pickRandom<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function rollRarity(rng: () => number): BbRarity {
  const total = Object.values(BB_RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (const [rarity, weight] of Object.entries(BB_RARITY_WEIGHTS) as [BbRarity, number][]) {
    roll -= weight;
    if (roll <= 0) return rarity;
  }
  return 'common';
}

function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function rollStats(rng: () => number, rarity: BbRarity): { stats: Record<BbStatName, number>; peakStat: BbStatName } {
  const floor = BB_RARITY_FLOORS[rarity];
  const names = [...BB_STAT_NAMES];
  shuffle(names, rng);

  const stats = {} as Record<BbStatName, number>;
  // Peak stat (first after shuffle)
  stats[names[0]!] = Math.min(100, floor + 50 + Math.floor(rng() * 30));
  // Dump stat (second)
  stats[names[1]!] = Math.max(1, floor - 10 + Math.floor(rng() * 15));
  // Scatter (rest)
  for (let i = 2; i < names.length; i++) {
    stats[names[i]!] = floor + Math.floor(rng() * 40);
  }

  return { stats, peakStat: names[0]! };
}

/**
 * Generate a deterministic buddy from a seed string.
 * Same seed always produces the same buddy.
 *
 * @param seed - Usually `workspacePath + ':' + createdAt`
 */
export function generateBbBuddy(seed: string): BbBuddyData {
  const hash = hashString(seed + ':buddy-2026');
  const rng = mulberry32(hash);

  const rarity = rollRarity(rng);
  const species = pickRandom(rng, BB_SPECIES);
  const { stats, peakStat } = rollStats(rng, rarity);
  const emoji = BB_SPECIES_EMOJI[species];

  return {
    species,
    rarity,
    stats,
    emoji,
    peakStat,
    hatchedAt: new Date().toISOString(),
  };
}

/**
 * Get the personality hint for a buddy's peak stat.
 */
export function getBbPeakStatHint(peakStat: BbStatName, lang: 'en' | 'zh' = 'zh'): string {
  return BB_STAT_PERSONALITY_HINTS[peakStat][lang];
}

/** Get Tailwind color class for a rarity string. */
export function bbRarityColor(rarity: string): string {
  const colors: Record<string, string> = {
    common: 'text-muted-foreground',
    uncommon: 'text-green-500',
    rare: 'text-blue-500',
    epic: 'text-purple-500',
    legendary: 'text-amber-500',
  };
  return colors[rarity] ?? 'text-muted-foreground';
}

// ── Titles (Uncommon+) ──────────────────────────────────────────

export const BB_TITLE_POOL: Record<string, { en: string; zh: string }[]> = {
  creativity: [
    { en: 'Imaginative', zh: '富有想象力的' },
    { en: 'Inventive', zh: '善于创造的' },
  ],
  patience: [
    { en: 'Diligent', zh: '勤奋的' },
    { en: 'Warm', zh: '温暖的' },
  ],
  insight: [
    { en: 'Perceptive', zh: '敏锐的' },
    { en: 'Wise', zh: '睿智的' },
  ],
  humor: [
    { en: 'Witty', zh: '机智的' },
    { en: 'Cheerful', zh: '开朗的' },
  ],
  precision: [
    { en: 'Meticulous', zh: '细致的' },
    { en: 'Precise', zh: '精准的' },
  ],
};

/**
 * Get the title prefix for a buddy based on rarity and peak stat.
 * Common = no title, Uncommon+ = title from peak stat pool.
 */
export function getBbBuddyTitle(buddy: BbBuddyData, lang: 'en' | 'zh' = 'zh'): string {
  if (buddy.rarity === 'common') return '';
  const pool = BB_TITLE_POOL[buddy.peakStat];
  if (!pool || pool.length === 0) return '';
  // Deterministic: use species index to pick from pool
  const idx = BB_SPECIES.indexOf(buddy.species as BbSpecies) % pool.length;
  return pool[idx]?.[lang] || '';
}

// ── Rarity Abilities ────────────────────────────────────────────

export interface BbRarityAbilities {
  title: boolean;              // Uncommon+: has title prefix
  enhancedPersonality: boolean; // Rare+: stronger soul.md traits
  memoryBoost: boolean;        // Epic+: faster auto-extraction (every 2 turns instead of 3)
  legendaryPerks: boolean;     // Legendary: shimmer effect + auto dream
}

export function getBbRarityAbilities(rarity: BbRarity): BbRarityAbilities {
  const rarityOrder: BbRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const level = rarityOrder.indexOf(rarity);
  return {
    title: level >= 1,           // uncommon+
    enhancedPersonality: level >= 2, // rare+
    memoryBoost: level >= 3,     // epic+
    legendaryPerks: level >= 4,  // legendary
  };
}

// ── Enhanced Personality (Rare+) ────────────────────────────────

export function getBbEnhancedPersonalityTraits(buddy: BbBuddyData, lang: 'en' | 'zh' = 'zh'): string[] {
  const abilities = getBbRarityAbilities(buddy.rarity);
  const traits: string[] = [];

  // Base trait from peak stat (all rarities)
  traits.push(BB_STAT_PERSONALITY_HINTS[buddy.peakStat][lang]);

  if (abilities.enhancedPersonality) {
    // Rare+: add secondary stat trait
    const sortedStats = Object.entries(buddy.stats).sort((a, b) => b[1] - a[1]);
    const secondStat = sortedStats[1]?.[0] as BbStatName | undefined;
    if (secondStat && secondStat !== buddy.peakStat) {
      traits.push(BB_STAT_PERSONALITY_HINTS[secondStat][lang]);
    }
  }

  return traits;
}

// ── Evolution ───────────────────────────────────────────────────

export interface BbEvolutionCheck {
  canEvolve: boolean;
  currentRarity: BbRarity;
  nextRarity: BbRarity | null;
  memoryCount: number;
  requiredMemories: number;
  daysActive: number;
  requiredDays: number;
  conversationCount: number;
  requiredConversations: number;
}

const BB_EVOLUTION_REQUIREMENTS: Record<BbRarity, { memories: number; days: number; conversations: number } | null> = {
  common: { memories: 10, days: 7, conversations: 20 },       // -> uncommon
  uncommon: { memories: 30, days: 21, conversations: 50 },     // -> rare
  rare: { memories: 60, days: 45, conversations: 100 },        // -> epic
  epic: { memories: 100, days: 90, conversations: 200 },       // -> legendary
  legendary: null,  // max rarity
};

const BB_RARITY_ORDER: BbRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/**
 * Check if a buddy can evolve to the next rarity.
 * Evolution is based on: memory file count + days since hatching + conversation approximation.
 */
export function checkBbEvolution(buddy: BbBuddyData, memoryCount: number): BbEvolutionCheck {
  const currentIdx = BB_RARITY_ORDER.indexOf(buddy.rarity);
  const nextRarity = currentIdx < BB_RARITY_ORDER.length - 1 ? BB_RARITY_ORDER[currentIdx + 1]! : null;
  const req = BB_EVOLUTION_REQUIREMENTS[buddy.rarity];

  if (!req || !nextRarity) {
    return {
      canEvolve: false,
      currentRarity: buddy.rarity,
      nextRarity: null,
      memoryCount,
      requiredMemories: 0,
      daysActive: 0,
      requiredDays: 0,
      conversationCount: 0,
      requiredConversations: 0,
    };
  }

  const hatchedAt = new Date(buddy.hatchedAt).getTime();
  const daysActive = Math.floor((Date.now() - hatchedAt) / (24 * 60 * 60 * 1000));
  // Approximate conversations from memory count (rough: 3 conversations per memory file)
  const conversationCount = memoryCount * 3;

  const canEvolve = memoryCount >= req.memories && daysActive >= req.days && conversationCount >= req.conversations;

  return {
    canEvolve,
    currentRarity: buddy.rarity,
    nextRarity,
    memoryCount,
    requiredMemories: req.memories,
    daysActive,
    requiredDays: req.days,
    conversationCount,
    requiredConversations: req.conversations,
  };
}

/**
 * Evolve a buddy to the next rarity. Returns new BbBuddyData with upgraded rarity + boosted stats.
 */
export function evolveBbBuddy(buddy: BbBuddyData): BbBuddyData {
  const currentIdx = BB_RARITY_ORDER.indexOf(buddy.rarity);
  if (currentIdx >= BB_RARITY_ORDER.length - 1) return buddy; // already max

  const newRarity = BB_RARITY_ORDER[currentIdx + 1]!;
  const newFloor = BB_RARITY_FLOORS[newRarity];
  const oldFloor = BB_RARITY_FLOORS[buddy.rarity];
  const boost = newFloor - oldFloor; // stat boost from floor increase

  // Boost all stats by the floor difference, cap at 100
  const newStats = { ...buddy.stats };
  for (const stat of BB_STAT_NAMES) {
    newStats[stat] = Math.min(100, (newStats[stat] || 0) + boost);
  }

  return {
    ...buddy,
    rarity: newRarity,
    stats: newStats,
  };
}
