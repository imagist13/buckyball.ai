import type { TokenUsage } from '@/types';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isCost(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0;
}

/**
 * DB token_usage is a compatibility boundary shared by multiple runtimes and
 * historical releases. Only render a statistic when both required counters
 * have real, non-negative integer values; never invent a zero for missing
 * fields merely to satisfy the TypeScript shape.
 */
export function parseDisplayTokenUsage(value: unknown): TokenUsage | null {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed)) return null;
  if (!isTokenCount(parsed.input_tokens) || !isTokenCount(parsed.output_tokens)) return null;

  const usage: TokenUsage = {
    input_tokens: parsed.input_tokens,
    output_tokens: parsed.output_tokens,
  };
  if (isTokenCount(parsed.cache_read_input_tokens)) {
    usage.cache_read_input_tokens = parsed.cache_read_input_tokens;
  }
  if (isTokenCount(parsed.cache_creation_input_tokens)) {
    usage.cache_creation_input_tokens = parsed.cache_creation_input_tokens;
  }
  if (isCost(parsed.cost_usd)) usage.cost_usd = parsed.cost_usd;
  return usage;
}
