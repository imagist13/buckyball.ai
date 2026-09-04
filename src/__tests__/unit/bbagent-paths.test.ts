/**
 * Unit tests for bbagent/paths.ts and bbagent/data-migration.ts
 *
 * Phase 6 — verify default path resolution, env precedence,
 * migration idempotency, and dry-run behavior.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import {
  resolveBuckyballDataDir,
  resolveLegacyCodePilotDataDir,
  resolveBuckyballMediaDir,
  resolveBuckyballLogsDir,
  resolveBuckyballAssistantDir,
} from '@/lib/bbagent/paths';

import {
  shouldMigrateDataDir,
  migrateDataDir,
} from '@/lib/bbagent/data-migration';

const HOME = path.join(os.tmpdir(), 'bbagent-test-home-' + Date.now());

test.afterEach(() => {
  // 每个测试后清理（不删 HOME 本身，单独测试自己清理）
});

test('resolveBuckyballDataDir: 默认 ~/.codepilot（向后兼容 Phase 6A）', () => {
  const dir = resolveBuckyballDataDir({}, HOME);
  assert.equal(dir, path.join(HOME, '.codepilot'));
});

test('resolveBuckyballDataDir: BUCKYBALL_DATA_DIR 优先于 CLAUDE_GUI_DATA_DIR', () => {
  const dir = resolveBuckyballDataDir(
    { BUCKYBALL_DATA_DIR: '/new/path', CLAUDE_GUI_DATA_DIR: '/old/path' },
    HOME,
  );
  assert.equal(dir, path.resolve('/new/path'));
});

test('resolveBuckyballDataDir: CLAUDE_GUI_DATA_DIR 是兜底', () => {
  const dir = resolveBuckyballDataDir(
    { CLAUDE_GUI_DATA_DIR: '/legacy/path' },
    HOME,
  );
  assert.equal(dir, path.resolve('/legacy/path'));
});

test('resolveBuckyballDataDir: trim 空白 env', () => {
  const dir = resolveBuckyballDataDir(
    { BUCKYBALL_DATA_DIR: '   ' },
    HOME,
  );
  // 空白 env 被当作未设置
  assert.equal(dir, path.join(HOME, '.codepilot'));
});

test('resolveLegacyCodePilotDataDir: 旧版始终走 ~/.codepilot', () => {
  const dir = resolveLegacyCodePilotDataDir({}, HOME);
  assert.equal(dir, path.join(HOME, '.codepilot'));

  // 即使 BUCKYBALL_DATA_DIR 设置了，旧版函数仍然走 CLAUDE_GUI_DATA_DIR / 默认
  const dir2 = resolveLegacyCodePilotDataDir(
    { BUCKYBALL_DATA_DIR: '/new/path' },
    HOME,
  );
  assert.equal(dir2, path.join(HOME, '.codepilot'));
});

test('resolveBuckyballMediaDir / LogsDir / AssistantDir: 拼接子目录', () => {
  const media = resolveBuckyballMediaDir({}, HOME);
  const logs = resolveBuckyballLogsDir({}, HOME);
  const assistant = resolveBuckyballAssistantDir({}, HOME);
  // 注意：媒体目录用 .buckyball-media（product 名后缀），不是 .codepilot-media
  // 即使父目录是 ~/.codepilot，子目录名也保持 product 命名一致性
  assert.equal(media, path.join(HOME, '.codepilot', '.buckyball-media'));
  assert.equal(logs, path.join(HOME, '.codepilot', '.buckyball-logs'));
  assert.equal(assistant, path.join(HOME, '.codepilot', '.assistant'));
});

// ── data-migration ─────────────────────────────────────────────

test('shouldMigrateDataDir: source 不存在 → false', () => {
  const home = path.join(os.tmpdir(), 'bbagent-mig-no-src-' + Date.now());
  fs.mkdirSync(home, { recursive: true });
  try {
    const result = shouldMigrateDataDir({ BUCKYBALL_DATA_DIR: '/new/path' }, home);
    assert.equal(result, false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('shouldMigrateDataDir: source == target → false', () => {
  const home = path.join(os.tmpdir(), 'bbagent-mig-same-' + Date.now());
  fs.mkdirSync(home, { recursive: true });
  try {
    const result = shouldMigrateDataDir({ BUCKYBALL_DATA_DIR: home }, home);
    assert.equal(result, false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('shouldMigrateDataDir: source 存在 + target 不同 + 未迁移 → true', () => {
  const home = path.join(os.tmpdir(), 'bbagent-mig-yes-' + Date.now());
  const source = path.join(home, '.codepilot');
  const target = path.join(home, '.buckyball');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'db.sqlite'), 'fake');
  try {
    const result = shouldMigrateDataDir({ BUCKYBALL_DATA_DIR: target }, home);
    assert.equal(result, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('shouldMigrateDataDir: 已迁移（有 marker） → false', () => {
  const home = path.join(os.tmpdir(), 'bbagent-mig-marker-' + Date.now());
  const source = path.join(home, '.codepilot');
  const target = path.join(home, '.buckyball');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, '.bb-migrated-from-codepilot'), '{}');
  try {
    const result = shouldMigrateDataDir({ BUCKYBALL_DATA_DIR: target }, home);
    assert.equal(result, false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('migrateDataDir: dry-run 不写盘，只列文件数', async () => {
  const home = path.join(os.tmpdir(), 'bbagent-mig-dry-' + Date.now());
  const source = path.join(home, '.codepilot');
  const target = path.join(home, '.buckyball');
  fs.mkdirSync(path.join(source, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(source, 'a.txt'), 'a');
  fs.writeFileSync(path.join(source, 'sub', 'b.txt'), 'b');
  try {
    const result = await migrateDataDir(
      { BUCKYBALL_DATA_DIR: target },
      home,
      { dryRun: true },
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.filesCopied, 3); // a.txt + sub + sub/b.txt
    assert.equal(fs.existsSync(target), false); // dry-run 不写
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('migrateDataDir: 实际迁移拷贝文件 + 写 marker', async () => {
  const home = path.join(os.tmpdir(), 'bbagent-mig-real-' + Date.now());
  const source = path.join(home, '.codepilot');
  const target = path.join(home, '.buckyball');
  fs.mkdirSync(path.join(source, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(source, 'db.sqlite'), 'fake-db');
  fs.writeFileSync(path.join(source, 'sub', 'config.json'), '{}');
  try {
    const result = await migrateDataDir(
      { BUCKYBALL_DATA_DIR: target },
      home,
    );
    assert.equal(result.status, 'migrated');
    assert.equal(result.filesCopied, 2); // db.sqlite + sub/config.json
    assert.equal(result.errors.length, 0);
    // 验证文件确实拷过去了
    assert.equal(fs.existsSync(path.join(target, 'db.sqlite')), true);
    assert.equal(fs.readFileSync(path.join(target, 'db.sqlite'), 'utf-8'), 'fake-db');
    assert.equal(fs.existsSync(path.join(target, 'sub', 'config.json')), true);
    // marker 写了
    assert.equal(fs.existsSync(path.join(target, '.bb-migrated-from-codepilot')), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('migrateDataDir: 第二次调用（已迁移）→ skipped', async () => {
  const home = path.join(os.tmpdir(), 'bbagent-mig-twice-' + Date.now());
  const source = path.join(home, '.codepilot');
  const target = path.join(home, '.buckyball');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'a.txt'), 'a');
  try {
    await migrateDataDir({ BUCKYBALL_DATA_DIR: target }, home);
    const result2 = await migrateDataDir({ BUCKYBALL_DATA_DIR: target }, home);
    assert.equal(result2.status, 'skipped');
    assert.equal(result2.filesCopied, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('migrateDataDir: 跳过隐藏文件（包括自己的 marker）', async () => {
  const home = path.join(os.tmpdir(), 'bbagent-mig-hidden-' + Date.now());
  const source = path.join(home, '.codepilot');
  const target = path.join(home, '.buckyball');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'normal.txt'), 'normal');
  fs.writeFileSync(path.join(source, '.hidden'), 'hidden');
  fs.mkdirSync(path.join(source, '.hiddir'), { recursive: true });
  fs.writeFileSync(path.join(source, '.hiddir', 'x.txt'), 'x');
  try {
    const result = await migrateDataDir({ BUCKYBALL_DATA_DIR: target }, home);
    assert.equal(result.status, 'migrated');
    assert.equal(result.filesCopied, 1); // 只有 normal.txt
    assert.equal(fs.existsSync(path.join(target, 'normal.txt')), true);
    assert.equal(fs.existsSync(path.join(target, '.hidden')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
