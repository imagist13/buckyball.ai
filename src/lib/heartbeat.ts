/**
 * BB Assistant — heartbeat shim
 *
 * Phase M1 moved this module to `src/lib/bbagent/assistant/heartbeat.ts`.
 * All imports here are re-exports so the existing import sites do not
 * need to change. This shim is temporary — Phase M4 of the
 * assistant-merge-into-bbagent plan will update all import sites and
 * remove this file.
 */

// ── heartbeat protocol ─────────────────────────────────────────────

export {
  BB_HEARTBEAT_TOKEN as HEARTBEAT_TOKEN,
  classifyBbHeartbeatOutcome as classifyHeartbeatOutcome,
  isBbHeartbeatContentEmpty as isHeartbeatContentEmpty,
  isBbWithinActiveHours,
  shouldSkipBbDuplicate,
} from './bbagent/assistant/heartbeat';

// ── template ───────────────────────────────────────────────────────

export { BB_HEARTBEAT_TEMPLATE as HEARTBEAT_TEMPLATE } from './bbagent/assistant/heartbeat';
