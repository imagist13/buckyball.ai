import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  roughTokenEstimate,
  estimateMessageTokens,
  estimateContextTokens,
  calculateContextPercentage,
} from '../../lib/context-estimator';

describe('roughTokenEstimate', () => {
  it('returns 0 for empty string', () => {
    assert.equal(roughTokenEstimate(''), 0);
  });

  it('estimates ASCII text at ~4 bytes/token', () => {
    const text = 'Hello world'; // 11 bytes
    const estimate = roughTokenEstimate(text);
    assert.equal(estimate, Math.ceil(11 / 4)); // 3
  });

  it('estimates JSON content at ~2 bytes/token when flagged', () => {
    const json = '{"key":"value"}'; // 15 bytes
    const estimate = roughTokenEstimate(json, true);
    assert.equal(estimate, Math.ceil(15 / 2)); // 8
  });

  it('handles CJK characters (multi-byte UTF-8)', () => {
    const text = '你好世界'; // 12 bytes in UTF-8
    const estimate = roughTokenEstimate(text);
    assert.equal(estimate, Math.ceil(12 / 4)); // 3
  });
});

describe('estimateMessageTokens', () => {
  it('auto-detects JSON arrays', () => {
    const content = '[{"type":"text","text":"hello"}]';
    const estimate = estimateMessageTokens(content);
    const expected = roughTokenEstimate(content, true);
    assert.equal(estimate, expected);
  });

  it('treats non-JSON as regular text', () => {
    const content = 'Just a regular message';
    const estimate = estimateMessageTokens(content);
    const expected = roughTokenEstimate(content, false);
    assert.equal(estimate, expected);
  });
});

describe('estimateContextTokens', () => {
  it('sums all components', () => {
    const result = estimateContextTokens({
      systemPrompt: 'You are helpful.',
      history: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
      currentUserMessage: 'How are you?',
    });

    assert.ok(result.total > 0);
    assert.ok(result.breakdown.system > 0);
    assert.ok(result.breakdown.history > 0);
    assert.ok(result.breakdown.userMessage > 0);
    assert.equal(result.breakdown.summary, 0);
    assert.equal(
      result.total,
      result.breakdown.system + result.breakdown.history + result.breakdown.userMessage + result.breakdown.summary,
    );
  });

  it('includes session summary when provided', () => {
    const result = estimateContextTokens({
      systemPrompt: 'sys',
      history: [],
      currentUserMessage: 'hi',
      sessionSummary: 'Previous conversation discussed X, Y, Z in detail.',
    });

    assert.ok(result.breakdown.summary > 0);
  });
});

describe('calculateContextPercentage', () => {
  it('returns normal state at low usage', () => {
    const result = calculateContextPercentage(50000, 200000);
    assert.equal(result.state, 'normal');
    assert.ok(result.percentage < 0.8);
    assert.equal(result.tokensRemaining, 150000);
  });

  it('returns warning state at 80-95%', () => {
    const result = calculateContextPercentage(170000, 200000);
    assert.equal(result.state, 'warning');
  });

  it('returns critical state at 95%+', () => {
    const result = calculateContextPercentage(195000, 200000);
    assert.equal(result.state, 'critical');
  });

  it('handles zero context window', () => {
    const result = calculateContextPercentage(1000, 0);
    assert.equal(result.state, 'normal');
    assert.equal(result.percentage, 0);
  });
});
