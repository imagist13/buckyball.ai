import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDisplayTokenUsage } from '../../lib/token-usage-display';

describe('token usage display validation', () => {
  it('accepts real required counters and supported optional values', () => {
    assert.deepEqual(parseDisplayTokenUsage(JSON.stringify({
      input_tokens: 12,
      output_tokens: 8,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 2,
      cost_usd: 0.0015,
    })), {
      input_tokens: 12,
      output_tokens: 8,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 2,
      cost_usd: 0.0015,
    });
  });

  it('hides the statistic when a required counter is missing or invalid', () => {
    assert.equal(parseDisplayTokenUsage('{"input_tokens":12}'), null);
    assert.equal(parseDisplayTokenUsage('{"input_tokens":12,"output_tokens":null}'), null);
    assert.equal(parseDisplayTokenUsage('{"input_tokens":12,"output_tokens":-1}'), null);
    assert.equal(parseDisplayTokenUsage('{"input_tokens":12,"output_tokens":1.5}'), null);
    assert.equal(parseDisplayTokenUsage('{not-json'), null);
  });

  it('omits invalid optional values without manufacturing replacements', () => {
    assert.deepEqual(parseDisplayTokenUsage({
      input_tokens: 0,
      output_tokens: 4,
      cache_read_input_tokens: '7',
      cache_creation_input_tokens: -2,
      cost_usd: Number.NaN,
    }), {
      input_tokens: 0,
      output_tokens: 4,
    });
  });
});
