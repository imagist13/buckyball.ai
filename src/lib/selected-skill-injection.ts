/**
 * selected-skill-injection.ts — Deterministic execution contract for composer-selected Skills.
 *
 * A badge selection is an explicit user instruction, not an optional hint to the
 * model. Resolve every selected SKILL.md before a turn starts so an absent skill
 * fails honestly, inline skills are injected verbatim, and fork skills carry an
 * unambiguous Agent-subtask requirement.
 */

import { getSkill, invalidateSkillCache } from './skill-discovery';
import { prepareSkillExecution } from './skill-executor';
import { getBuckyballRepoRoot } from './bbdev/project-skills';

export class SelectedSkillNotFoundError extends Error {
  readonly missingSkills: readonly string[];

  constructor(missingSkills: readonly string[]) {
    super(`Selected Skill${missingSkills.length === 1 ? '' : 's'} not found: ${missingSkills.join(', ')}`);
    this.name = 'SelectedSkillNotFoundError';
    this.missingSkills = missingSkills;
  }
}

export interface SelectedSkillInjection {
  /** Actual SKILL.md bodies and execution constraints for this turn. */
  systemPromptAppend: string;
  /** At least one selected Skill requires an Agent subtask. */
  requiresFork: boolean;
  /** Canonical, deduplicated Skill names used for the resolved contract. */
  skillNames: readonly string[];
}

function canonicalizeSkillName(value: string): string {
  return value.trim().replace(/^\/+/, '');
}

function resolveSelectedSkill(
  name: string,
  workingDirectory: string,
  fallbackDirectory: string | undefined,
) {
  const workspaceSkill = getSkill(name, workingDirectory);
  if (workspaceSkill) return workspaceSkill;

  // buckyball 仓库下挂着一组项目级 Skills（ball / verify / check / debug / ...），
  // 物理路径可能在 `<repoRoot>/.claude/skills/<name>/SKILL.md`，但 chat session
  // 的 working directory 不一定是 buckyball 仓库根。当用户在前端选了这类
  // skill、提交到 /api/chat 时，单纯扫 workingDirectory 找不到，必须以配置的
  // buckyball repoRoot 作为 fallback，否则会抛 422。
  if (fallbackDirectory && fallbackDirectory !== workingDirectory) {
    const fallbackSkill = getSkill(name, fallbackDirectory);
    console.log(
      `[selected-skill-injection] name=${name} cwd=${workingDirectory} ` +
      `fallback=${fallbackDirectory} foundInWorkspace=${Boolean(workspaceSkill)} ` +
      `foundInFallback=${Boolean(fallbackSkill)}`,
    );
    return fallbackSkill;
  }
  console.log(
    `[selected-skill-injection] name=${name} cwd=${workingDirectory} ` +
    `fallback=${fallbackDirectory ?? 'undefined'} foundInWorkspace=${Boolean(workspaceSkill)} ` +
    `noFallbackApplied=true`,
  );
  return undefined;
}

/**
 * Resolve selected Skills from the current workspace and build the exact prompt
 * fragment used by the Native Runtime. Throws before model invocation when any
 * selected Skill is unavailable.
 */
export function resolveSelectedSkillInjection(
  selectedSkills: readonly string[] | undefined,
  workingDirectory: string,
): SelectedSkillInjection | undefined {
  return resolveSelectedSkillInjectionCore(
    selectedSkills,
    workingDirectory,
    getBuckyballRepoRoot(),
  );
}

/**
 * Core resolution. Exported (without re-export) for unit tests so they can
 * inject a deterministic fallback directory without touching the bbdev
 * settings store. Production code must call the public `resolveSelectedSkillInjection`.
 */
export function resolveSelectedSkillInjectionCore(
  selectedSkills: readonly string[] | undefined,
  workingDirectory: string,
  fallbackDirectory: string | undefined,
): SelectedSkillInjection | undefined {
  const names = [...new Set(
    (selectedSkills ?? [])
      .map(canonicalizeSkillName)
      .filter(Boolean)
      .map(name => name.toLowerCase()),
  )];
  if (names.length === 0) return undefined;

  // The command popover scans the filesystem live. Clear the separate
  // resolver cache so a just-created or edited Skill cannot be selectable
  // in the UI yet falsely reported missing when the turn is sent.
  invalidateSkillCache();
  const resolved = names.map(name => ({
    name,
    skill: resolveSelectedSkill(name, workingDirectory, fallbackDirectory),
  }));
  const missing = resolved.filter(({ skill }) => !skill).map(({ name }) => name);
  if (missing.length > 0) throw new SelectedSkillNotFoundError(missing);

  const fragments: string[] = [
    '[Selected Skill execution contract]',
    'The user explicitly selected the following Skills for this turn. Their instructions are mandatory and must be followed before producing the final answer.',
  ];
  let requiresFork = false;

  for (const { name, skill } of resolved) {
    // `missing` is handled above; retain this guard for TypeScript narrowing.
    if (!skill) continue;
    const execution = prepareSkillExecution(skill);
    if (execution.fork) {
      requiresFork = true;
      fragments.push([
        `## Skill: ${name} (fork required)`,
        'You MUST execute this Skill through exactly one Agent subtask before answering. Do not perform this Skill directly in the parent turn and do not merely describe the subtask.',
        'Pass the complete Skill body below to the Agent. The subtask inherits this turn\'s working directory, MCP connections, and permission policy. If the Agent tool is unavailable or the subtask fails, report that failure explicitly.',
        execution.allowedTools?.length
          ? `The subtask may use only these Skill-approved tools: ${execution.allowedTools.join(', ')}.`
          : 'The Skill does not declare an additional tool allowlist.',
        '--- SKILL.md body ---',
        execution.prompt,
        '--- end SKILL.md body ---',
      ].join('\n'));
    } else {
      fragments.push([
        `## Skill: ${name} (inline)`,
        'Apply the following Skill instructions directly to this turn.',
        '--- SKILL.md body ---',
        execution.prompt,
        '--- end SKILL.md body ---',
      ].join('\n'));
    }
  }

  return { systemPromptAppend: fragments.join('\n\n'), requiresFork, skillNames: names };
}
