/**
 * Normalize untrusted text before it becomes a compact UI label.
 *
 * This deliberately preserves ZWJ so legitimate emoji graphemes remain
 * intact, while removing direction overrides/isolates and invisible format
 * controls that can visually reorder or disguise filenames and provenance.
 */
export function sanitizeDisplayText(
  input: string,
  maxCodePoints = 200,
): string {
  const normalized = input
    .replace(/\p{Cc}/gu, ' ')
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '')
    .replace(/[\u200b\u2060\ufeff]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return Array.from(normalized).slice(0, maxCodePoints).join('');
}
