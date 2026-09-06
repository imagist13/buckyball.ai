import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSkillFile } from '@/lib/skill-parser';

describe('parseSkillFile frontmatter line endings', () => {
  it('parses a Unix LF frontmatter as before', () => {
    const md = [
      '---',
      'name: ball',
      'description: Create a new Buckyball Ball operator',
      'context: inline',
      '---',
      '',
      'Body paragraph.',
    ].join('\n');

    const skill = parseSkillFile(md, '/tmp/ball/SKILL.md');
    assert.equal(skill.name, 'ball');
    assert.equal(skill.description, 'Create a new Buckyball Ball operator');
    assert.equal(skill.context, 'inline');
    assert.equal(skill.body, 'Body paragraph.');
  });

  it('parses a Windows CRLF frontmatter (the buckyball regression case)', () => {
    // Exact shape of buckyball/.claude/skills/ball/SKILL.md on disk:
    // the file uses CRLF and previously the regex matched nothing,
    // so parseSkillFile silently fell back to name: "SKILL".
    const md = [
      '---',
      'name: ball',
      'description: Create a new Buckyball Ball operator named $ARGUMENTS.',
      '---',
      '',
      'Body paragraph.',
    ].join('\r\n');

    const skill = parseSkillFile(md, '/tmp/ball/SKILL.md');
    assert.equal(skill.name, 'ball');
    assert.equal(skill.description, 'Create a new Buckyball Ball operator named $ARGUMENTS.');
    assert.equal(skill.body, 'Body paragraph.');
  });

  it('parses a CRLF frontmatter with allow-tools and when_to_use', () => {
    const md = [
      '---',
      'name: ball',
      'allowed-tools: [Read, bbdev_compiler_build]',
      'when_to_use: Use when adding a new Ball operator',
      'arguments:',
      '  - name: $ARGUMENTS',
      '    description: operator name',
      'context: fork',
      '---',
      '',
      'Body.',
    ].join('\r\n');

    const skill = parseSkillFile(md, '/tmp/ball/SKILL.md');
    assert.equal(skill.name, 'ball');
    assert.deepEqual(skill.allowedTools, ['Read', 'bbdev_compiler_build']);
    assert.equal(skill.whenToUse, 'Use when adding a new Ball operator');
    assert.equal(skill.context, 'fork');
    assert.deepEqual(skill.arguments, [
      { name: '$ARGUMENTS', description: 'operator name' },
    ]);
  });

  it('parses a mixed CRLF/LF frontmatter (closing delimiter CRLF, body LF)', () => {
    const md = '---\r\nname: ball\r\n---\nBody LF only.';
    const skill = parseSkillFile(md, '/tmp/ball/SKILL.md');
    assert.equal(skill.name, 'ball');
    assert.equal(skill.body, 'Body LF only.');
  });

  it('parses the real buckyball ball/SKILL.md file on disk', () => {
    // Regression test against the actual file the user is loading.
    // Skip if the file is not present (CI may not check out buckyball).
    const repoRoot = path.resolve(process.cwd(), 'buckyball');
    const filePath = path.join(repoRoot, '.claude', 'skills', 'ball', 'SKILL.md');
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf-8');
    // Sanity: the file must actually use CRLF for this test to be meaningful.
    assert.ok(
      content.includes('\r\n'),
      `Expected ${filePath} to contain CRLF line endings`,
    );

    const skill = parseSkillFile(content, filePath);
    assert.equal(skill.name, 'ball');
    assert.notEqual(skill.description, '');
    assert.ok(skill.body.length > 0);
  });

  it('falls back to the file name when the frontmatter is missing entirely', () => {
    const md = 'Just some text, no frontmatter.';
    const skill = parseSkillFile(md, '/tmp/my-skill/SKILL.md');
    // fileNameToSkillName replaces [-_] with space; SKILL.md yields "SKILL".
    assert.equal(skill.name, 'SKILL');
    assert.equal(skill.description, '');
  });

  it('reads a CRLF SKILL.md from a temp directory and exposes a stable name', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-parser-crlf-'));
    try {
      const skillDir = path.join(root, '.claude', 'skills', 'ball');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\r\nname: ball\r\ncontext: inline\r\n---\r\nBody.\r\n',
      );

      const content = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');
      const skill = parseSkillFile(content, path.join(skillDir, 'SKILL.md'));
      assert.equal(skill.name, 'ball');
      assert.equal(skill.context, 'inline');
      assert.equal(skill.body, 'Body.');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
