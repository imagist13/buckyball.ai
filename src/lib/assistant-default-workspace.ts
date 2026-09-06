/**
 * BB Assistant — default workspace bootstrap shim
 *
 * Phase M1 moved this module to `src/lib/bbagent/assistant/bootstrap.ts`.
 * All imports here are re-exports so the existing import sites do not
 * need to change. This shim is temporary — Phase M4 of the
 * assistant-merge-into-bbagent plan will update all import sites and
 * remove this file.
 */

export {
  BB_ASSISTANT_WORKSPACE_PATH_SETTING as ASSISTANT_WORKSPACE_PATH_SETTING,
  bootstrapBbAssistantDefaultWorkspace as bootstrapDefaultAssistantWorkspace,
  type BbAssistantBootstrapResult,
} from './bbagent/assistant/bootstrap';
