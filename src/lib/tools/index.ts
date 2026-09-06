/**
 * tools/index.ts — Tool registry for the Native Runtime.
 *
 * Exports all built-in tools as a ToolSet ready for streamText().
 * Each tool is a factory function that takes ToolContext and returns a Tool.
 */

import type { ToolSet } from 'ai';
import { createReadTool } from './read';
import { createWriteTool } from './write';
import { createGlobTool } from './glob';
import { createGrepTool } from './grep';
import { createBashTool } from './bash';
import { createEditTool } from './edit';
import { createSkillTool } from './skill';
import { createAgentTool } from './agent';
import type { ProviderCallScene } from '../provider-call-policy';

export interface ToolContext {
  /** Working directory for file operations */
  workingDirectory: string;
  /** Session ID (for checkpoint tracking) */
  sessionId?: string;
  /** Provider ID (for sub-agents) */
  providerId?: string;
  /** Session provider ID (for sub-agents) */
  sessionProviderId?: string;
  /** Current model ID (for sub-agents to inherit) */
  model?: string;
  /** Permission mode (for sub-agents) */
  permissionMode?: string;
  /** Parent session explicitly selected the full-access profile. */
  bypassPermissions?: boolean;
  /** SSE emitter callback — passed to sub-agents for permission forwarding */
  emitSSE?: (event: { type: string; data: string }) => void;
  /** Abort signal from parent */
  abortSignal?: AbortSignal;
  /** Scene of the parent invocation; sub-agent spawning is interactive-only. */
  parentCallScene?: ProviderCallScene;
}

/**
 * Create the full set of built-in coding tools.
 */
export function createBuiltinTools(ctx: ToolContext): ToolSet {
  return {
    Read: createReadTool(ctx),
    Write: createWriteTool(ctx),
    Edit: createEditTool(ctx),
    Bash: createBashTool(ctx),
    Glob: createGlobTool(ctx),
    Grep: createGrepTool(ctx),
    Skill: createSkillTool(ctx.workingDirectory),
    Agent: createAgentTool({
      workingDirectory: ctx.workingDirectory,
      providerId: ctx.providerId,
      sessionProviderId: ctx.sessionProviderId,
      parentModel: ctx.model,
      permissionMode: ctx.permissionMode,
      bypassPermissions: ctx.bypassPermissions,
      parentSessionId: ctx.sessionId,
      emitSSE: ctx.emitSSE,
      abortSignal: ctx.abortSignal,
      parentCallScene: ctx.parentCallScene,
    }),
  };
}
