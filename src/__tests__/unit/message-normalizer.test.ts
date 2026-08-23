import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessageContent, microCompactMessage } from '../../lib/message-normalizer';

describe('normalizeMessageContent', () => {
  it('strips file metadata from user messages', () => {
    const raw = '<!--files:[{"id":"1","name":"test.png","filePath":"/tmp/test.png"}]-->Hello';
    const result = normalizeMessageContent('user', raw);
    assert.equal(result, 'Hello');
    assert.ok(!result.includes('files:'));
  });

  it('extracts text + tool summaries from assistant JSON using XML markers', () => {
    const raw = JSON.stringify([
      { type: 'text', text: 'Here is the result:' },
      { type: 'tool_use', name: 'Read', input: { file_path: '/src/lib/db.ts' } },
    ]);
    const result = normalizeMessageContent('assistant', raw);
    assert.ok(result.includes('Here is the result:'));
    assert.ok(result.includes('<prior-tool-call name="Read"'));
    // Regression: prose-style "(used Read: ...)" caused few-shot mimicry
    // where the model would write pseudo tool calls as plain text after
    // compaction. Never reintroduce that format.
    assert.ok(!result.includes('(used Read'), 'must not use prose marker (used X: ...)');
    assert.ok(!/\(used \w+/.test(result), 'must not use any (used Tool:) prose marker');
  });

  it('returns tools-only marker when no text blocks', () => {
    const raw = JSON.stringify([
      { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
    ]);
    const result = normalizeMessageContent('assistant', raw);
    assert.ok(result.includes('<prior-tool-call name="Bash"'));
    assert.ok(!result.includes('(used '));
  });

  it('extracts reasoning summary from thinking-only messages', () => {
    const raw = JSON.stringify([
      { type: 'thinking', thinking: '**Analyzing the codebase**\nLooking at the structure...' },
    ]);
    const result = normalizeMessageContent('assistant', raw);
    assert.ok(result.includes('<prior-reasoning>'));
    assert.ok(result.includes('Analyzing the codebase'));
    assert.ok(!result.includes('(reasoning:'), 'must not use prose marker');
  });

  it('extracts heading-based summary from thinking blocks', () => {
    const raw = JSON.stringify([
      { type: 'thinking', thinking: '# Planning the approach\nFirst step is...' },
    ]);
    const result = normalizeMessageContent('assistant', raw);
    assert.ok(result.includes('Planning the approach'));
  });

  it('handles thinking + text + tool_use combined messages', () => {
    const raw = JSON.stringify([
      { type: 'thinking', thinking: '**Deciding which files to read**' },
      { type: 'text', text: 'Let me check the code.' },
      { type: 'tool_use', name: 'Read', input: { file_path: '/src/index.ts' } },
    ]);
    const result = normalizeMessageContent('assistant', raw);
    assert.ok(result.includes('<prior-reasoning>'));
    assert.ok(result.includes('Let me check the code.'));
    assert.ok(result.includes('<prior-tool-call name="Read"'));
    assert.ok(!/\(used \w+/.test(result));
  });

  it('truncates long thinking content in summary', () => {
    const raw = JSON.stringify([
      { type: 'thinking', thinking: 'A'.repeat(200) },
    ]);
    const result = normalizeMessageContent('assistant', raw);
    assert.ok(result.length < 200);
    assert.ok(result.includes('<prior-reasoning>'));
  });

  it('escapes XML-unsafe chars in tool input so markers stay well-formed', () => {
    const raw = JSON.stringify([
      { type: 'tool_use', name: 'Edit', input: { old_string: 'a < b & "c"', new_string: '<tag>' } },
    ]);
    const result = normalizeMessageContent('assistant', raw);
    assert.ok(result.includes('<prior-tool-call name="Edit"'));
    // Raw unescaped quote/angle inside the input would break the attribute
    assert.ok(!result.includes('"<tag>"'));
    assert.ok(result.includes('&quot;') || result.includes('&lt;'));
  });
});

describe('microCompactMessage', () => {
  it('does not truncate short content', () => {
    const content = 'Hello world';
    assert.equal(microCompactMessage('user', content, 0), content);
  });

  it('truncates long content for recent messages at 5000 chars', () => {
    const content = 'x'.repeat(10000);
    const result = microCompactMessage('user', content, 5);
    assert.ok(result.length <= 5000 + 50); // allow margin for marker
    assert.ok(result.includes('[...truncated...]'));
  });

  it('truncates more aggressively for old messages (>30 turns)', () => {
    const content = 'x'.repeat(5000);
    const result = microCompactMessage('user', content, 35);
    assert.ok(result.length <= 1000 + 50);
    assert.ok(result.includes('[...truncated...]'));
  });

  it('preserves head and tail of truncated content', () => {
    const content = 'HEAD_MARKER' + 'x'.repeat(10000) + 'TAIL_MARKER';
    const result = microCompactMessage('user', content, 5);
    assert.ok(result.startsWith('HEAD_MARKER'));
    assert.ok(result.endsWith('TAIL_MARKER'));
  });

  it('does not truncate old messages that are already short', () => {
    const content = 'Short message';
    assert.equal(microCompactMessage('user', content, 50), content);
  });
});
