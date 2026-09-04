/**
 * tools/skill.ts — SkillTool: lets the model discover and invoke skills.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { discoverSkills, getSkill } from '../skill-discovery';
import { prepareSkillExecution, isBbdevSkill, type BbdevSkillForkEnvelope } from '../skill-executor';

/**
 * Create the Skill tool. The model can use this to:
 * 1. List available skills (no arguments)
 * 2. Execute a specific skill by name
 */
export function createSkillTool(workingDirectory: string) {
  return tool({
    description:
      'Use a skill (reusable prompt template). ' +
      'Call with just skill_name to execute a skill. ' +
      'Call without arguments to list all available skills.',
    inputSchema: z.object({
      skill_name: z.string().optional().describe('Name of the skill to execute. Omit to list all skills.'),
      arguments: z.record(z.string(), z.string()).optional().describe('Arguments to pass to the skill (key-value pairs)'),
    }),
    execute: async ({ skill_name, arguments: args }) => {
      // List mode
      if (!skill_name) {
        const skills = discoverSkills(workingDirectory);
        if (skills.length === 0) {
          return 'No skills available. Skills can be added as SKILL.md files in .claude/skills/ or ~/.claude/skills/.';
        }

        return skills.map(s => {
          const parts = [`- **${s.name}**`];
          if (s.description) parts.push(`: ${s.description}`);
          if (s.whenToUse) parts.push(` (use when: ${s.whenToUse})`);
          if (s.context === 'fork') parts.push(' [fork]');
          return parts.join('');
        }).join('\n');
      }

      // Execute mode
      const skill = getSkill(skill_name, workingDirectory);
      if (!skill) {
        const available = discoverSkills(workingDirectory).map(s => s.name).join(', ');
        return `Skill "${skill_name}" not found. Available skills: ${available || 'none'}`;
      }

      const result = prepareSkillExecution(skill, args);

      if (result.fork) {
        // Fork mode — return a structured envelope so the agent-loop / Runtime
        // can spawn a sub-agent with restricted tools.
        //
        // Routing responsibility (per Runtime):
        // - Claude Code SDK / Codex: SKILL.md frontmatter (`context: fork` +
        //   `allowed-tools`) is honored natively; the sub-agent is spawned by
        //   the SDK. The model should invoke the skill via slash command /
        //   Skill tool, and the SDK forks automatically.
        // - Native Runtime: the `[SKILL_FORK]` envelope is parsed by
        //   agent-loop.ts (Phase 3 follow-up) to dispatch via codepilot_spawn_subagent.
        //
        // bbdev skill returns a structured `BbdevSkillForkEnvelope` so future
        // Native Runtime routing can attach bbdev MCP context to the sub-agent.

        if (isBbdevSkill(skill) && result.forkEnvelope) {
          const env: BbdevSkillForkEnvelope = result.forkEnvelope;
          return [
            '[SKILL_FORK:bbdev]',
            `kind: ${env.kind}`,
            `mcp_server: ${env.mcpServerName}`,
            `working_directory: ${env.workingDirectory || '(inherit from parent)'}`,
            `allowed_tools: ${env.allowedTools.join(', ') || 'all'}`,
            '',
            '---PROMPT---',
            env.prompt,
            '---ENDPROMPT---',
          ].join('\n');
        }

        return `[SKILL_FORK]\nPrompt: ${result.prompt}\nAllowed tools: ${result.allowedTools?.join(', ') || 'all'}`;
      }

      // Inline mode — return the prompt for injection into the conversation
      return result.prompt;
    },
  });
}
