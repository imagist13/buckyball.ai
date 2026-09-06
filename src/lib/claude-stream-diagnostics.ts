function serializableErrorValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      code: (value as NodeJS.ErrnoException).code,
    };
  }
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'undefined'
  ) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

/**
 * Next dev's logger can render Error objects and nested object arguments as
 * `{}`. Emit one JSON string so the terminal preserves the useful facts.
 */
export function formatClaudeStreamErrorDiagnostic(error: unknown): string {
  const diagnostic = error instanceof Error
    ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: serializableErrorValue((error as Error & { cause?: unknown }).cause),
        stderr: (error as Error & { stderr?: string }).stderr,
        code: (error as NodeJS.ErrnoException).code,
      }
    : {
        message: typeof error === 'string' ? error : 'Unknown error',
        value: serializableErrorValue(error),
      };
  return JSON.stringify(diagnostic);
}
