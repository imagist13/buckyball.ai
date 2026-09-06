/**
 * BB Assistant — assistant heartbeat shim
 *
 * Phase M1 moved this module to `src/lib/bbagent/assistant/reconcile.ts`.
 * All imports here are re-exports so the existing import sites do not
 * need to change. This shim is temporary — Phase M4 of the
 * assistant-merge-into-bbagent plan will update all import sites and
 * remove this file.
 */

export {
  readBbAssistantHeartbeatDesiredState as readAssistantHeartbeatDesiredState,
  type BbAssistantHeartbeatDesiredState as AssistantHeartbeatDesiredState,
  type BbAssistantHeartbeatDesiredRead as AssistantHeartbeatDesiredRead,
  bbAssistantHeartbeatTaskMatchesDesired as heartbeatTaskMatchesDesired,
  reconcileBbAssistantHeartbeat as reconcileAssistantHeartbeat,
  recordBbAssistantHeartbeatOutcome as recordAssistantHeartbeatOutcome,
  type BbAssistantHeartbeatReconcileResult as AssistantHeartbeatReconcileResult,
} from './bbagent/assistant/reconcile';
