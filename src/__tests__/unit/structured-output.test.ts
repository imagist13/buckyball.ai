/**
 * Unit tests for structured output extraction logic.
 *
 * The structured route now uses Vercel AI SDK's generateText({ output: Output.object() })
 * which returns result.output directly. These tests verify the extraction/fallback logic
 * that handles both the native structured output path and the text fallback path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Simulate the extraction logic from the new structured route.
 * The route tries result.output first (AI SDK native structured output),
 * then falls back to parsing result.text as JSON.
 */
function extractStructuredOutput(result: {
  output?: unknown;
  text?: string;
}): { result: unknown; source: string } {
  // Primary path: AI SDK's structured output
  if (result.output !== undefined && result.output !== null) {
    return { result: result.output, source: 'structured_output' };
  }

  // Fallback: parse text as JSON
  if (result.text) {
    try {
      return { result: JSON.parse(result.text), source: 'text_parsed' };
    } catch {
      return { result: result.text, source: 'text_raw' };
    }
  }

  return { result: null, source: 'empty' };
}

describe('structured output extraction (AI SDK native)', () => {
  it('prefers result.output from AI SDK generateText', () => {
    const result = {
      output: { name: 'from structured', score: 95 },
      text: '{"name":"from text"}',
    };

    const out = extractStructuredOutput(result);
    assert.equal(out.source, 'structured_output');
    assert.deepEqual(out.result, { name: 'from structured', score: 95 });
  });

  it('falls back to text parsing when output is absent', () => {
    const result = {
      output: undefined,
      text: '{"fallback":true,"count":3}',
    };

    const out = extractStructuredOutput(result);
    assert.equal(out.source, 'text_parsed');
    assert.deepEqual(out.result, { fallback: true, count: 3 });
  });

  it('returns raw text when JSON parse fails', () => {
    const result = {
      output: undefined,
      text: 'The answer is not valid JSON',
    };

    const out = extractStructuredOutput(result);
    assert.equal(out.source, 'text_raw');
    assert.equal(out.result, 'The answer is not valid JSON');
  });

  it('returns null when both output and text are absent', () => {
    const result = {};

    const out = extractStructuredOutput(result);
    assert.equal(out.source, 'empty');
    assert.equal(out.result, null);
  });

  it('handles structured output that is a primitive', () => {
    const result = { output: 42 };

    const out = extractStructuredOutput(result);
    assert.equal(out.source, 'structured_output');
    assert.equal(out.result, 42);
  });

  it('handles structured output that is an array', () => {
    const result = { output: [{ id: 1 }, { id: 2 }] };

    const out = extractStructuredOutput(result);
    assert.equal(out.source, 'structured_output');
    assert.deepEqual(out.result, [{ id: 1 }, { id: 2 }]);
  });

  it('treats null output as absent and falls back to text', () => {
    const result = { output: null, text: '{"from":"text"}' };

    const out = extractStructuredOutput(result);
    assert.equal(out.source, 'text_parsed');
    assert.deepEqual(out.result, { from: 'text' });
  });
});
