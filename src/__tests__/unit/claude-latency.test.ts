import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { attachClaudeRuntimeLatency } from '../../lib/claude-latency';

describe('Claude Code latency telemetry', () => {
  it('persists measured SDK and wall-clock facts with their source', () => {
    const usage = attachClaudeRuntimeLatency(
      { input_tokens: 12, output_tokens: 34 },
      {
        ttftMs: 1420.4,
        durationMs: 6100,
        durationApiMs: 5400,
        wallMs: 6340,
        apiRetryCount: 2,
        terminalType: 'success',
        resumeAttempted: true,
        resumeFallback: false,
      },
    );

    assert.deepEqual(usage?.runtime_latency, {
      source: 'claude-agent-sdk',
      ttft_ms: 1420,
      duration_ms: 6100,
      duration_api_ms: 5400,
      wall_ms: 6340,
      api_retry_count: 2,
      terminal_type: 'success',
      resume_attempted: true,
      resume_fallback: false,
    });
  });

  it('keeps unreported fields absent instead of fabricating zeros', () => {
    const usage = attachClaudeRuntimeLatency(
      { input_tokens: 1, output_tokens: 1 },
      {
        wallMs: 20,
        apiRetryCount: 0,
        terminalType: 'error_during_execution',
        resumeAttempted: false,
        resumeFallback: false,
      },
    );

    assert.equal('ttft_ms' in usage!.runtime_latency!, false);
    assert.equal('duration_ms' in usage!.runtime_latency!, false);
    assert.equal(usage!.runtime_latency!.api_retry_count, 0);
  });

  it('does not create telemetry when there is no real usage row to persist', () => {
    assert.equal(attachClaudeRuntimeLatency(null, {
      wallMs: 1,
      apiRetryCount: 0,
      terminalType: 'success',
      resumeAttempted: false,
      resumeFallback: false,
    }), null);
  });
});
