/** Join CodePilot-owned context with Codex-only routing guidance once. */
export function composeCodexDeveloperInstructions(
  systemPrompt?: string,
  runtimeGuidance?: string,
): string | undefined {
  const parts = [systemPrompt, runtimeGuidance]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}
