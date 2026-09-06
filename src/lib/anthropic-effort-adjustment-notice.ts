import type { ClaudeModelOptionsOutput } from './claude-model-options';

export interface EffortAdjustmentNotice {
  code: 'RUNTIME_EFFORT_ADJUSTED';
  reason: 'thinking-disabled-cap';
  params: {
    model: string;
    requested: 'xhigh' | 'max';
    effective: 'high';
  };
}

/**
 * Build the shared user-visible fact for an effort adjustment made by the
 * Claude request sanitizer. Both Native and Claude Code Runtime consume this
 * object so the valid wire shape cannot drift from the notice semantics.
 */
export function buildEffortAdjustmentNotice(args: {
  model: string | undefined;
  sanitized: Pick<ClaudeModelOptionsOutput, 'effortAdjustedForThinking'>;
}): EffortAdjustmentNotice | null {
  const adjustment = args.sanitized.effortAdjustedForThinking;
  if (!adjustment) return null;

  return {
    code: 'RUNTIME_EFFORT_ADJUSTED',
    reason: 'thinking-disabled-cap',
    params: {
      model: args.model || 'unknown',
      requested: adjustment.requested,
      effective: adjustment.effective,
    },
  };
}
