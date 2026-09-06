/**
 * Log line sanitizer for the persistent main-process log file.
 *
 * Phase 2C.6 follow-up: About → "打开日志文件夹" is now the headline
 * support entry. The whole point of that button is so the user can
 * pop the file open, copy bits into an issue, or attach it. So the
 * file MUST land sanitized — we can't ship a primary support
 * affordance that surfaces API keys, OAuth bearers, proxy creds,
 * provider error bodies with auth headers in them, or the user's
 * `$HOME` path.
 *
 * Rules (run before any line is appended):
 *
 *   1. API-key-shaped strings → keep prefix + `***` + last 4 chars
 *      so the token is visibly truncated but a developer can still
 *      cross-reference "this is the same key we saw in error X".
 *      Patterns: sk-…, sk-ant-…, anthropic-…, key-…, ghp_…, gho_…,
 *      hf_…, xai-…, plus generic "very long opaque token" heuristic.
 *   2. `Bearer <token>` → `Bearer ***LAST4` (anywhere in the line).
 *   3. URL query secrets — `?key=…` / `&token=…` / `&access_token=…`
 *      etc. → strip the value to `***`. Hostname + path are kept.
 *   4. Authorization-style header values inside structured logs
 *      (e.g. `"Authorization":"Bearer …"`).
 *   5. Home directory path → `~`. Replaced once per line; no path
 *      structure information is leaked except whatever the rest of
 *      the line says.
 *
 * Best-effort: regex-based redaction can never be exhaustive. The
 * doctor/export bundle has a structured sanitizer that walks objects;
 * here we operate on already-stringified log lines, so we trade off
 * completeness for simplicity. New patterns get added when we see
 * leaks.
 */

import os from 'os';

const HOME_DIR = os.homedir();
// Escape regex metachars so the home path is matched literally.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const HOME_REGEX = HOME_DIR ? new RegExp(escapeRegExp(HOME_DIR), 'g') : null;

/** Keep last 4 chars of an opaque token, mask the rest. */
function maskTail(s: string): string {
  if (s.length <= 4) return '***';
  return '***' + s.slice(-4);
}

/**
 * Vendor-prefixed API keys. Each entry has a literal `prefix` we keep
 * in the masked output so the line still reads "ghp_***abcd" or
 * "sk-ant-***1234" — the developer can correlate which key showed up
 * without seeing the random body. `regex` matches the full token; the
 * replacement is `prefix + ***LAST4`.
 *
 * Order matters: more specific prefixes (sk-ant-) come before more
 * general ones (sk-) so the long-form vendor lineage is preserved.
 */
const KEY_PATTERNS: { prefix: string; regex: RegExp }[] = [
  { prefix: 'sk-ant-', regex: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  // sk- but NOT sk-ant- (already matched above). Lookbehind would be
  // cleanest but isn't universally supported in older runtimes; instead
  // apply this rule second on the partially-masked string.
  { prefix: 'sk-', regex: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { prefix: 'ghp_', regex: /\bghp_[A-Za-z0-9]{20,}/g },
  { prefix: 'gho_', regex: /\bgho_[A-Za-z0-9]{20,}/g },
  { prefix: 'ghs_', regex: /\bghs_[A-Za-z0-9]{20,}/g },
  { prefix: 'ghu_', regex: /\bghu_[A-Za-z0-9]{20,}/g },
  { prefix: 'ghr_', regex: /\bghr_[A-Za-z0-9]{20,}/g },
  { prefix: 'hf_', regex: /\bhf_[A-Za-z0-9]{20,}/g },
  { prefix: 'xai-', regex: /\bxai-[A-Za-z0-9_-]{20,}/g },
  { prefix: 'anthropic-', regex: /\banthropic-[A-Za-z0-9_-]{16,}/g },
  { prefix: 'key-', regex: /\bkey-[A-Za-z0-9_-]{16,}/g },
];

const BEARER_REGEX = /Bearer\s+([A-Za-z0-9._\-+=]{16,})/g;

const QUERY_SECRET_REGEX = /([?&])(api_key|api-key|apikey|access_token|access-token|token|secret|password|pwd|key|auth_token|auth-token|x-api-key)=([^&\s"'<>]+)/gi;

const AUTH_HEADER_REGEX = /(["']?Authorization["']?\s*[:=]\s*["']?)(?:Bearer\s+)?([^\s"'<>,]+)/gi;

/**
 * Sensitive field names — every JSON property *value* under these names
 * gets stripped to `***`, regardless of whether the value looks like a
 * vendor-prefixed token, a long opaque blob, or just a short string. We
 * can't rely on value-shape rules alone: AWS access keys are short and
 * look like ordinary uppercase strings; arbitrary self-hosted
 * provider tokens may be plain alphabetic strings that the big-blob
 * heuristic skips. The field name is the strongest signal that the
 * adjacent value is sensitive.
 *
 * Underscore / hyphen / no-separator variants are all matched via
 * `[_-]?` in the compiled regex, so this list stays canonical.
 */
const SENSITIVE_FIELDS_CANONICAL = [
  'api_key', 'apikey',
  'token', 'auth_token', 'access_token', 'refresh_token',
  'secret', 'secret_key', 'client_secret',
  'password', 'pwd',
  'authorization',
  'x_api_key',
  'aws_access_key_id', 'aws_secret_access_key',
  'bearer',
];

function buildFieldAlternation(): string {
  return SENSITIVE_FIELDS_CANONICAL
    // Allow `[_-]` between segments and accept either separator (so `api_key`
    // / `api-key` / `apikey` all match).
    .map((f) => f.replace(/_/g, '[_-]?'))
    .join('|');
}

const FIELD_ALT = buildFieldAlternation();

/**
 * JSON-quoted: `"api_key":"value"`. Strips the value's content while
 * keeping the surrounding quote structure so the line still parses.
 */
const JSON_FIELD_REGEX = new RegExp(
  `("(?:${FIELD_ALT})"\\s*:\\s*")([^"\\\\]+)(")`,
  'gi',
);

/**
 * Env / key=value: `AWS_SECRET_ACCESS_KEY=AKIA...`, `api_key=abc`.
 * Also catches plain word-boundary key=value pairs in log lines that
 * aren't already in URL query position (the URL rule above handles
 * `?key=...` first). Stop at whitespace / comma / semicolon / quote
 * AND at `&` / `}` / `]` so the value doesn't swallow neighbouring
 * pairs in URL queries or JSON fragments.
 */
const ENV_FIELD_REGEX = new RegExp(
  `\\b(${FIELD_ALT})\\s*=\\s*([^\\s,;"'&}\\])]+)`,
  'gi',
);

/**
 * Big-blob heuristic: 32+ char alphanumerics that aren't already
 * masked or wrapped in known structure. We conservatively only fire
 * on substrings that look base64-ish (mix of upper/lower/digits) so
 * we don't mask hex hashes that the user genuinely needs to see.
 */
const BIG_BLOB_REGEX = /\b([A-Za-z0-9_-]{40,})\b/g;
function looksLikeToken(s: string): boolean {
  // Reject all-digits or all-hex (likely IDs / commit hashes the user wants to see)
  if (/^[0-9]+$/.test(s)) return false;
  if (/^[0-9a-f]+$/i.test(s) && s.length <= 64) return false;
  // Need both upper and lower OR contain - / _ to look base64ish
  return /[A-Z]/.test(s) && /[a-z]/.test(s);
}

export function sanitizeLogLine(line: string): string {
  let out = line;

  // 1. Vendor-prefixed keys.
  for (const { prefix, regex } of KEY_PATTERNS) {
    out = out.replace(regex, (m) => {
      const tail = m.slice(prefix.length);
      return prefix + maskTail(tail);
    });
  }

  // 2. Bearer tokens.
  out = out.replace(BEARER_REGEX, (_m, tok: string) => `Bearer ${maskTail(tok)}`);

  // 3. URL query secrets.
  out = out.replace(QUERY_SECRET_REGEX, (_m, sep: string, key: string) => `${sep}${key}=***`);

  // 4. Authorization-style header values.
  out = out.replace(AUTH_HEADER_REGEX, (_m, prefix: string, val: string) => `${prefix}${maskTail(val)}`);

  // 4b. JSON sensitive-field values. Field name decides — the value
  // may be a short uppercase string (AWS access key id), a plain
  // alphanumeric token, or anything else that wouldn't trip the
  // vendor-prefix or big-blob rules above.
  out = out.replace(JSON_FIELD_REGEX, (_m, prefix: string, _value: string, suffix: string) => `${prefix}***${suffix}`);

  // 4c. Env-style key=value (e.g. `AWS_SECRET_ACCESS_KEY=...`,
  // `api_key=abc`). Stops at whitespace / comma / semicolon / quote
  // so other tokens on the same line aren't accidentally swallowed.
  out = out.replace(ENV_FIELD_REGEX, (_m, key: string) => `${key}=***`);

  // 5. Big opaque blobs (defensive). Skip if already masked.
  out = out.replace(BIG_BLOB_REGEX, (m) => {
    if (m.includes('***')) return m;
    if (!looksLikeToken(m)) return m;
    return maskTail(m);
  });

  // 6. Home directory.
  if (HOME_REGEX) {
    out = out.replace(HOME_REGEX, '~');
  }

  return out;
}
