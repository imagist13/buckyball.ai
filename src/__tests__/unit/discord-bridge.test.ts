/**
 * Unit tests for Discord bridge adapter.
 *
 * Run with: npx tsx src/__tests__/unit/discord-bridge.test.ts
 *
 * Tests cover:
 * - Markdown chunking (short text, line split, code fence balance, hard split)
 * - Authorization logic (deny when empty, allow by user/channel)
 * - Command normalization (! → /)
 * - HTML to Discord markdown conversion
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToDiscordChunks } from '../../lib/bridge/markdown/discord';

// ── Discord chunking ─────────────────────────────────────────

describe('markdownToDiscordChunks', () => {
  it('returns empty array for empty input', () => {
    assert.deepStrictEqual(markdownToDiscordChunks(''), []);
  });

  it('returns single chunk for short text', () => {
    const result = markdownToDiscordChunks('Hello world');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].text, 'Hello world');
  });

  it('returns single chunk when exactly at limit', () => {
    const text = 'x'.repeat(2000);
    const result = markdownToDiscordChunks(text, 2000);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].text, text);
  });

  it('splits long text at line boundaries', () => {
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) {
      lines.push(`Line ${i}: ${'x'.repeat(80)}`);
    }
    const text = lines.join('\n');
    const result = markdownToDiscordChunks(text, 2000);

    assert.ok(result.length > 1, 'Should split into multiple chunks');
    for (const chunk of result) {
      assert.ok(chunk.text.length <= 2000, `Chunk exceeds limit: ${chunk.text.length}`);
    }
  });

  it('balances code fences at split points', () => {
    const codePart = '```typescript\n' + 'const x = 1;\n'.repeat(200) + '```';
    const result = markdownToDiscordChunks(codePart, 2000);

    assert.ok(result.length > 1, 'Should split into multiple chunks');

    // First chunk should end with closing ```
    assert.ok(result[0].text.includes('```typescript'), 'First chunk should contain opening fence');
    assert.ok(result[0].text.endsWith('```'), 'First chunk should end with closing fence');

    // Second chunk should start with reopened fence
    assert.ok(result[1].text.startsWith('```typescript'), 'Second chunk should start with reopened fence');
  });

  it('hard splits when a single line exceeds limit', () => {
    const text = 'x'.repeat(5000);
    const result = markdownToDiscordChunks(text, 2000);

    assert.ok(result.length > 1, 'Should split into multiple chunks');
    assert.strictEqual(result[0].text.length, 2000);
  });

  it('preserves language tag when reopening fences', () => {
    const text = '```python\n' + 'print("hello")\n'.repeat(200) + '```';
    const result = markdownToDiscordChunks(text, 2000);

    assert.ok(result.length > 1, 'Should split into multiple chunks');
    assert.ok(result[1].text.startsWith('```python'), 'Second chunk should have ```python');
  });
});

// ── Authorization logic ──────────────────────────────────────

describe('Discord authorization logic', () => {
  function isAuthorized(
    userId: string,
    chatId: string,
    allowedUsers: string,
    allowedChannels: string,
  ): boolean {
    if (!allowedUsers && !allowedChannels) return false;

    const users = allowedUsers.split(',').map(s => s.trim()).filter(Boolean);
    const channels = allowedChannels.split(',').map(s => s.trim()).filter(Boolean);

    if (users.length > 0 && users.includes(userId)) return true;
    if (channels.length > 0 && channels.includes(chatId)) return true;
    if (users.length > 0 && channels.length === 0) return false;
    if (channels.length > 0 && users.length === 0) return false;

    return false;
  }

  it('denies when both lists are empty', () => {
    assert.strictEqual(isAuthorized('user1', 'chan1', '', ''), false);
  });

  it('allows by user ID', () => {
    assert.strictEqual(isAuthorized('user1', 'chan1', 'user1,user2', ''), true);
  });

  it('denies unlisted user', () => {
    assert.strictEqual(isAuthorized('user3', 'chan1', 'user1,user2', ''), false);
  });

  it('allows by channel ID', () => {
    assert.strictEqual(isAuthorized('user1', 'chan1', '', 'chan1,chan2'), true);
  });

  it('denies unlisted channel', () => {
    assert.strictEqual(isAuthorized('user1', 'chan3', '', 'chan1,chan2'), false);
  });

  it('allows when user matches in combined lists', () => {
    assert.strictEqual(isAuthorized('user1', 'chan3', 'user1', 'chan1'), true);
  });

  it('allows when channel matches in combined lists', () => {
    assert.strictEqual(isAuthorized('user3', 'chan1', 'user1', 'chan1'), true);
  });

  it('denies when neither matches in combined lists', () => {
    assert.strictEqual(isAuthorized('user3', 'chan3', 'user1', 'chan1'), false);
  });
});

// ── Command normalization ────────────────────────────────────

describe('Discord command normalization', () => {
  it('normalizes ! prefix to /', () => {
    let text = '!new /path/to/project';
    if (text.startsWith('!')) text = '/' + text.slice(1);
    assert.strictEqual(text, '/new /path/to/project');
  });

  it('leaves / commands unchanged', () => {
    let text = '/status';
    if (text.startsWith('!')) text = '/' + text.slice(1);
    assert.strictEqual(text, '/status');
  });

  it('does not touch regular text', () => {
    let text = 'hello world';
    if (text.startsWith('!')) text = '/' + text.slice(1);
    assert.strictEqual(text, 'hello world');
  });
});

// ── HTML to Discord markdown conversion ──────────────────────

describe('HTML to Discord markdown', () => {
  function htmlToDiscordMarkdown(html: string): string {
    return html
      .replace(/<b>(.*?)<\/b>/gi, '**$1**')
      .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<i>(.*?)<\/i>/gi, '*$1*')
      .replace(/<em>(.*?)<\/em>/gi, '*$1*')
      .replace(/<code>(.*?)<\/code>/gi, '`$1`')
      .replace(/<pre>([\s\S]*?)<\/pre>/gi, '```\n$1\n```')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');
  }

  it('converts bold tags', () => {
    assert.strictEqual(htmlToDiscordMarkdown('<b>bold</b>'), '**bold**');
  });

  it('converts italic tags', () => {
    assert.strictEqual(htmlToDiscordMarkdown('<i>italic</i>'), '*italic*');
  });

  it('converts code tags', () => {
    assert.strictEqual(htmlToDiscordMarkdown('<code>code</code>'), '`code`');
  });

  it('converts pre tags', () => {
    assert.strictEqual(htmlToDiscordMarkdown('<pre>block</pre>'), '```\nblock\n```');
  });

  it('decodes HTML entities', () => {
    assert.strictEqual(htmlToDiscordMarkdown('A &amp; B'), 'A & B');
  });

  it('strips unknown HTML tags', () => {
    assert.strictEqual(htmlToDiscordMarkdown('<div>text</div>'), 'text');
  });
});
