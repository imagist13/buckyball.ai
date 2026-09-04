/**
 * BB Assistant — assistant workspace shim
 *
 * Phase M1 moved this module to `src/lib/bbagent/assistant/workspace.ts`.
 * All imports here are re-exports so the existing import sites do not
 * need to change. This shim is temporary — Phase M4 of the
 * assistant-merge-into-bbagent plan will update all import sites and
 * remove this file.
 */

// ── initialization / state ────────────────────────────────────────

export {
  initializeBbAssistantWorkspace as initializeWorkspace,
  loadBbAssistantState as loadState,
  saveBbAssistantState as saveState,
} from './bbagent/assistant/workspace';

// ── validation ────────────────────────────────────────────────────

export {
  validateBbAssistantWorkspace as validateWorkspace,
} from './bbagent/assistant/workspace';

// ── instruction mirrors ───────────────────────────────────────────

export {
  inspectBbAssistantInstructionMirrors as inspectInstructionMirrors,
  reconcileBbAssistantInstructionMirrors as reconcileInstructionMirrors,
  type BbInstructionMirrorStatus,
  type BbInstructionMirrorInspection,
  type BbInstructionMirrorsInspection,
  type BbInstructionMirrorsReconcileResult,
} from './bbagent/assistant/workspace';

// ── canonical rules omission ───────────────────────────────────────

export {
  shouldOmitBbAssistantCanonicalRules as shouldOmitCanonicalRules,
} from './bbagent/assistant/workspace';

// ── file loading ───────────────────────────────────────────────────

export {
  loadBbAssistantWorkspaceFiles as loadWorkspaceFiles,
} from './bbagent/assistant/workspace';

// ── prompt assembly ────────────────────────────────────────────────

export {
  assembleBbAssistantWorkspacePrompt as assembleWorkspacePrompt,
} from './bbagent/assistant/workspace';

// ── root / directory docs ──────────────────────────────────────────

export {
  generateBbAssistantRootDocs as generateRootDocs,
  generateBbAssistantDirectoryDocs as generateDirectoryDocs,
} from './bbagent/assistant/workspace';

// ── daily memory ──────────────────────────────────────────────────

export {
  ensureBbAssistantDailyDir as ensureDailyDir,
  writeBbAssistantDailyMemory as writeDailyMemory,
  loadBbAssistantDailyMemories as loadDailyMemories,
} from './bbagent/assistant/workspace';

// ── state migration ────────────────────────────────────────────────

export {
  migrateBbAssistantStateV1ToV2 as migrateStateV1ToV2,
  migrateBbAssistantStateV2ToV3 as migrateStateV2ToV3,
} from './bbagent/assistant/workspace';

// ── heartbeat eligibility ─────────────────────────────────────────

export {
  needsBbAssistantDailyCheckIn as needsDailyCheckIn,
  shouldRunBbAssistantHeartbeat,
} from './bbagent/assistant/workspace';

// ── types (re-export from types/index.ts for convenience) ─────────

export type {
  AssistantWorkspaceState,
  AssistantWorkspaceFiles,
  AssistantWorkspaceFilesV2,
} from '@/types';
