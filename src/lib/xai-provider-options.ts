/** xAI Responses provider-option mapping shared by Native and Codex proxy. */
export function mapXaiReasoningEffort(
  _model: string,
  effort: string | undefined,
): 'low' | 'medium' | 'high' | undefined {
  switch (effort) {
    case 'minimal':
      // Grok 4.5+ cannot disable reasoning. Omit the field to use the model's
      // documented default (high) rather than send the invalid `none` tier.
      return undefined;
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
    case 'max':
      // Grok 4.6 itself documents XHigh, but the currently locked
      // @ai-sdk/xai schema only accepts none/low/medium/high. Returning
      // xhigh here throws InvalidArgumentError before fetch. Keep stale
      // sessions safe by folding the unsupported local selector values to
      // the highest tier the installed SDK can actually serialize.
      return 'high';
    default:
      return undefined;
  }
}

export function buildXaiProviderOptions(model: string, effort?: string): {
  store: false;
  reasoningEffort?: 'low' | 'medium' | 'high';
} {
  const reasoningEffort = mapXaiReasoningEffort(model, effort);
  return {
    // @ai-sdk/xai defaults Responses `store` to true. CodePilot sends the
    // complete conversation and does not use previousResponseId, so retaining
    // an upstream response adds no continuity benefit. This is an xAI-specific
    // data-minimisation decision, not inherited from the Codex/OpenAI endpoint.
    store: false,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}
