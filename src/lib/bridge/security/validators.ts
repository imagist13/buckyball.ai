/**
 * Input validation and sanitization for bridge IM commands.
 *
 * Prevents path traversal, command injection, and other dangerous inputs
 * from reaching the conversation engine or file system operations.
 */

import * as path from 'path';
import { detectPathDialect, resolvePathIdentity } from '../../path-identity';

// ── Constants ────────────────────────────────────────────────────

const MAX_INPUT_LENGTH = 32_000; // Claude's effective context limit
const MAX_PATH_LENGTH = 1024;
const SESSION_ID_PATTERN = /^[0-9a-f-]{32,64}$/i;
const VALID_MODES = ['plan', 'code', 'ask'] as const;

/**
 * Patterns that indicate shell injection or dangerous input.
 * Each entry has a regex and a human-readable reason.
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\x00/, reason: 'null byte' },
  { pattern: /\.\.[/\\]/, reason: 'path traversal (../)' },
  { pattern: /\$\(/, reason: 'command substitution $()' },
  { pattern: /`[^`]*`/, reason: 'backtick command substitution' },
  { pattern: /;\s*(rm|cat|curl|wget|chmod|chown|mv|cp|dd|mkfs|shutdown|reboot)\b/, reason: 'chained dangerous command' },
  { pattern: /\|\s*(bash|sh|zsh|exec)\b/, reason: 'pipe to shell' },
  { pattern: />\s*\//, reason: 'redirect to absolute path' },
];

// ── Validators ───────────────────────────────────────────────────

/**
 * Validate a working directory path.
 * Must be an existing absolute directory without traversal or control characters.
 * Returns sanitized path or null if invalid.
 */
export function validateWorkingDirectory(rawPath: string): string | null {
  if (!rawPath || !rawPath.trim()) return null;

  const trimmed = rawPath.trim();

  // Must be absolute in the current host dialect. `path.isAbsolute()` alone
  // cannot describe Windows input when tests/review run on another platform,
  // so detect the input dialect explicitly and then require host compatibility.
  const dialect = detectPathDialect(trimmed, process.platform);
  if (!path.isAbsolute(trimmed)) return null;
  if (process.platform === 'win32' && dialect === 'posix') return null;
  if (process.platform !== 'win32' && (dialect === 'windows_drive' || dialect === 'unc')) return null;

  // Reject control characters. Shell metacharacters are valid filename
  // characters on Windows and are safe here because this value is passed as
  // spawn.cwd / filesystem input, never interpolated into a command string.
   
  if (/[\x00-\x1f]/.test(trimmed)) return null;

  // Reject path traversal segments
  const segments = trimmed.split(/[/\\]/);
  if (segments.some(s => s === '..')) return null;

  // Reject if too long
  if (trimmed.length > MAX_PATH_LENGTH) return null;

  try {
    const identity = resolvePathIdentity(trimmed);
    return identity.kind === 'directory' ? identity.absolutePath : null;
  } catch {
    return null;
  }
}

/**
 * Validate a session ID format.
 * Must be a hex string or UUID, 32-64 characters.
 */
export function validateSessionId(id: string): boolean {
  if (!id || !id.trim()) return false;
  return SESSION_ID_PATTERN.test(id.trim());
}

/**
 * Check if input contains dangerous patterns (path traversal, command injection, etc.).
 * Returns { dangerous: false } for safe inputs or { dangerous: true, reason } for threats.
 */
export function isDangerousInput(input: string): { dangerous: boolean; reason?: string } {
  if (!input) return { dangerous: false };

  // Excessively long input
  if (input.length > MAX_INPUT_LENGTH * 2) {
    return { dangerous: true, reason: `excessively long input (${input.length} chars)` };
  }

  // Null bytes
  if (input.includes('\0')) {
    return { dangerous: true, reason: 'null byte detected' };
  }

  // Check known dangerous patterns
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(input)) {
      return { dangerous: true, reason };
    }
  }

  return { dangerous: false };
}

/**
 * Sanitize general text input: strip control characters (except newline/tab)
 * and enforce max length.
 * Returns { text, truncated } — truncated is true if the input was shortened.
 */
export function sanitizeInput(
  text: string,
  maxLength: number = MAX_INPUT_LENGTH,
): { text: string; truncated: boolean } {
  if (!text) return { text: '', truncated: false };

  // Strip control characters except \n (0x0A) and \t (0x09)
   
  let sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  const truncated = sanitized.length > maxLength;
  if (truncated) {
    sanitized = sanitized.slice(0, maxLength);
  }

  return { text: sanitized, truncated };
}

/**
 * Validate /mode parameter.
 */
export function validateMode(mode: string): mode is 'plan' | 'code' | 'ask' {
  return VALID_MODES.includes(mode as typeof VALID_MODES[number]);
}
