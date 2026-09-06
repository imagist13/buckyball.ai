/**
 * skill-executor.ts — Execute skills in the Native Runtime.
 *
 * Inline mode: Inject the skill's prompt body into the conversation.
 * Fork mode: Start a sub-agent with restricted tools (requires Phase 7 AgentTool).
 *
 * bbdev Skill:
 * - Always fork mode
 * - allowedTools 来自 SKILL.md frontmatter（已通过 generateBbdevSkillDefinition 限定）
 * - 子 Agent 通过 Claude Code / Codex 各自 SDK 自动 fork；Native Runtime 通过
 *   AgentTool（tools/agent.ts）走 codepilot_spawn_subagent 路径
 * - 本模块负责 fork 标记 + bbdev-specific 上下文注入；不负责实际 sub-agent 启动
 */

import path from 'path';
import type { SkillDefinition } from './skill-parser';
import { BBDEV_SKILL_NAME } from './bbdev/skill-generator';
import { bbdevTaskTracker } from './bbdev/task-tracker';

export interface SkillExecutionResult {
  /** The prompt text to inject (for inline mode) */
  prompt: string;
  /** Whether this should be executed as a sub-agent */
  fork: boolean;
  /** Tool restrictions for fork mode */
  allowedTools?: string[];
  /** bbdev-specific: trace_ids that the sub-agent is expected to produce (for UI hint) */
  bbdevTraceIds?: string[];
  /** bbdev-specific: structured fork envelope (used by tools/skill.ts to route) */
  forkEnvelope?: BbdevSkillForkEnvelope;
}

/**
 * Structured fork envelope for bbdev skill.
 * tools/skill.ts returns this verbatim; agent-loop / Claude Code / Codex
 * are responsible for spawning the sub-agent according to Runtime policy.
 */
export interface BbdevSkillForkEnvelope {
  kind: 'bbdev_skill_fork';
  prompt: string;
  allowedTools: string[];
  skillName: string;
  /** Sub-agent should use this working directory (buckyball repo root) */
  workingDirectory?: string;
  /** Current chip context (informational; sub-agent reads SKILL.md body) */
  chip?: string;
  /** Current balldomain context (informational) */
  balldomain?: string;
  /** bbdev MCP server name (sub-agent should use these tools) */
  mcpServerName: string;
}

/**
 * Check whether the given skill is the bbdev skill.
 */
export function isBbdevSkill(skill: SkillDefinition): boolean {
  return skill.name.toLowerCase() === BBDEV_SKILL_NAME.toLowerCase();
}

/**
 * Get a snapshot of currently active bbdev trace IDs.
 * Sub-agent can poll these via bbdev_task_status, but tracking here is
 * only a hint for the parent UI.
 */
export function snapshotBbdevTraceIds(): string[] {
  return bbdevTaskTracker.getActiveTasks().map(t => t.traceId);
}

/**
 * Prepare a skill for execution.
 *
 * For inline skills: returns the prompt body with argument substitution.
 * For fork skills: returns the prompt + fork flag + tool restrictions.
 * For bbdev skill (fork mode): returns a structured envelope so the caller
 * can route to the appropriate Runtime's fork mechanism.
 */
export function prepareSkillExecution(
  skill: SkillDefinition,
  args: Record<string, string> = {},
): SkillExecutionResult {
  let prompt = skill.body;

  // Substitute template variables ($arg or ${arg})
  for (const [key, value] of Object.entries(args)) {
    prompt = prompt.replace(new RegExp(`\\$\\{?${key}\\}?`, 'g'), value);
  }

  // Substitute built-in variables
  prompt = prompt.replace(/\$\{CLAUDE_SKILL_DIR\}/g, getSkillDir(skill.filePath));

  const isFork = skill.context === 'fork';
  const allowedTools = skill.allowedTools.length > 0 ? skill.allowedTools : undefined;

  // bbdev-specific fork envelope
  if (isFork && isBbdevSkill(skill)) {
    const workingDirectory = path.dirname(skill.filePath).replace(/[/\\]\.claude[/\\]skills$/, '');

    const envelope: BbdevSkillForkEnvelope = {
      kind: 'bbdev_skill_fork',
      prompt,
      allowedTools: allowedTools ?? [],
      skillName: skill.name,
      workingDirectory,
      mcpServerName: 'bbdev', // McpConnectionManager 注册名
    };

    return {
      prompt,
      fork: true,
      allowedTools,
      bbdevTraceIds: snapshotBbdevTraceIds(),
      forkEnvelope: envelope,
    };
  }

  return {
    prompt,
    fork: isFork,
    allowedTools,
  };
}

function getSkillDir(filePath: string): string {
  // If SKILL.md is in a subdirectory, return that directory
  // e.g. .claude/skills/my-skill/SKILL.md → .claude/skills/my-skill/
  const dir = filePath.replace(/[/\\][^/\\]+$/, '');
  return dir;
}
