import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGlobTool } from '@/lib/tools/glob';
import { createGrepTool } from '@/lib/tools/grep';
import { createBashTool, buildShellLaunch } from '@/lib/tools/bash';
import { globWithNode, grepWithNode } from '@/lib/tools/search-fallback';

type ExecutableTool = {
  execute?: (input: unknown, options: unknown) => Promise<unknown> | unknown;
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-search-tools-'));

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function executeTool(tool: ExecutableTool, input: unknown): Promise<unknown> {
  assert.equal(typeof tool.execute, 'function');
  return Promise.resolve(tool.execute!(input, {
    toolCallId: 'security-test',
    messages: [],
  }));
}

function injectionPayload(marker: string): string {
  return process.platform === 'win32'
    ? `x & type nul > "${marker}" & rem`
    : `; touch "${marker}" #`;
}

describe('Native Grep/Glob command boundary', () => {
  it('Grep treats shell metacharacters as one rg/grep argument', async () => {
    const marker = path.join(root, 'grep-injected');
    const tool = createGrepTool({ workingDirectory: root }) as ExecutableTool;
    await executeTool(tool, {
      pattern: injectionPayload(marker),
      max_results: 5,
    });
    assert.equal(fs.existsSync(marker), false);
  });

  it('Glob treats shell metacharacters as one glob argument', async () => {
    const marker = path.join(root, 'glob-injected');
    const tool = createGlobTool({ workingDirectory: root }) as ExecutableTool;
    await executeTool(tool, { pattern: injectionPayload(marker) });
    assert.equal(fs.existsSync(marker), false);
  });

  it('keeps ordinary Grep and recursive Glob behavior', async () => {
    const sourceDir = path.join(root, 'src');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'sample.ts'), 'const needle = true;\n');
    fs.writeFileSync(path.join(sourceDir, 'sample.js'), 'const other = true;\n');

    const grep = createGrepTool({ workingDirectory: root }) as ExecutableTool;
    const grepResult = String(await executeTool(grep, { pattern: 'needle' }));
    assert.match(grepResult, /src\/sample\.ts:1:const needle = true/);

    const glob = createGlobTool({ workingDirectory: root }) as ExecutableTool;
    const globResult = String(await executeTool(glob, { pattern: '**/*.ts' }));
    assert.match(globResult, /src\/sample\.ts/);
    assert.doesNotMatch(globResult, /sample\.js/);

    const emptyGlobResult = String(await executeTool(glob, { pattern: '**/*.rs' }));
    assert.match(emptyGlobResult, /No files found matching pattern/);
  });

  it('keeps Glob/Grep functional without Unix find or grep', async () => {
    const projectDir = path.join(root, '中文 游戏 (测试)&资料');
    const sourceDir = path.join(projectDir, '源码');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, '角色.ts'), 'export const 英雄 = "needle-中文";\n');
    fs.writeFileSync(path.join(sourceDir, '忽略.js'), 'const needle = false;\n');

    assert.deepEqual(globWithNode(projectDir, '**/*.ts'), ['源码/角色.ts']);
    assert.deepEqual(await grepWithNode({
      pattern: 'needle-中文',
      root: projectDir,
      glob: '**/*.ts',
    }), ['源码/角色.ts:1:export const 英雄 = "needle-中文";']);
  });

  it('matches ripgrep defaults by excluding hidden files during fallback traversal', async () => {
    const projectDir = path.join(root, 'hidden-files');
    fs.mkdirSync(path.join(projectDir, '.hidden'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.env'), 'API_KEY=hidden-secret\n');
    fs.writeFileSync(path.join(projectDir, '.hidden', 'secret.ts'), 'hidden-secret\n');
    fs.writeFileSync(path.join(projectDir, 'visible.ts'), 'public-marker\n');

    assert.deepEqual(globWithNode(projectDir, '**/*'), ['visible.ts']);
    assert.deepEqual(await grepWithNode({
      pattern: 'hidden-secret',
      root: projectDir,
    }), []);
    assert.deepEqual(await grepWithNode({
      pattern: 'hidden-secret',
      root: projectDir,
      target: path.join(projectDir, '.env'),
    }), ['.env:1:API_KEY=hidden-secret']);
  });

  it('times out catastrophic fallback regexes without blocking the host event loop', async () => {
    const projectDir = path.join(root, 'catastrophic-regex');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'input.txt'), `${'a'.repeat(30_000)}!\n`);

    let heartbeatRan = false;
    const heartbeat = setTimeout(() => {
      heartbeatRan = true;
    }, 20);
    const startedAt = Date.now();
    await assert.rejects(
      grepWithNode({
        pattern: '(a+)+$',
        root: projectDir,
        timeoutMs: 150,
      }),
      /node_grep_timeout/,
    );
    clearTimeout(heartbeat);
    assert.equal(heartbeatRan, true, 'regex evaluation must not monopolize the main thread');
    assert.ok(Date.now() - startedAt < 2_000, 'worker timeout must bound the search');
  });

  it('aborts an in-flight fallback regex search', async () => {
    const projectDir = path.join(root, 'aborted-regex');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'input.txt'), `${'a'.repeat(30_000)}!\n`);
    const controller = new AbortController();
    const search = grepWithNode({
      pattern: '(a+)+$',
      root: projectDir,
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(search, (error: unknown) => {
      assert.equal((error as Error).name, 'AbortError');
      assert.match((error as Error).message, /node_grep_aborted/);
      return true;
    });
  });
});

describe('Native shell platform boundary', () => {
  it('encodes Windows PowerShell commands without cmd interpolation', () => {
    const launch = buildShellLaunch('Get-Content -LiteralPath ".\\中文 文件.txt"', {
      platform: 'win32',
      env: { ...process.env, SystemRoot: 'Z:\\Windows' },
    });
    assert.equal(
      launch.command,
      'Z:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
    assert.deepEqual(launch.args.slice(0, 6), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
    ]);
    const encoded = launch.args.at(-1)!;
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    assert.match(decoded, /OutputEncoding/);
    assert.match(decoded, /中文 文件\.txt/);
  });

  it('executes PowerShell in a Unicode working directory on Windows', {
    skip: process.platform !== 'win32',
  }, async () => {
    const projectDir = path.join(root, 'Shell 中文 游戏 (测试)&资料');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, '内容.txt'), 'WINDOWS_UNICODE_OK\n');

    const bash = createBashTool({ workingDirectory: projectDir }) as ExecutableTool;
    const result = String(await executeTool(bash, {
      command: "Get-Content -LiteralPath '.\\内容.txt'",
    }));
    assert.match(result, /WINDOWS_UNICODE_OK/);
  });
});
