/**
 * chat-request-validation.ts — required-field validation for POST /api/chat.
 *
 * Stability audit 2026-07-04 item ③. The pre-fix route ran an unguarded
 * `content.length` inside a `console.log` BEFORE it validated the body, so a
 * request whose `content` was missing or not a string threw synchronously and
 * surfaced to the client as a generic 500 — when the honest answer is a 400
 * (malformed request), retryable without server state.
 *
 * Extracted as a pure helper because route.ts can't be imported in a unit test
 * (it transitively loads the Electron-ABI `better-sqlite3` native module, which
 * won't load under plain Node), so the validation contract must live somewhere
 * unit-testable. Callers MUST run this before touching `content`.
 */

export interface ChatBodyValidationError {
  /** HTTP status the route should return (always 400 for a malformed body). */
  status: 400;
  /** Client-facing error message (kept identical to the legacy inline check). */
  error: string;
}

/**
 * Validate the required fields of a send-message body. Returns a 400 descriptor
 * when `session_id` or `content` is missing / not a non-empty string, else
 * `null` (the body is well-formed enough to proceed).
 */
export function validateSendMessageBody(body: {
  session_id?: unknown;
  content?: unknown;
}): ChatBodyValidationError | null {
  const message = 'session_id and content are required';
  if (typeof body.session_id !== 'string' || body.session_id.length === 0) {
    return { status: 400, error: message };
  }
  if (typeof body.content !== 'string' || body.content.length === 0) {
    return { status: 400, error: message };
  }
  return null;
}
