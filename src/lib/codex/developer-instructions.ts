/**
 * Codex app-server accepts the conversation's developer instructions, not a
 * caller-supplied user-role prelude. The bb.ai identity therefore remains in
 * `systemPrompt`; the first-turn context is emitted only to the UI.
 */
export function composeCodexDeveloperInstructions(
  systemPrompt?: string,
  runtimeGuidance?: string,
): string | undefined {
  const parts = [systemPrompt, runtimeGuidance]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}
