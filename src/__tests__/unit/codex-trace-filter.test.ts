/**
 * B-025: drop the high-frequency Codex INFO span flood (the 12.5 GB log was
 * ~99% these), default RUST_LOG to warn, but NEVER drop warn/error/fatal lines
 * (fatal-config fail-fast must still see them).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldDropCodexTraceLine, resolveCodexRustLog } from '../../lib/codex/codex-trace-filter';

describe('shouldDropCodexTraceLine (B-025 tracing filter)', () => {
  it('drops codex_core::tasks enter/exit spans', () => {
    assert.equal(
      shouldDropCodexTraceLine('2026-06-08 INFO session_loop{thread_id=1}: turn{model=gpt-5.5}: codex_core::tasks: enter'),
      true,
    );
    assert.equal(shouldDropCodexTraceLine('INFO ... codex_core::tasks: exit'), true);
  });

  it('drops codex_core::session::handlers enter/exit spans', () => {
    assert.equal(shouldDropCodexTraceLine('INFO ... codex_core::session::handlers: enter'), true);
    assert.equal(shouldDropCodexTraceLine('INFO ... codex_core::session::handlers: exit'), true);
  });

  it('keeps fatal config / old-binary errors so fail-fast still triggers', () => {
    assert.equal(shouldDropCodexTraceLine("error: unexpected argument '--listen' found"), false);
    assert.equal(shouldDropCodexTraceLine('exited { code: 2, signal: null }'), false);
  });

  it('keeps warn/error lines even if they mention a span target', () => {
    assert.equal(shouldDropCodexTraceLine('WARN codex_core::tasks: enter (degraded)'), false);
    assert.equal(shouldDropCodexTraceLine('ERROR codex_core::session::handlers: exit failed'), false);
  });

  it('keeps ordinary non-span info lines (e.g. startup)', () => {
    assert.equal(shouldDropCodexTraceLine('INFO app-server listening on stdio'), false);
  });
});

describe('resolveCodexRustLog (B-025 default warn)', () => {
  it('defaults to warn so there is no INFO flood', () => {
    assert.equal(resolveCodexRustLog({}), 'warn');
  });

  it('honors an explicit operator RUST_LOG', () => {
    assert.equal(resolveCodexRustLog({ RUST_LOG: 'debug' }), 'debug');
    assert.equal(resolveCodexRustLog({ RUST_LOG: 'info' }), 'info');
  });

  it('opts into info only when CODEPILOT_CODEX_TRACE=1', () => {
    assert.equal(resolveCodexRustLog({ CODEPILOT_CODEX_TRACE: '1' }), 'info');
    assert.equal(resolveCodexRustLog({ CODEPILOT_CODEX_TRACE: '0' }), 'warn');
  });

  it('explicit RUST_LOG wins over the trace flag', () => {
    assert.equal(resolveCodexRustLog({ RUST_LOG: 'warn', CODEPILOT_CODEX_TRACE: '1' }), 'warn');
  });
});
