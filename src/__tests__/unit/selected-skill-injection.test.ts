import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveSelectedSkillInjection,
  resolveSelectedSkillInjectionCore,
  SelectedSkillNotFoundError,
} from '@/lib/selected-skill-injection';
import { invalidateSkillCache } from '@/lib/skill-discovery';

const workspaces: string[] = [];

function workspace(skills: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selected-skill-'));
  workspaces.push(root);
  for (const [name, markdown] of Object.entries(skills)) {
    const dir = path.join(root, '.claude', 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), markdown);
  }
  invalidateSkillCache();
  return root;
}

afterEach(() => {
  for (const root of workspaces.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  invalidateSkillCache();
});

describe('selected Skill deterministic injection', () => {
  it('injects the actual inline SKILL.md body', () => {
    const root = workspace({
      review: '---\nname: review\ncontext: inline\n---\nInspect every changed file before answering.',
    });
    const resolved = resolveSelectedSkillInjection(['review'], root);
    assert.ok(resolved);
    assert.equal(resolved.requiresFork, false);
    assert.match(resolved.systemPromptAppend, /Inspect every changed file/);
    assert.match(resolved.systemPromptAppend, /Apply the following Skill instructions directly/);
  });

  it('deduplicates and injects every selected Skill', () => {
    const root = workspace({
      alpha: '---\nname: alpha\n---\nAlpha body.',
      beta: '---\nname: beta\n---\nBeta body.',
    });
    const resolved = resolveSelectedSkillInjection(['/alpha', 'BETA', 'alpha'], root);
    assert.ok(resolved);
    assert.deepEqual(resolved.skillNames, ['alpha', 'beta']);
    assert.match(resolved.systemPromptAppend, /Alpha body/);
    assert.match(resolved.systemPromptAppend, /Beta body/);
  });

  it('requires an Agent subtask for a fork Skill and preserves its body', () => {
    const root = workspace({
      bbdev: '---\nname: bbdev\ncontext: fork\nallowed-tools: [Read, bbdev_compiler_build]\n---\nRun the bbdev compiler and poll its trace id.',
    });
    const resolved = resolveSelectedSkillInjection(['bbdev'], root);
    assert.ok(resolved);
    assert.equal(resolved.requiresFork, true);
    assert.match(resolved.systemPromptAppend, /MUST execute this Skill through exactly one Agent subtask/);
    assert.match(resolved.systemPromptAppend, /bbdev_compiler_build/);
    assert.match(resolved.systemPromptAppend, /Run the bbdev compiler/);
  });

  it('refreshes discovery before resolving a newly added selected Skill', () => {
    const root = workspace({});
    assert.throws(() => resolveSelectedSkillInjection(['ball'], root), SelectedSkillNotFoundError);

    const skillDir = path.join(root, '.claude', 'skills', 'ball');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: ball\ncontext: inline\n---\nBuild the selected ball task.',
    );

    const resolved = resolveSelectedSkillInjection(['ball'], root);
    assert.ok(resolved);
    assert.match(resolved.systemPromptAppend, /Build the selected ball task/);
  });

  it('fails honestly when a selected Skill is unavailable', () => {
    const root = workspace({});
    assert.throws(
      () => resolveSelectedSkillInjection(['missing-skill'], root),
      (error: unknown) => error instanceof SelectedSkillNotFoundError
        && error.missingSkills[0] === 'missing-skill',
    );
  });

  it('falls back to the buckyball repoRoot for project skills located outside the chat cwd', () => {
    // chat session cwd has no buckyball project skills
    const sessionCwd = workspace({});
    // buckyball repo root has the project-level ball/verify/check skills
    const repoRoot = workspace({
      ball: '---\nname: ball\ncontext: inline\n---\nBuckyball ball body.',
      verify: '---\nname: verify\ncontext: inline\n---\nBuckyball verify body.',
    });

    const resolved = resolveSelectedSkillInjectionCore(
      ['ball', 'verify'],
      sessionCwd,
      repoRoot,
    );
    assert.ok(resolved);
    assert.equal(resolved.requiresFork, false);
    assert.deepEqual(resolved.skillNames, ['ball', 'verify']);
    assert.match(resolved.systemPromptAppend, /Buckyball ball body/);
    assert.match(resolved.systemPromptAppend, /Buckyball verify body/);
  });

  it('prefers the chat cwd over the buckyball fallback when both define the same skill', () => {
    // both directories define `ball`; the chat cwd's copy must win
    const sessionCwd = workspace({
      ball: '---\nname: ball\ncontext: inline\n---\nChat-workspace ball body.',
    });
    const repoRoot = workspace({
      ball: '---\nname: ball\ncontext: inline\n---\nBuckyball-repo ball body.',
    });

    const resolved = resolveSelectedSkillInjectionCore(
      ['ball'],
      sessionCwd,
      repoRoot,
    );
    assert.ok(resolved);
    assert.match(resolved.systemPromptAppend, /Chat-workspace ball body/);
    assert.doesNotMatch(resolved.systemPromptAppend, /Buckyball-repo ball body/);
  });

  it('still throws SelectedSkillNotFoundError when the fallback repo also lacks the skill', () => {
    const sessionCwd = workspace({});
    const repoRoot = workspace({});

    assert.throws(
      () => resolveSelectedSkillInjectionCore(['ball'], sessionCwd, repoRoot),
      (error: unknown) => error instanceof SelectedSkillNotFoundError
        && error.missingSkills[0] === 'ball',
    );
  });
});
