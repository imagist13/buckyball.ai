import type { ModelMessage, ToolModelMessage } from 'ai';

type UnknownPart = { type?: unknown; [key: string]: unknown };

export const MISSING_TOOL_RESULT_CONTENT =
  '[CodePilot: no tool result was received before this turn ended.]';

export interface ToolHistoryRepairResult {
  messages: ModelMessage[];
  synthesizedResults: number;
  droppedOrphanResults: number;
}

function partsOf(message: ModelMessage): UnknownPart[] | null {
  return Array.isArray(message.content)
    ? message.content as UnknownPart[]
    : null;
}

/**
 * Make a persisted/replayed AI SDK transcript structurally honest.
 *
 * A Stop, renderer loss, or partial SSE delivery can leave an assistant
 * tool-call without its result. AI SDK rejects that history before the next
 * provider request. We close only those incomplete segments with an explicit
 * app-owned error result; we never claim the tool succeeded or did not run.
 * Results with no preceding call cannot be represented safely in a model
 * prompt, so they stay in the UI/DB transcript but are omitted from replay.
 */
export function repairIncompleteToolHistory(
  messages: readonly ModelMessage[],
): ToolHistoryRepairResult {
  const repaired: ModelMessage[] = [];
  const pending = new Map<string, string>();
  const providerExecutedCalls = new Set<string>();
  let synthesizedResults = 0;
  let droppedOrphanResults = 0;

  const closePendingSegment = (): void => {
    if (pending.size > 0) {
      repaired.push({
        role: 'tool',
        content: [...pending.entries()].map(([toolCallId, toolName]) => ({
          type: 'tool-result' as const,
          toolCallId,
          toolName,
          output: { type: 'text' as const, value: MISSING_TOOL_RESULT_CONTENT },
        })),
      } as ToolModelMessage);
      synthesizedResults += pending.size;
      pending.clear();
    }
    providerExecutedCalls.clear();
  };

  for (const message of messages) {
    if (message.role === 'user' || message.role === 'system') {
      closePendingSegment();
      repaired.push(message);
      continue;
    }

    if (message.role === 'assistant') {
      const parts = partsOf(message);
      if (parts) {
        for (const part of parts) {
          if (part.type !== 'tool-call' || typeof part.toolCallId !== 'string') continue;
          if (part.providerExecuted === true) {
            providerExecutedCalls.add(part.toolCallId);
          } else {
            pending.set(
              part.toolCallId,
              typeof part.toolName === 'string' ? part.toolName : 'unknown',
            );
          }
        }
      }
      repaired.push(message);
      continue;
    }

    if (message.role === 'tool') {
      const parts = partsOf(message);
      if (!parts) {
        repaired.push(message);
        continue;
      }
      const kept = parts.filter((part) => {
        if (part.type !== 'tool-result') return true;
        if (typeof part.toolCallId !== 'string') {
          droppedOrphanResults += 1;
          return false;
        }
        if (pending.delete(part.toolCallId)) return true;
        if (providerExecutedCalls.has(part.toolCallId)) return true;
        droppedOrphanResults += 1;
        return false;
      });
      if (kept.length > 0) {
        repaired.push({ ...message, content: kept } as ModelMessage);
      }
      continue;
    }

    repaired.push(message);
  }

  closePendingSegment();
  return { messages: repaired, synthesizedResults, droppedOrphanResults };
}
