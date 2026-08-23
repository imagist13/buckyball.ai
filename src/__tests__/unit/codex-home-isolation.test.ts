import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  mirrorCodexHomeEntry,
  prepareCodePilotCodexHome,
  resolveCodePilotCodexHome,
  resolveSourceCodexHome,
  type CodexMirrorOperations,
} from '@/lib/codex/home-isolation';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-codex-home-'));
  temporaryRoots.push(root);
  return root;
}

function writeRollout(home: string, id: string, originator: string): string {
  const dir = path.join(home, 'sessions', '2026', '08', '03');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-2026-08-03T10-00-00-${id}.jsonl`);
  fs.writeFileSync(file, `${JSON.stringify({
    type: 'session_meta',
    payload: { id, originator, source: 'vscode' },
  })}\n${JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } })}\n`);
  return file;
}

function filesystemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

const FORCE_HARDLINK: CodexMirrorOperations = {
  symlinkSync: () => { throw filesystemError('EPERM'); },
  linkSync: (source, target) => fs.linkSync(source, target),
};

const FORCE_COPY: CodexMirrorOperations = {
  symlinkSync: () => { throw filesystemError('EPERM'); },
  linkSync: () => { throw filesystemError('EXDEV'); },
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('CodePilot Codex home isolation', () => {
  it('resolves the user Harness home separately from CodePilot runtime state', () => {
    const home = path.join(temporaryRoot(), 'user');
    const data = path.join(temporaryRoot(), 'data');
    assert.equal(resolveSourceCodexHome({}, home), path.join(home, '.codex'));
    assert.equal(
      resolveCodePilotCodexHome({ CLAUDE_GUI_DATA_DIR: data }, home),
      path.join(data, 'codex-home'),
    );
  });

  it('mirrors Harness inputs, migrates only CodePilot rollouts, and keeps new writes isolated', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'source-codex');
    const data = path.join(root, 'codepilot-data');
    fs.mkdirSync(path.join(source, 'skills', 'my-skill'), { recursive: true });
    fs.writeFileSync(path.join(source, 'config.toml'), 'model = "gpt-test"\n');
    fs.writeFileSync(path.join(source, 'auth.json'), '{"auth_mode":"chatgpt"}\n', { mode: 0o600 });
    fs.writeFileSync(path.join(source, 'skills', 'my-skill', 'SKILL.md'), '# Skill\n');

    const codePilotId = '019e69a6-d9c4-7320-bc71-477bc6bd3a3f';
    const officialId = '019e69a6-d9c4-7320-bc71-477bc6bd3a40';
    const sourceCodePilotRollout = writeRollout(source, codePilotId, 'codex_codepilot');
    writeRollout(source, officialId, 'codex_cli_rs');
    const malformedDir = path.join(source, 'sessions', '2026', '08', '03');
    fs.writeFileSync(path.join(malformedDir, 'rollout-malformed.jsonl'), '{not-json}\n');

    const prepared = prepareCodePilotCodexHome({
      env: { CODEX_HOME: source, CLAUDE_GUI_DATA_DIR: data },
      homeDir: path.join(root, 'home'),
      platform: process.platform,
    });

    assert.equal(prepared.initializedNow, true);
    assert.equal(prepared.migratedRollouts, 1);
    assert.equal(prepared.skippedUnreadableRollouts, 1);
    const credentialMode = prepared.credentialMirrors['auth.json'];
    assert.ok(
      credentialMode === 'symlink' || credentialMode === 'hardlink',
      `expected a live credential mirror, got ${credentialMode}`,
    );
    const marker = JSON.parse(fs.readFileSync(
      path.join(prepared.codexHome, '.codepilot-codex-home-v1.json'),
      'utf8',
    )) as {
      version: number;
      migratedRollouts: number;
      skippedUnreadableRollouts: number;
      credentialMirrors: Record<string, string>;
      harnessSnapshotEntries: string[];
    };
    assert.deepEqual(marker, {
      version: 1,
      migratedRollouts: 1,
      skippedUnreadableRollouts: 1,
      credentialMirrors: { 'auth.json': credentialMode, '.credentials.json': 'absent' },
      harnessSnapshotEntries: [],
    });
    assert.equal(fs.readFileSync(path.join(prepared.codexHome, 'config.toml'), 'utf8'), 'model = "gpt-test"\n');
    assert.equal(fs.readFileSync(path.join(prepared.codexHome, 'skills', 'my-skill', 'SKILL.md'), 'utf8'), '# Skill\n');
    assert.equal(fs.readFileSync(path.join(prepared.codexHome, 'auth.json'), 'utf8'), '{"auth_mode":"chatgpt"}\n');

    const migrated = path.join(
      prepared.codexHome,
      'sessions',
      '2026',
      '08',
      '03',
      path.basename(sourceCodePilotRollout),
    );
    assert.equal(fs.existsSync(migrated), true);
    assert.equal(
      fs.existsSync(path.join(prepared.codexHome, 'sessions', '2026', '08', '03', `rollout-2026-08-03T10-00-00-${officialId}.jsonl`)),
      false,
    );

    fs.appendFileSync(migrated, '{"target":"only"}\n');
    assert.doesNotMatch(fs.readFileSync(sourceCodePilotRollout, 'utf8'), /target/);
  });

  it('mirrors relative file dependencies declared by config.toml', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'source-codex');
    const data = path.join(root, 'codepilot-data');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(
      path.join(source, 'config.toml'),
      [
        'model_catalog_json = "cc-switch-model-catalog.json"',
        "model_instructions_file = 'custom-instructions.md'",
        '',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(source, 'cc-switch-model-catalog.json'), '{"models":[]}\n');
    fs.writeFileSync(path.join(source, 'custom-instructions.md'), '# Custom\n');
    fs.writeFileSync(path.join(source, 'state_5.sqlite'), 'runtime state must stay isolated\n');

    const prepared = prepareCodePilotCodexHome({
      env: { CODEX_HOME: source, CLAUDE_GUI_DATA_DIR: data },
      homeDir: path.join(root, 'home'),
      platform: 'win32',
      mirrorOperations: FORCE_HARDLINK,
    });

    assert.equal(
      fs.readFileSync(path.join(prepared.codexHome, 'cc-switch-model-catalog.json'), 'utf8'),
      '{"models":[]}\n',
    );
    assert.equal(
      fs.readFileSync(path.join(prepared.codexHome, 'custom-instructions.md'), 'utf8'),
      '# Custom\n',
    );
    assert.equal(fs.existsSync(path.join(prepared.codexHome, 'state_5.sqlite')), false);
  });

  it('mirrors profile and nested agent config dependencies recursively', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'source-codex');
    const data = path.join(root, 'codepilot-data');
    fs.mkdirSync(path.join(source, 'agents'), { recursive: true });
    fs.writeFileSync(
      path.join(source, 'config.toml'),
      [
        '[profiles.local]',
        'model_catalog_json = "profile-catalog.json"',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(source, 'profile-catalog.json'), '{"models":[]}\n');
    fs.writeFileSync(
      path.join(source, 'review.config.toml'),
      [
        '[agents.reviewer]',
        'config_file = "agents/reviewer.config.toml"',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(source, 'agents', 'reviewer.config.toml'),
      'model_instructions_file = "reviewer.md"\n',
    );
    fs.writeFileSync(path.join(source, 'agents', 'reviewer.md'), '# Review instructions\n');

    const prepared = prepareCodePilotCodexHome({
      env: { CODEX_HOME: source, CLAUDE_GUI_DATA_DIR: data },
      homeDir: path.join(root, 'home'),
      platform: 'win32',
      mirrorOperations: FORCE_HARDLINK,
    });

    assert.equal(
      fs.readFileSync(path.join(prepared.codexHome, 'agents', 'reviewer.config.toml'), 'utf8'),
      'model_instructions_file = "reviewer.md"\n',
    );
    assert.equal(
      fs.readFileSync(path.join(prepared.codexHome, 'profile-catalog.json'), 'utf8'),
      '{"models":[]}\n',
    );
    assert.equal(
      fs.readFileSync(path.join(prepared.codexHome, 'agents', 'reviewer.md'), 'utf8'),
      '# Review instructions\n',
    );
  });

  it('does not copy absolute or parent-traversal config dependencies into the isolated home', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'source-codex');
    const data = path.join(root, 'codepilot-data');
    const absoluteCatalog = path.join(root, 'absolute-catalog.json');
    const parentInstructions = path.join(root, 'parent-instructions.md');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(absoluteCatalog, '{"models":[]}\n');
    fs.writeFileSync(parentInstructions, '# Parent\n');
    fs.writeFileSync(
      path.join(source, 'config.toml'),
      [
        `model_catalog_json = '${absoluteCatalog}'`,
        "model_instructions_file = '../parent-instructions.md'",
        '',
      ].join('\n'),
    );

    const prepared = prepareCodePilotCodexHome({
      env: { CODEX_HOME: source, CLAUDE_GUI_DATA_DIR: data },
      homeDir: path.join(root, 'home'),
      platform: 'win32',
      mirrorOperations: FORCE_HARDLINK,
    });

    assert.equal(fs.existsSync(path.join(prepared.codexHome, path.basename(absoluteCatalog))), false);
    assert.equal(fs.existsSync(path.join(data, 'parent-instructions.md')), false);
  });

  it('repairs a missing relative dependency after the isolated home was initialized', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'source-codex');
    const data = path.join(root, 'codepilot-data');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(
      path.join(source, 'config.toml'),
      'model_catalog_json = "late-catalog.json"\n',
    );
    const options = {
      env: { CODEX_HOME: source, CLAUDE_GUI_DATA_DIR: data },
      homeDir: path.join(root, 'home'),
      platform: 'win32',
      mirrorOperations: FORCE_HARDLINK,
    } as const;

    const first = prepareCodePilotCodexHome(options);
    assert.equal(first.initializedNow, true);
    assert.equal(fs.existsSync(path.join(first.codexHome, 'late-catalog.json')), false);

    fs.writeFileSync(path.join(source, 'late-catalog.json'), '{"models":[]}\n');
    const second = prepareCodePilotCodexHome(options);
    assert.equal(second.initializedNow, false);
    assert.equal(
      fs.readFileSync(path.join(second.codexHome, 'late-catalog.json'), 'utf8'),
      '{"models":[]}\n',
    );
  });

  it('does not restore CodePilot credentials after an explicit logout', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'source-codex');
    const data = path.join(root, 'codepilot-data');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'auth.json'), '{"auth_mode":"chatgpt"}\n');
    const options = {
      env: { CODEX_HOME: source, CLAUDE_GUI_DATA_DIR: data },
      homeDir: path.join(root, 'home'),
      platform: process.platform,
    } as const;

    const first = prepareCodePilotCodexHome(options);
    fs.unlinkSync(path.join(first.codexHome, 'auth.json'));
    const second = prepareCodePilotCodexHome(options);

    assert.equal(second.initializedNow, false);
    assert.equal(fs.existsSync(path.join(second.codexHome, 'auth.json')), false);
    assert.equal(fs.existsSync(path.join(source, 'auth.json')), true);
    assert.equal(second.credentialMirrors['auth.json'], 'absent');
  });

  it('fails closed when an override points both clients at the same home', () => {
    const root = temporaryRoot();
    assert.throws(
      () => prepareCodePilotCodexHome({
        env: { CODEX_HOME: root, CODEPILOT_CODEX_HOME: root },
        homeDir: root,
      }),
      /must be different/,
    );
  });

  it('reports and preserves the three credential sharing modes', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'auth.json');
    fs.writeFileSync(source, 'first\n');

    const symlinkTarget = path.join(root, 'symlink', 'auth.json');
    const preferredMode = mirrorCodexHomeEntry(source, symlinkTarget, process.platform);
    assert.ok(
      preferredMode === 'symlink' || preferredMode === 'hardlink',
      `expected live mirror mode, got ${preferredMode}`,
    );
    fs.writeFileSync(source, 'symlink-refresh\n');
    assert.equal(fs.readFileSync(symlinkTarget, 'utf8'), 'symlink-refresh\n');

    const hardlinkTarget = path.join(root, 'hardlink', 'auth.json');
    assert.equal(mirrorCodexHomeEntry(source, hardlinkTarget, 'win32', FORCE_HARDLINK), 'hardlink');
    fs.writeFileSync(source, 'hardlink-refresh\n');
    assert.equal(fs.readFileSync(hardlinkTarget, 'utf8'), 'hardlink-refresh\n');

    const copyTarget = path.join(root, 'copy', 'auth.json');
    assert.equal(mirrorCodexHomeEntry(source, copyTarget, 'win32', FORCE_COPY), 'copy');
    fs.writeFileSync(source, 'source-rotated\n');
    assert.equal(fs.readFileSync(copyTarget, 'utf8'), 'hardlink-refresh\n');

    fs.unlinkSync(symlinkTarget);
    fs.unlinkSync(hardlinkTarget);
    fs.unlinkSync(copyTarget);
    assert.equal(fs.readFileSync(source, 'utf8'), 'source-rotated\n');
  });

  it('surfaces snapshot Harness fallbacks instead of silently treating them as live', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'source-codex');
    const data = path.join(root, 'codepilot-data');
    fs.mkdirSync(path.join(source, 'skills', 'one'), { recursive: true });
    fs.writeFileSync(
      path.join(source, 'config.toml'),
      'model = "first"\nmodel_catalog_json = "catalog.json"\n',
    );
    fs.writeFileSync(path.join(source, 'catalog.json'), '{"models":[]}\n');
    fs.writeFileSync(path.join(source, 'skills', 'one', 'SKILL.md'), '# One\n');

    const prepared = prepareCodePilotCodexHome({
      env: { CODEX_HOME: source, CLAUDE_GUI_DATA_DIR: data },
      homeDir: root,
      platform: 'win32',
      mirrorOperations: FORCE_COPY,
    });
    assert.deepEqual(
      [...prepared.harnessSnapshotEntries].sort(),
      ['catalog.json', 'config.toml', 'skills'],
    );

    fs.writeFileSync(path.join(source, 'config.toml'), 'model = "second"\n');
    const next = prepareCodePilotCodexHome({
      env: { CODEX_HOME: source, CLAUDE_GUI_DATA_DIR: data },
      homeDir: root,
      platform: 'win32',
      mirrorOperations: FORCE_COPY,
    });
    assert.deepEqual(
      [...next.harnessSnapshotEntries].sort(),
      ['catalog.json', 'config.toml', 'skills'],
    );
    assert.equal(
      fs.readFileSync(path.join(next.codexHome, 'config.toml'), 'utf8'),
      'model = "first"\nmodel_catalog_json = "catalog.json"\n',
      'snapshot mode is explicit and never silently overwrites divergent CodePilot state',
    );
  });
});
