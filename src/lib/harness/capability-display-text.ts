/**
 * Capability display text â?Phase 5e Phase 3 review round 7 fix
 * (2026-05-18 user feedback).
 *
 * **User-facing layer.** Settings UI MUST read from here, NOT from
 * `capability-contract.ts` `displayName` / `deferredReason` /
 * `statusLine`. Those fields are the engineering contract (machine
 * identifiers, drift-detection references) and would leak words
 * like "MCP" / "bridge not yet implemented" / "permission round-trip
 * design" / "Phase 5d slice 7" into the user-visible clipboard.
 *
 * Rules baked in:
 *
 *   1. Two-language strings (zh + en). UI picks via the active i18n
 *      locale. No template interpolation server-side â?keeps the
 *      strings server-rendered + browser-safe.
 *
 *   2. **Capability ids exactly mirror `capability-contract.ts`.**
 *      The contract test in
 *      `capability-display-text-coverage.test.ts` walks
 *      `HARNESS_CAPABILITIES` and asserts every id has display text.
 *      Adding a new capability is a two-file change.
 *
 *   3. **Reasons describe outcomes, not architecture.** "å½åå¼æä¸? *      è½ç´æ¥è°ç?CodePilot ççæ¿å·¥å·ï¼è¯·åå?CodePilot ä½¿ç¨"
 *      â?that's the shape. NOT "Codex bridge not yet implemented",
 *      NOT "permission contract pending". The user doesn't care
 *      about our wire layering; they care whether the button works.
 *
 *   4. Client-safe: this file does NOT import any module that pulls
 *      Node-only deps (MCP factories, db, fs). Server + client both
 *      load it.
 */

import type { RuntimeId } from '@/lib/runtime/runtime-id';
import { getRuntimeDisplayName } from '@/lib/runtime/runtime-catalog';

export interface BilingualText {
  readonly zh: string;
  readonly en: string;
}

export interface CapabilityDisplay {
  /** Short label shown next to the status icon. Action-oriented when
   *  natural (e.g. "çæ Widget" not "Widget System"). */
  readonly label: BilingualText;
  /** Optional one-liner shown under the label inside the Dialog. */
  readonly description?: BilingualText;
}

function runtimeLabel(runtimeId: RuntimeId, lang: 'zh' | 'en'): string {
  return getRuntimeDisplayName(runtimeId, lang);
}

const CAPABILITY_DISPLAY: Readonly<Record<string, CapabilityDisplay>> = {
  widget: {
    label: { zh: 'çæ Widget', en: 'Generate Widget' },
    description: {
      zh: 'è®©æ¨¡åçæäº¤äºå¡çæå¾è¡¨ï¼ç´æ¥å¨å¯¹è¯éå±ç¤ºã?,
      en: 'Generates interactive cards or charts inline in chat.',
    },
  },
  memory: {
    label: { zh: 'è¯»åå©ç Memory', en: 'Read assistant memory' },
    description: {
      zh: 'æç´¢ / è¯»åå©çå·¥ä½åºçå¤å¿å½ä¸åå²ç¬è®°ã?,
      en: 'Search and read assistant workspace memo files.',
    },
  },
  tasks_and_notify: {
    label: { zh: 'å®æ¶ä»»å¡ä¸æé?, en: 'Scheduled tasks & notifications' },
    description: {
      zh: 'åå»ºå®æ¶ä»»å¡ãåéç³»ç»éç¥ / Telegram æéã?,
      en: 'Schedule tasks, send system notifications / Telegram alerts.',
    },
  },
  assistant_buddy: {
    label: { zh: 'å©çä¼ä¼´', en: 'Assistant buddy' },
    description: {
      zh: 'å­µåæå½åä½ çå©çä¼ä¼´ã?,
      en: 'Hatch or name your assistant buddy.',
    },
  },
  image_generation: {
    label: { zh: 'çæåªä½', en: 'Generate media' },
    description: {
      zh: 'è°ç¨å¾åæè§é¢çææ¨¡åï¼çæç»æç´æ¥åºç°å¨èå¤©éã?,
      en: 'Calls an image or video generation model; results appear inline in chat.',
    },
  },
  media_import: {
    label: { zh: 'å¯¼å¥åªä½', en: 'Import media' },
    description: {
      zh: 'ææ¬å°å¾ç?/ è§é¢ / é³é¢å¯¼å¥åªä½åºï¼åç»­å¯å¼ç¨ã?,
      en: 'Import a local image / video / audio file into the media library.',
    },
  },
  dashboard: {
    label: { zh: 'çæ¿æä½', en: 'Dashboard operations' },
    description: {
      zh: 'æ?Widget åºå®å°çæ¿ãåå?/ å·æ° / ç§»é¤å·²åºå®é¡¹ã?,
      en: 'Pin widgets to dashboard, list / refresh / remove pinned items.',
    },
  },
  cli_tools: {
    label: { zh: 'CLI å·¥å·ç®¡ç', en: 'CLI tools management' },
    description: {
      zh: 'æ¥çãå®è£ãæ´æ°æå¸è½½æ¬æº CLI å·¥å·ã?,
      en: 'List, install, update, or remove local CLI tools.',
    },
  },
};

/** Public lookup. Returns `undefined` for unknown capability ids so
 *  the caller can fall back gracefully (UI shows the raw id as
 *  fallback rather than crashing). Coverage test pins that every
 *  catalog id has an entry. */
export function getCapabilityDisplay(capabilityId: string): CapabilityDisplay | undefined {
  return CAPABILITY_DISPLAY[capabilityId];
}

/** Iterate all known capability ids â?used by the coverage test. */
export function knownCapabilityIds(): readonly string[] {
  return Object.keys(CAPABILITY_DISPLAY);
}

/**
 * Build the user-facing reason string for a capability that is NOT
 * executable on the current Runtime. The output is plain user
 * language â?no MCP / bridge / phase references.
 *
 * Examples (zh):
 *   "å½åå¼æ (Codex) æä¸æ¯æãçæ¿æä½ããå¦éä½¿ç¨ï¼è¯·åå° CodePilot æ?Claude Codeã?
 *   "å½åå¼æä¸æ¯æãå©çä¼ä¼´ããå¦éä½¿ç¨ï¼è¯·åå° Claude Codeã?
 *   "å½åå¼ææä¸æ¯æãCLI å·¥å·ç®¡çãã?
 */
export function buildUserReason(args: {
  readonly capabilityId: string;
  readonly currentRuntime: RuntimeId;
  /** Suggested Runtime that CAN execute the capability. `undefined`
   *  means no Runtime supports it (rare â?most "unsupported" cells
   *  are perception-only somewhere). */
  readonly suggestedRuntimes: readonly RuntimeId[];
  readonly lang: 'zh' | 'en';
}): string {
  const display = CAPABILITY_DISPLAY[args.capabilityId];
  const labelText = display?.label[args.lang] ?? args.capabilityId;

  if (args.lang === 'zh') {
    const current = runtimeLabel(args.currentRuntime, 'zh');
    if (args.suggestedRuntimes.length === 0) {
      return `å½åå¼æï¼?{current}ï¼æä¸æ¯æã?{labelText}ãã`;
    }
    const list = args.suggestedRuntimes
      .map((r) => runtimeLabel(r, 'zh'))
      .join(' æ?');
    return `å½åå¼æï¼?{current}ï¼ä¸è½ç´æ¥è°ç¨ã?{labelText}ããå¦éä½¿ç¨ï¼è¯·åå° ${list}ã`;
  }
  const current = runtimeLabel(args.currentRuntime, 'en');
  if (args.suggestedRuntimes.length === 0) {
    return `â?{labelText}â?isnât available in the current engine (${current}).`;
  }
  const list = args.suggestedRuntimes
    .map((r) => runtimeLabel(r, 'en'))
    .join(' or ');
  return `The current engine (${current}) cannot call â?{labelText}â?directly. Switch to ${list} to use it.`;
}

/** Standard "callable" status line â?kept here so the matrix
 *  derivation doesn't need to know about bilingual strings. */
export const CALLABLE_STATUS_LINE: BilingualText = {
  zh: 'å¯è°ç?,
  en: 'Callable',
};

/**
 * Codex Account override note for the dialog header â?explains that
 * the Codex side has its OWN native plugins / Skills (managed by
 * Codex itself), and the list below ONLY describes whether CodePilot
 * Harness capabilities can be injected.
 */
export const CODEX_ACCOUNT_HEADER_NOTE: BilingualText = {
  zh:
    'Codex èªå¸¦çæä»?/ Skills ç?Codex èªå·±ç®¡çï¼ä¸æ¹æ¸åä»å±ç¤º CodePilot è¿ä¸ä¾§çåç½®è½åæ¯å¦è½è¢«æ³¨å¥æè°ç¨ãå½åé»è®¤æå¡åæ?Codex Accountï¼CodePilot å·¥å·æ¡¥å¨è¿æ¡è·¯å¾ä¸ä¸å¯ç¨ã?,
  en:
    'Codexâs own plugins / Skills are managed by Codex itself. The list below only describes whether CodePilotâs built-in Harness can be injected or called. Codex Account is your current default provider, so the CodePilot tool bridge is not active on this path.',
};

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Phase 5e round 8 (2026-05-18) â?user-extensions section.
//
// The built-in capability matrix above describes buckyball.ai's first-
// party capabilities (widget / memory / tasks / image / media /
// dashboard / cli_tools / assistant_buddy). User-defined extensions
// (MCP servers configured in CodePilot Settings or project .mcp.json,
// .claude/skills, .claude/commands slash commands, project CLAUDE.md
// workspace rules) are a SEPARATE concern â?their executability per
// Runtime is summarized here for the Settings â?Runtime dialog.
//
// We intentionally do NOT inject these into HARNESS_CAPABILITIES /
// the capability matrix: those structures are the engineering source
// of truth for tool-name â?MCP/SDK exposure for the built-in tools,
// and a synthetic "extensions" row there would break the
// capability-matrix derivation contract test ("every cell references
// a real capability in HARNESS_CAPABILITIES").
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

export type UserExtensionsStatus = 'executable' | 'partial' | 'perception_only';

export interface UserExtensionsSummary {
  readonly runtimeId: RuntimeId;
  readonly status: UserExtensionsStatus;
  readonly label: BilingualText;
  readonly description: BilingualText;
}

/**
 * Per-Runtime user-extensions executability summary. The runtime-
 * specific copy mirrors `user-codepilot-extensions.ts:executableForKind`
 * (which is the engineering source of truth) â?both must agree.
 *
 * Tests pin that:
 *   - claude_code â?executable (mcp_server + skill + slash_command + workspace_rule all wire)
 *   - bbagent â?partial (mcp_server + workspace_rule wire; skill + slash are CC-only)
 *   - codex_runtime â?perception_only (workspace_rule cross-runtime as text; mcp/skill/slash not on this path)
 */
export const USER_EXTENSIONS_SUMMARY: Record<RuntimeId, UserExtensionsSummary> = {
  claude_code: {
    runtimeId: 'claude_code',
    status: 'executable',
    label: { zh: 'ç¨æ·èªå®ä¹?MCP / Skills', en: 'User MCP / Skills' },
    description: {
      zh: 'Settings ééç½®ç MCP / é¡¹ç® .mcp.json / .claude/skills / .claude/commands ææ å½ä»¤ / é¡¹ç® CLAUDE.md é½å¯è¢«è°ç¨æè¯»åã?,
      en: 'Settings-configured MCP, project .mcp.json, .claude/skills, .claude/commands slash commands, and project CLAUDE.md are all available.',
    },
  },
  bbagent: {
    runtimeId: 'bbagent',
    status: 'partial',
    label: { zh: 'ç¨æ·èªå®ä¹?MCP / Skills', en: 'User MCP / Skills' },
    description: {
      zh: 'Settings / é¡¹ç® .mcp.json ç?MCP æå¡å¨ä¸é¡¹ç® CLAUDE.md å¯ç¨ï¼?claude/skills ä¸?.claude/commands ææ å½ä»¤æ?Claude Code ä¸å±ï¼å¦éä½¿ç¨è¯·åå?Claude Codeã?,
      en: 'Settings / project .mcp.json MCP servers and project CLAUDE.md are wired; .claude/skills and .claude/commands slash commands are Claude Code-only â?switch to Claude Code to use them.',
    },
  },
  codex_runtime: {
    runtimeId: 'codex_runtime',
    status: 'perception_only',
    label: { zh: 'ç¨æ·èªå®ä¹?MCP / Skills', en: 'User MCP / Skills' },
    description: {
      zh: 'é¡¹ç® CLAUDE.md ä½ä¸ºææ¬æç¤ºå¯¹æ¨¡åä»å¯è§ï¼ä½ç¨æ·èªå®ä¹?MCP / Skills / ææ å½ä»¤å?Codex è¿æ¡è·¯å¾ä¸æ æ³è°ç¨ãå¦éä½¿ç¨ï¼è¯·åå° Claude Code æ?CodePilotã?,
      en: 'Project CLAUDE.md is still visible to the model as a text prompt, but user-defined MCP servers / Skills / slash commands cannot be called on the Codex path. Switch to Claude Code or CodePilot to use them.',
    },
  },
};

/** Convenience lookup with a defensive default â?returns the codex
 *  variant as the conservative fallback if an unknown runtime id is
 *  passed (better to say "limited" than to overclaim). */
export function getUserExtensionsSummary(runtimeId: RuntimeId): UserExtensionsSummary {
  return USER_EXTENSIONS_SUMMARY[runtimeId] ?? USER_EXTENSIONS_SUMMARY.codex_runtime;
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Phase 5e round 8 (2026-05-18) â?inline tool-blocked hint.
//
// When the model tries to call a `codepilot_*` built-in tool that
// isn't available on the active Runtime (e.g. dashboard / cli_tools
// on Codex Runtime via provider proxy), the runtime layer surfaces
// the failure as a tool_result with is_error=true. The chat UI shows
// the error block, but without context the user has no idea WHY the
// tool isn't there or HOW to use it. This helper produces a one-line
// hint to attach below the tool result.
//
// Per user direction (round 8): "å¨èå¤©åå®¹çä¸æ¹ç¨ä¸ä¸ªå°å­å»æéã?// ä¸è¦éä¾¿ä¸ä¸ªæéé½ç¨ä¸ä¸ªéå¸¸å¤§çå¼¹çª? â?small inline text, never a
// modal.
//
// Static map (NOT derived from HARNESS_CAPABILITIES at runtime â?// capability-contract.ts pulls server-only MCP factory imports and
// can't load in the browser). A coverage test pins this map against
// HARNESS_CAPABILITIES.toolNames at unit-test time, so adding a new
// tool fails CI without a display-text update.
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/** Map of every `codepilot_*` built-in tool name â?its owning
 *  capability id. Coverage test pins this against
 *  `HARNESS_CAPABILITIES.toolNames`. */
export const TOOL_NAME_TO_CAPABILITY_ID: Readonly<Record<string, string>> = {
  // widget
  codepilot_load_widget_guidelines: 'widget',
  // memory
  codepilot_memory_recent: 'memory',
  codepilot_memory_search: 'memory',
  codepilot_memory_get: 'memory',
  // tasks_and_notify
  codepilot_notify: 'tasks_and_notify',
  codepilot_schedule_task: 'tasks_and_notify',
  codepilot_list_tasks: 'tasks_and_notify',
  codepilot_cancel_task: 'tasks_and_notify',
  // assistant_buddy (ClaudeCode SDK only)
  codepilot_hatch_buddy: 'assistant_buddy',
  // image_generation
  codepilot_generate_image: 'image_generation',
  codepilot_generate_video: 'image_generation',
  // media_import
  codepilot_import_media: 'media_import',
  // dashboard (claude_code + bbagent only)
  codepilot_dashboard_pin: 'dashboard',
  codepilot_dashboard_list: 'dashboard',
  codepilot_dashboard_refresh: 'dashboard',
  codepilot_dashboard_update: 'dashboard',
  codepilot_dashboard_remove: 'dashboard',
  // cli_tools (claude_code + bbagent only)
  codepilot_cli_tools_list: 'cli_tools',
  codepilot_cli_tools_install: 'cli_tools',
  codepilot_cli_tools_add: 'cli_tools',
  codepilot_cli_tools_remove: 'cli_tools',
  codepilot_cli_tools_check_updates: 'cli_tools',
  codepilot_cli_tools_update: 'cli_tools',
};

/** Which Runtimes can execute each capability. Mirrors the matrix
 *  derivation in `capability-matrix.ts` (which derives from
 *  `capability-contract.ts:exposure.kind`). A coverage test pins
 *  this against the runtime matrix. */
export const CAPABILITY_EXECUTABLE_RUNTIMES: Readonly<Record<string, readonly RuntimeId[]>> = {
  widget: ['claude_code', 'bbagent', 'codex_runtime'],
  memory: ['claude_code', 'bbagent', 'codex_runtime'],
  tasks_and_notify: ['claude_code', 'bbagent', 'codex_runtime'],
  image_generation: ['claude_code', 'bbagent', 'codex_runtime'],
  media_import: ['claude_code', 'bbagent', 'codex_runtime'],
  // Phase 5e round 8 follow-up (2026-05-18) â?Native parity shipped;
  // assistant_buddy now executable on Claude Code + buckyball.ai Native.
  // Codex Runtime proxy still doesn't bridge the hatch flow.
  assistant_buddy: ['claude_code', 'bbagent'],
  // Codex review P1 (2026-05-28) â?dashboard + cli_tools now reach
  // codex_runtime via the mutation-level MCP split (read auto / write
  // approval). The capability-matrix layer promotes the cells; the static
  // map mirrors that so the cross-check coverage test stays green.
  dashboard: ['claude_code', 'bbagent', 'codex_runtime'],
  cli_tools: ['claude_code', 'bbagent', 'codex_runtime'],
};

/**
 * Phase 8 Phase 4 (2026-05-27) â?optional bilingual caveats shown under a
 * capability REGARDLESS of status (keyed by `CapabilityMatrixCell.noteKey`).
 * Used when a capability is executable at the Runtime layer but carries an
 * honest behavioral caveat. Outcome-oriented per this file's rules â?no
 * internal wire vocabulary (no "MCP injection" / phase numbers in copy).
 */
export const CAPABILITY_NOTES: Readonly<Record<string, BilingualText>> = {
  memory_codex_native: {
    zh: 'Memory å·²æ¥å?Codexï¼æ¨¡åå¯å¨éè¦æ¶è°ç¨ã?,
    en: 'Memory is wired into Codex; the model can call it when needed.',
  },
  widget_codex_native: {
    zh: 'Widget å·²æ¥å?Codexï¼æ¨¡åå¯çæå¯æ¸²æç Widgetï¼æ¯æåºå®ãå¯¼å?PNGãæ¥çä»£ç ï¼ã?,
    en: 'Widget is wired into Codex; the model can generate renderable widgets (pin, export PNG, view code).',
  },
  tasks_codex_native: {
    zh: 'ä»»å¡ä¸éç¥å·²æ¥å?Codexï¼æ¨¡åå¯å¨éè¦æ¶è°ç¨ï¼è°ç¨åä¼è¯·ä½ ç¡®è®¤ï¼æç»åä¸ä¼æ§è¡ã?,
    en: 'Tasks & notifications are wired into Codex; the model can use them when needed. It asks for your confirmation first â?if you decline, nothing runs.',
  },
  dashboard_codex_native: {
    zh: 'ä»ªè¡¨çå·²æ¥å¥ Codexï¼æ¥çä¸å·æ°èªå¨å¯ç¨ï¼éãä¿®æ¹ãç§»é¤ä¼è¯·ä½ ç¡®è®¤ã?,
    en: 'Dashboard is wired into Codex: viewing and refreshing run automatically; pinning, updating, and removing ask for your confirmation first.',
  },
  cli_tools_codex_native: {
    zh: 'CLI å·¥å·ç®¡çå·²æ¥å?Codexï¼æ¥çä¸æ£æ¥æ´æ°èªå¨å¯ç¨ï¼å®è£ãæ·»å ãå¸è½½ãæ´æ°ä¼è¯·ä½ ç¡®è®¤ã?,
    en: 'CLI tools management is wired into Codex: listing and checking updates run automatically; install, add, remove, and update ask for your confirmation first.',
  },
};

export function getCapabilityNote(noteKey: string, lang: 'zh' | 'en'): string | undefined {
  return CAPABILITY_NOTES[noteKey]?.[lang];
}

/** Error-content patterns that the runtime layer emits when the
 *  model called a tool not in its toolset. Narrow on purpose â? *  legitimate runtime errors (API key invalid, rate limit, etc.)
 *  should NOT trigger a "switch runtime" hint, so we only fire on
 *  patterns that genuinely mean "this tool isn't here". Each
 *  runtime emits slightly different copy; pattern keeps regex
 *  case-insensitive and tolerant of whitespace. */
const UNSUPPORTED_TOOL_ERROR_RE =
  /tool\s+(?:not\s+found|unsupported|not\s+available|not\s+registered)|unknown\s+tool|no\s+such\s+tool|tool\s+["'][^"']+["']\s+(?:not\s+found|is\s+not\s+available)/i;

/** Was this tool error caused by the tool not existing on the
 *  current Runtime? (vs a legitimate runtime error from the tool
 *  itself.) Returns false on undefined inputs so callers can
 *  defensively `??` without crashing. */
export function isToolUnsupportedError(args: {
  readonly toolName: string | undefined;
  readonly errorContent: string | undefined;
  readonly isError: boolean | undefined;
}): boolean {
  if (!args.isError) return false;
  if (!args.toolName || !args.errorContent) return false;
  // Only fire for our `codepilot_*` tools â?the only ones whose
  // availability the matrix can speak to. Third-party MCP tool
  // errors are passed through unchanged.
  if (!TOOL_NAME_TO_CAPABILITY_ID[args.toolName]) return false;
  return UNSUPPORTED_TOOL_ERROR_RE.test(args.errorContent);
}

export interface ToolUnsupportedHint {
  readonly capabilityId: string;
  readonly capabilityLabel: BilingualText;
  readonly suggestedRuntimes: readonly RuntimeId[];
  readonly hint: BilingualText;
}

/** Build the inline hint shown below a tool result that errored
 *  because the tool isn't supported on the active Runtime. Returns
 *  `null` if the tool name isn't in our catalog (defensive â?UI
 *  falls back to just the raw error). */
export function buildToolUnsupportedHint(toolName: string): ToolUnsupportedHint | null {
  const capabilityId = TOOL_NAME_TO_CAPABILITY_ID[toolName];
  if (!capabilityId) return null;
  const display = CAPABILITY_DISPLAY[capabilityId];
  if (!display) return null;
  const runtimes = CAPABILITY_EXECUTABLE_RUNTIMES[capabilityId] ?? [];

  const runtimeLabelsZh = runtimes.map((r) => runtimeLabel(r, 'zh')).join(' æ?');
  const runtimeLabelsEn = runtimes.map((r) => runtimeLabel(r, 'en')).join(' or ');

  const hintZh = runtimes.length
    ? `è¿ä¸ªå·¥å·å±äºã?{display.label.zh}ãï¼éè¦å¨ ${runtimeLabelsZh} ä¸æè½è°ç¨ã`
    : `è¿ä¸ªå·¥å·å±äºã?{display.label.zh}ãï¼å½åææå¼æé½æä¸æ¯æã`;
  const hintEn = runtimes.length
    ? `This tool is part of â?{display.label.en}â?â?switch to ${runtimeLabelsEn} to use it.`
    : `This tool is part of â?{display.label.en}â?and is not callable on any engine right now.`;

  return {
    capabilityId,
    capabilityLabel: display.label,
    suggestedRuntimes: runtimes,
    hint: { zh: hintZh, en: hintEn },
  };
}
